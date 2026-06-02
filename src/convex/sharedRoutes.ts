import { v } from "convex/values";
import { Effect } from "effect";

import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { runConvexEffect, tryConvexPromise } from "./effect";
import {
	getAuthenticatedUserIdEffect,
	validateRemoteSavedRoutePayload,
} from "./savedRouteHelpers";
import {
	deserializeRemoteSavedRoute,
	serializeSavedRouteForRemote,
	type RemoteSavedRoutePayload,
} from "../lib/saved-routes-core";
import { remoteSavedRoutePayloadValidator } from "../lib/saved-route-convex-validators";
import {
	assertRemoteRouteJsonSizeEffect,
	type RemoteRouteJsonSizeError,
} from "../lib/saved-route-size";

const shareTokenPattern = /^[A-Za-z0-9_-]{16,128}$/;

class SharedRouteAuthenticationError extends Error {
	readonly _tag = "SharedRouteAuthenticationError";

	constructor() {
		super("Authentication is required to share routes.");
	}
}

class SharedRouteValidationError extends Error {
	readonly _tag = "SharedRouteValidationError";
}

const mapSharedRouteSizeError = (error: RemoteRouteJsonSizeError) =>
	new SharedRouteValidationError(error.message);

function isValidShareToken(shareToken: string): boolean {
	return shareTokenPattern.test(shareToken);
}

function remotePayloadFromRow(row: {
	routeJson: string;
	createdAtMs: number;
}): RemoteSavedRoutePayload | null {
	const createdAt = new Date(row.createdAtMs).toISOString();
	const payload = {
		id: "shared-route",
		createdAt,
		routeJson: row.routeJson,
	};
	const savedRoute = deserializeRemoteSavedRoute(payload);

	return savedRoute ? serializeSavedRouteForRemote(savedRoute) : null;
}

export async function createHandler(
	ctx: MutationCtx,
	args: {
		shareToken: string;
		sourceRouteId?: string;
		savedRoute: RemoteSavedRoutePayload;
	},
) {
	return runConvexEffect(
		Effect.gen(function* () {
			const ownerUserId = yield* getAuthenticatedUserIdEffect(
				ctx,
				() => new SharedRouteAuthenticationError(),
			);

			if (!isValidShareToken(args.shareToken)) {
				return yield* Effect.fail(
					new SharedRouteValidationError("Share token is invalid."),
				);
			}

			const savedRoute = validateRemoteSavedRoutePayload(args.savedRoute);
			if (!savedRoute) {
				return yield* Effect.fail(
					new SharedRouteValidationError("Shared route payload is invalid."),
				);
			}

			yield* assertRemoteRouteJsonSizeEffect(
				savedRoute.routeJson,
				"shared",
			).pipe(Effect.mapError(mapSharedRouteSizeError));

			let sourceRouteId: string | undefined;
			if (args.sourceRouteId) {
				const requestedSourceRouteId = args.sourceRouteId;
				const sourceRoute = yield* tryConvexPromise(
					() =>
						ctx.db
							.query("savedRoutes")
							.withIndex("by_user_routeId", (q) =>
								q
									.eq("userId", ownerUserId)
									.eq("routeId", requestedSourceRouteId),
							)
							.unique(),
					"Could not verify shared route source.",
				);

				if (!sourceRoute) {
					return yield* Effect.fail(
						new SharedRouteValidationError(
							"Shared route source does not belong to the current user.",
						),
					);
				}

				sourceRouteId = requestedSourceRouteId;
			}

			const existingShare = yield* tryConvexPromise(
				() =>
					ctx.db
						.query("sharedRoutes")
						.withIndex("by_shareToken", (q) =>
							q.eq("shareToken", args.shareToken),
						)
						.unique(),
				"Could not check shared route token.",
			);

			if (existingShare) {
				return yield* Effect.fail(
					new SharedRouteValidationError("Share token already exists."),
				);
			}

			yield* tryConvexPromise(
				() =>
					ctx.db.insert("sharedRoutes", {
						shareToken: args.shareToken,
						ownerUserId,
						...(sourceRouteId ? { sourceRouteId } : {}),
						createdAtMs: Date.now(),
						routeJson: savedRoute.routeJson,
					}),
				"Could not create shared route.",
			);

			return {
				shareToken: args.shareToken,
				urlPath: `/share/${args.shareToken}`,
			};
		}),
	);
}

export async function getByTokenHandler(
	ctx: QueryCtx,
	args: { shareToken: string },
) {
	return runConvexEffect(
		Effect.gen(function* () {
			if (!isValidShareToken(args.shareToken)) {
				return null;
			}

			const sharedRoute = yield* tryConvexPromise(
				() =>
					ctx.db
						.query("sharedRoutes")
						.withIndex("by_shareToken", (q) =>
							q.eq("shareToken", args.shareToken),
						)
						.unique(),
				"Could not read shared route.",
			);

			return sharedRoute ? remotePayloadFromRow(sharedRoute) : null;
		}),
	);
}

export const create = mutation({
	args: {
		shareToken: v.string(),
		sourceRouteId: v.optional(v.string()),
		savedRoute: remoteSavedRoutePayloadValidator,
	},
	handler: createHandler,
});

export const getByToken = query({
	args: {
		shareToken: v.string(),
	},
	handler: getByTokenHandler,
});
