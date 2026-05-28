import {
	type PaginationOptions,
	type PaginationResult,
	paginationOptsValidator,
} from "convex/server";
import { v } from "convex/values";
import { Effect } from "effect";
import { remoteSavedRoutePayloadValidator } from "../lib/saved-route-convex-validators";
import {
	normalizePlannedRoute,
	type RemoteSavedRoutePayload,
	type RemoteSavedRouteVersionPayload,
} from "../lib/saved-routes-core";
import {
	assertRemoteRouteJsonSize,
	getSavedRouteRowConvexDocumentSize,
	isRouteJsonWithinRemoteSizeLimit,
	type SavedRouteStorageRow,
} from "../lib/saved-route-size";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { runConvexEffect, tryConvexPromise } from "./effect";
import {
	getAuthenticatedUserIdEffect,
	validateRemoteSavedRoutePayload,
} from "./savedRouteHelpers";

const maxMergeRouteCount = 200;
const maxSavedRouteVersions = 10;
const maxConvexDocumentBytes = 1024 * 1024;
const savedRouteSizeLimitMessage =
	"Saved route is too large to sync. Maximum route payload size is 512 KiB.";

class SavedRoutesAuthenticationError extends Error {
	readonly _tag = "SavedRoutesAuthenticationError";

	constructor() {
		super("Authentication is required to sync saved routes.");
	}
}

class SavedRoutesValidationError extends Error {
	readonly _tag = "SavedRoutesValidationError";
}

function isSavedRouteRowWithinConvexDocumentLimit(
	row: SavedRouteStorageRow,
): boolean {
	return getSavedRouteRowConvexDocumentSize(row) <= maxConvexDocumentBytes;
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

function createSavedRouteVersionId(routeId: string, capturedAtMs: number) {
	return `${routeId}:${capturedAtMs}`;
}

function remoteVersionPayloadFromRow(row: {
	routeId: string;
	versionId: string;
	capturedAtMs: number;
	createdAtMs: number;
	routeJson: string;
}): RemoteSavedRouteVersionPayload {
	return {
		versionId: row.versionId,
		routeId: row.routeId,
		capturedAt: new Date(row.capturedAtMs).toISOString(),
		savedRoute: {
			id: row.routeId,
			createdAt: new Date(row.createdAtMs).toISOString(),
			routeJson: row.routeJson,
		},
	};
}

async function pruneSavedRouteVersions(
	ctx: MutationCtx,
	userId: string,
	routeId: string,
) {
	const versions = await ctx.db
		.query("savedRouteVersions")
		.withIndex("by_user_route_capturedAt", (q) =>
			q.eq("userId", userId).eq("routeId", routeId),
		)
		.order("desc")
		.collect();

	await Promise.all(
		versions
			.slice(maxSavedRouteVersions)
			.map((version) => ctx.db.delete(version._id)),
	);
}

function hasSavedRoutePayloadChanged(
	existingRoute: {
		routeJson?: string;
		route?: unknown;
	},
	nextRoute: RemoteSavedRoutePayload,
) {
	const existingPayload = remotePayloadFromRow({
		routeId: nextRoute.id,
		createdAtMs: Date.parse(nextRoute.createdAt),
		routeJson: existingRoute.routeJson,
		route: existingRoute.route,
	});

	return existingPayload?.routeJson !== nextRoute.routeJson;
}

async function capturePreviousSavedRouteVersion(
	ctx: MutationCtx,
	userId: string,
	existingRoute: {
		routeId: string;
		createdAtMs: number;
		updatedAtMs: number;
		routeJson?: string;
		route?: unknown;
	},
) {
	const existingPayload = remotePayloadFromRow(existingRoute);
	if (!existingPayload) {
		return;
	}

	const capturedAtMs = Date.now();
	assertRemoteRouteJsonSize(existingPayload.routeJson, "saved");
	await ctx.db.insert("savedRouteVersions", {
		userId,
		routeId: existingRoute.routeId,
		versionId: createSavedRouteVersionId(existingRoute.routeId, capturedAtMs),
		capturedAtMs,
		createdAtMs: existingRoute.createdAtMs,
		routeJson: existingPayload.routeJson,
	});
	await pruneSavedRouteVersions(ctx, userId, existingRoute.routeId);
}

export function listForCurrentUserHandler(
	ctx: QueryCtx,
	args: { paginationOpts: PaginationOptions },
) {
	return runConvexEffect(
		Effect.gen(function* () {
			const userId = yield* getAuthenticatedUserIdEffect(
				ctx,
				() => new SavedRoutesAuthenticationError(),
			);
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

export function listVersionsForRouteHandler(
	ctx: QueryCtx,
	args: { routeId: string },
) {
	return runConvexEffect(
		Effect.gen(function* () {
			const userId = yield* getAuthenticatedUserIdEffect(
				ctx,
				() => new SavedRoutesAuthenticationError(),
			);

			if (args.routeId.trim().length === 0) {
				return yield* Effect.fail(
					new SavedRoutesValidationError("Saved route id is required."),
				);
			}

			const versions = yield* tryConvexPromise(
				() =>
					ctx.db
						.query("savedRouteVersions")
						.withIndex("by_user_route_capturedAt", (q) =>
							q.eq("userId", userId).eq("routeId", args.routeId),
						)
						.order("desc")
						.take(maxSavedRouteVersions),
				"Could not read saved route versions.",
			);

			return versions.map(remoteVersionPayloadFromRow);
		}),
	);
}

export function upsertHandler(
	ctx: MutationCtx,
	args: { savedRoute: RemoteSavedRoutePayload },
) {
	return runConvexEffect(
		Effect.gen(function* () {
			const userId = yield* getAuthenticatedUserIdEffect(
				ctx,
				() => new SavedRoutesAuthenticationError(),
			);
			const savedRoute = validateRemoteSavedRoutePayload(args.savedRoute);

			if (!savedRoute) {
				return yield* Effect.fail(
					new SavedRoutesValidationError("Saved route payload is invalid."),
				);
			}

			try {
				assertRemoteRouteJsonSize(savedRoute.routeJson, "saved");
			} catch (error) {
				return yield* Effect.fail(
					new SavedRoutesValidationError((error as Error).message),
				);
			}

			const now = Date.now();
			const row = {
				userId,
				routeId: savedRoute.id,
				createdAtMs: savedRoute.createdAtMs,
				updatedAtMs: now,
				routeJson: savedRoute.routeJson,
			} satisfies SavedRouteStorageRow;

			if (!isSavedRouteRowWithinConvexDocumentLimit(row)) {
				return yield* Effect.fail(
					new SavedRoutesValidationError(savedRouteSizeLimitMessage),
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

			if (existingRoute) {
				if (hasSavedRoutePayloadChanged(existingRoute, savedRoute)) {
					yield* tryConvexPromise(
						() =>
							capturePreviousSavedRouteVersion(ctx, userId, {
								routeId: existingRoute.routeId,
								createdAtMs: existingRoute.createdAtMs,
								updatedAtMs: existingRoute.updatedAtMs,
								routeJson: existingRoute.routeJson,
								route: existingRoute.route,
							}),
						"Could not capture saved route version.",
					);
				}
				yield* tryConvexPromise(
					() => ctx.db.replace(existingRoute._id, row),
					"Could not update saved route.",
				);
				return { inserted: false };
			}

			yield* tryConvexPromise(
				() => ctx.db.insert("savedRoutes", row),
				"Could not insert saved route.",
			);

			return { inserted: true };
		}),
	);
}

export function removeHandler(ctx: MutationCtx, args: { routeId: string }) {
	return runConvexEffect(
		Effect.gen(function* () {
			const userId = yield* getAuthenticatedUserIdEffect(
				ctx,
				() => new SavedRoutesAuthenticationError(),
			);

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
			const versions = yield* tryConvexPromise(
				() =>
					ctx.db
						.query("savedRouteVersions")
						.withIndex("by_user_route_capturedAt", (q) =>
							q.eq("userId", userId).eq("routeId", args.routeId),
						)
						.collect(),
				"Could not read saved route versions.",
			);
			for (const version of versions) {
				yield* tryConvexPromise(
					() => ctx.db.delete(version._id),
					"Could not delete saved route version.",
				);
			}
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
			const userId = yield* getAuthenticatedUserIdEffect(
				ctx,
				() => new SavedRoutesAuthenticationError(),
			);

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

				if (!isRouteJsonWithinRemoteSizeLimit(savedRoute.routeJson)) {
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

				const row = {
					userId,
					routeId: savedRoute.id,
					createdAtMs: savedRoute.createdAtMs,
					updatedAtMs: now,
					routeJson: savedRoute.routeJson,
				} satisfies SavedRouteStorageRow;

				if (!isSavedRouteRowWithinConvexDocumentLimit(row)) {
					invalid += 1;
					continue;
				}

				yield* tryConvexPromise(
					() => ctx.db.insert("savedRoutes", row),
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

export const listVersionsForRoute = query({
	args: {
		routeId: v.string(),
	},
	handler: listVersionsForRouteHandler,
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
