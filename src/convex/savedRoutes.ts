import {
	type PaginationOptions,
	type PaginationResult,
	paginationOptsValidator,
} from "convex/server";
import { v } from "convex/values";
import { Effect } from "effect";
import { remoteSavedRoutePayloadValidator } from "../lib/saved-route-convex-validators";
import {
	deserializeRemoteSavedRoute,
	normalizePlannedRoute,
	type RemoteSavedRoutePayload,
	serializeSavedRouteForRemote,
} from "../lib/saved-routes-core";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { runConvexEffect, tryConvexPromise } from "./effect";

const maxMergeRouteCount = 200;

type ValidatedRemoteSavedRoute = RemoteSavedRoutePayload & {
	createdAtMs: number;
};

class SavedRoutesAuthenticationError extends Error {
	readonly _tag = "SavedRoutesAuthenticationError";

	constructor() {
		super("Authentication is required to sync saved routes.");
	}
}

class SavedRoutesValidationError extends Error {
	readonly _tag = "SavedRoutesValidationError";
}

function getAuthenticatedUserIdEffect(
	ctx: QueryCtx | MutationCtx,
): Effect.Effect<string, Error | SavedRoutesAuthenticationError> {
	return tryConvexPromise(
		() => ctx.auth.getUserIdentity(),
		"Could not read authenticated user.",
	).pipe(
		Effect.flatMap((identity) =>
			identity
				? Effect.succeed(identity.subject)
				: Effect.fail(new SavedRoutesAuthenticationError()),
		),
	);
}

function validateRemoteSavedRoutePayload(
	value: unknown,
): ValidatedRemoteSavedRoute | null {
	const savedRoute = deserializeRemoteSavedRoute(value);
	if (!savedRoute) {
		return null;
	}
	const remotePayload = serializeSavedRouteForRemote(savedRoute);
	const createdAtMs = Date.parse(remotePayload.createdAt);

	return Number.isFinite(createdAtMs)
		? {
				...remotePayload,
				createdAtMs,
			}
		: null;
}

function remotePayloadFromRow(row: {
	routeId: string;
	createdAtMs: number;
	routeJson?: string;
	route?: unknown;
}): RemoteSavedRoutePayload | null {
	const createdAt = new Date(row.createdAtMs).toISOString();

	if (typeof row.routeJson === "string") {
		return {
			id: row.routeId,
			createdAt,
			routeJson: row.routeJson,
		};
	}

	const legacyRoute = normalizePlannedRoute(row.route);

	return legacyRoute
		? {
				id: row.routeId,
				createdAt,
				routeJson: JSON.stringify(legacyRoute),
			}
		: null;
}

export function listForCurrentUserHandler(
	ctx: QueryCtx,
	args: { paginationOpts: PaginationOptions },
) {
	return runConvexEffect(
		Effect.gen(function* () {
			const userId = yield* getAuthenticatedUserIdEffect(ctx);
			const result = yield* tryConvexPromise(
				() =>
					ctx.db
						.query("savedRoutes")
						.withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
						.order("desc")
						.paginate(args.paginationOpts),
				"Could not read saved routes.",
			);

			const page = result.page.flatMap((row) => {
				const payload = remotePayloadFromRow(row);

				return payload ? [payload] : [];
			});

			return {
				...result,
				page,
			} satisfies PaginationResult<RemoteSavedRoutePayload>;
		}),
	);
}

export function upsertHandler(
	ctx: MutationCtx,
	args: { savedRoute: RemoteSavedRoutePayload },
) {
	return runConvexEffect(
		Effect.gen(function* () {
			const userId = yield* getAuthenticatedUserIdEffect(ctx);
			const savedRoute = validateRemoteSavedRoutePayload(args.savedRoute);

			if (!savedRoute) {
				return yield* Effect.fail(
					new SavedRoutesValidationError("Saved route payload is invalid."),
				);
			}

			const existingRoute = yield* tryConvexPromise(
				() =>
					ctx.db
						.query("savedRoutes")
						.withIndex("by_user_routeId", (q) =>
							q.eq("userId", userId).eq("routeId", savedRoute.id),
						)
						.unique(),
				"Could not read saved route.",
			);
			const now = Date.now();

			if (existingRoute) {
				yield* tryConvexPromise(
					() =>
						ctx.db.replace(existingRoute._id, {
							userId,
							routeId: savedRoute.id,
							createdAtMs: savedRoute.createdAtMs,
							updatedAtMs: now,
							routeJson: savedRoute.routeJson,
						}),
					"Could not update saved route.",
				);
				return { inserted: false };
			}

			yield* tryConvexPromise(
				() =>
					ctx.db.insert("savedRoutes", {
						userId,
						routeId: savedRoute.id,
						createdAtMs: savedRoute.createdAtMs,
						updatedAtMs: now,
						routeJson: savedRoute.routeJson,
					}),
				"Could not insert saved route.",
			);

			return { inserted: true };
		}),
	);
}

export function removeHandler(ctx: MutationCtx, args: { routeId: string }) {
	return runConvexEffect(
		Effect.gen(function* () {
			const userId = yield* getAuthenticatedUserIdEffect(ctx);

			if (args.routeId.trim().length === 0) {
				return yield* Effect.fail(
					new SavedRoutesValidationError("Saved route id is required."),
				);
			}

			const existingRoute = yield* tryConvexPromise(
				() =>
					ctx.db
						.query("savedRoutes")
						.withIndex("by_user_routeId", (q) =>
							q.eq("userId", userId).eq("routeId", args.routeId),
						)
						.unique(),
				"Could not read saved route.",
			);

			if (!existingRoute) {
				return { deleted: false };
			}

			yield* tryConvexPromise(
				() => ctx.db.delete(existingRoute._id),
				"Could not delete saved route.",
			);
			return { deleted: true };
		}),
	);
}

export function mergeLocalRoutesHandler(
	ctx: MutationCtx,
	args: { savedRoutes: unknown[] },
) {
	return runConvexEffect(
		Effect.gen(function* () {
			const userId = yield* getAuthenticatedUserIdEffect(ctx);

			if (args.savedRoutes.length > maxMergeRouteCount) {
				return yield* Effect.fail(
					new SavedRoutesValidationError(
						`Cannot merge more than ${maxMergeRouteCount} routes.`,
					),
				);
			}

			const seenRouteIds = new Set<string>();
			let inserted = 0;
			let skipped = 0;
			let invalid = 0;
			let duplicate = 0;
			const now = Date.now();

			for (const candidateRoute of args.savedRoutes) {
				const savedRoute = validateRemoteSavedRoutePayload(candidateRoute);

				if (!savedRoute) {
					invalid += 1;
					continue;
				}

				if (seenRouteIds.has(savedRoute.id)) {
					duplicate += 1;
					continue;
				}

				seenRouteIds.add(savedRoute.id);

				const existingRoute = yield* tryConvexPromise(
					() =>
						ctx.db
							.query("savedRoutes")
							.withIndex("by_user_routeId", (q) =>
								q.eq("userId", userId).eq("routeId", savedRoute.id),
							)
							.unique(),
					"Could not read saved route.",
				);

				if (existingRoute) {
					skipped += 1;
					continue;
				}

				yield* tryConvexPromise(
					() =>
						ctx.db.insert("savedRoutes", {
							userId,
							routeId: savedRoute.id,
							createdAtMs: savedRoute.createdAtMs,
							updatedAtMs: now,
							routeJson: savedRoute.routeJson,
						}),
					"Could not insert saved route.",
				);
				inserted += 1;
			}

			return { inserted, skipped, invalid, duplicate };
		}),
	);
}

export const listForCurrentUser = query({
	args: {
		paginationOpts: paginationOptsValidator,
	},
	handler: listForCurrentUserHandler,
});

export const upsert = mutation({
	args: {
		savedRoute: remoteSavedRoutePayloadValidator,
	},
	handler: upsertHandler,
});

export const remove = mutation({
	args: {
		routeId: v.string(),
	},
	handler: removeHandler,
});

export const mergeLocalRoutes = mutation({
	args: {
		savedRoutes: v.array(v.any()),
	},
	handler: mergeLocalRoutesHandler,
});
