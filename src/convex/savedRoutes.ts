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
	normalizeSavedRouteSummary,
	type RemoteSavedRoutePayload,
	type RemoteSavedRouteSummaryPayload,
	type RemoteSavedRouteVersionPayload,
	summarizeSavedRoute,
} from "../lib/saved-routes-core";
import {
	assertRemoteRouteJsonSizeEffect,
	getSavedRouteRowConvexDocumentSize,
	isRouteJsonWithinRemoteSizeLimit,
	type RemoteRouteJsonSizeError,
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

function remoteSummaryFromPayload(
	payload: RemoteSavedRoutePayload,
): RemoteSavedRouteSummaryPayload | null {
	const savedRoute = deserializeRemoteSavedRoute(payload);
	return savedRoute ? summarizeSavedRoute(savedRoute) : null;
}

function remoteSummaryFromRow(row: {
	routeId: string;
	createdAtMs: number;
	routeJson?: string;
	route?: unknown;
	summary?: RemoteSavedRouteSummaryPayload;
}): RemoteSavedRouteSummaryPayload | null {
	if (row.summary) {
		return normalizeSavedRouteSummary(row.summary);
	}

	const payload = remotePayloadFromRow(row);
	return payload ? remoteSummaryFromPayload(payload) : null;
}

function normalizeSearchText(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function summaryMatchesFilters(
	summary: RemoteSavedRouteSummaryPayload,
	args: {
		searchQuery?: string;
		minDistanceMeters?: number;
		maxDistanceMeters?: number;
		minElevationMeters?: number;
		maxElevationMeters?: number;
	},
) {
	if (
		args.minDistanceMeters !== undefined &&
		summary.distanceMeters < args.minDistanceMeters
	) {
		return false;
	}

	if (
		args.maxDistanceMeters !== undefined &&
		summary.distanceMeters > args.maxDistanceMeters
	) {
		return false;
	}

	if (
		args.minElevationMeters !== undefined &&
		summary.ascendMeters < args.minElevationMeters
	) {
		return false;
	}

	if (
		args.maxElevationMeters !== undefined &&
		summary.ascendMeters > args.maxElevationMeters
	) {
		return false;
	}

	const normalizedQuery = normalizeSearchText(args.searchQuery ?? "");
	if (!normalizedQuery) {
		return true;
	}

	return [
		summary.id,
		summary.createdAt,
		summary.mode,
		summary.sourceKind,
		summary.startLabel,
		summary.destinationLabel,
		...summary.waypointLabels,
		String(summary.distanceMeters),
		String(summary.ascendMeters),
		String(summary.durationMs),
		summary.requestedDistanceMeters === undefined
			? ""
			: String(summary.requestedDistanceMeters),
		summary.roundCourseTarget ? JSON.stringify(summary.roundCourseTarget) : "",
	]
		.join(" ")
		.toLocaleLowerCase()
		.includes(normalizedQuery);
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

const mapSavedRouteSizeError = (error: RemoteRouteJsonSizeError) =>
	new SavedRoutesValidationError(error.message);

const pruneSavedRouteVersionsEffect = Effect.fn(
	"pruneSavedRouteVersionsEffect",
)(function* (ctx: MutationCtx, userId: string, routeId: string) {
	const versions = yield* tryConvexPromise(
		() =>
			ctx.db
				.query("savedRouteVersions")
				.withIndex("by_user_route_capturedAt", (q) =>
					q.eq("userId", userId).eq("routeId", routeId),
				)
				.order("desc")
				.collect(),
		"Could not read saved route versions.",
	);

	for (const version of versions.slice(maxSavedRouteVersions)) {
		yield* tryConvexPromise(
			() => ctx.db.delete(version._id),
			"Could not delete saved route version.",
		);
	}
});

const capturePreviousSavedRouteVersionEffect = Effect.fn(
	"capturePreviousSavedRouteVersionEffect",
)(function* (
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
	yield* assertRemoteRouteJsonSizeEffect(
		existingPayload.routeJson,
		"saved",
	).pipe(Effect.mapError(mapSavedRouteSizeError));
	yield* tryConvexPromise(
		() =>
			ctx.db.insert("savedRouteVersions", {
				userId,
				routeId: existingRoute.routeId,
				versionId: createSavedRouteVersionId(
					existingRoute.routeId,
					capturedAtMs,
				),
				capturedAtMs,
				createdAtMs: existingRoute.createdAtMs,
				routeJson: existingPayload.routeJson,
			}),
		"Could not capture saved route version.",
	);
	yield* pruneSavedRouteVersionsEffect(ctx, userId, existingRoute.routeId);
});

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

/**
 * Lists lightweight route summaries for the current user.
 *
 * Search/distance/elevation filters are applied after Convex pagination, so
 * `paginationOpts.numItems` is a maximum returned page size when filters are
 * present, not a guaranteed filled page size.
 */
export function listSummariesForCurrentUserHandler(
	ctx: QueryCtx,
	args: {
		paginationOpts: PaginationOptions;
		searchQuery?: string;
		minDistanceMeters?: number;
		maxDistanceMeters?: number;
		minElevationMeters?: number;
		maxElevationMeters?: number;
	},
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
				"Could not read saved route summaries.",
			);

			const page = result.page.flatMap((row) => {
				const summary = remoteSummaryFromRow(row);

				return summary && summaryMatchesFilters(summary, args) ? [summary] : [];
			});

			return {
				...result,
				page,
			} satisfies PaginationResult<RemoteSavedRouteSummaryPayload>;
		}),
	);
}

export function getForCurrentUserHandler(
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

			const row = yield* tryConvexPromise(
				() =>
					ctx.db
						.query("savedRoutes")
						.withIndex("by_user_routeId", (q) =>
							q.eq("userId", userId).eq("routeId", args.routeId),
						)
						.unique(),
				"Could not read saved route.",
			);

			return row ? remotePayloadFromRow(row) : null;
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

			yield* assertRemoteRouteJsonSizeEffect(
				savedRoute.routeJson,
				"saved",
			).pipe(Effect.mapError(mapSavedRouteSizeError));
			const summary = remoteSummaryFromPayload(savedRoute);
			if (!summary) {
				return yield* Effect.fail(
					new SavedRoutesValidationError("Saved route payload is invalid."),
				);
			}

			const now = Date.now();
			const row = {
				userId,
				routeId: savedRoute.id,
				createdAtMs: savedRoute.createdAtMs,
				updatedAtMs: now,
				routeJson: savedRoute.routeJson,
				summary,
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
					yield* capturePreviousSavedRouteVersionEffect(ctx, userId, {
						routeId: existingRoute.routeId,
						createdAtMs: existingRoute.createdAtMs,
						updatedAtMs: existingRoute.updatedAtMs,
						routeJson: existingRoute.routeJson,
						route: existingRoute.route,
					});
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
					summary: remoteSummaryFromPayload(savedRoute) ?? undefined,
				} satisfies SavedRouteStorageRow;

				if (!row.summary || !isSavedRouteRowWithinConvexDocumentLimit(row)) {
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

export const listSummariesForCurrentUser = query({
	args: {
		paginationOpts: paginationOptsValidator,
		searchQuery: v.optional(v.string()),
		minDistanceMeters: v.optional(v.number()),
		maxDistanceMeters: v.optional(v.number()),
		minElevationMeters: v.optional(v.number()),
		maxElevationMeters: v.optional(v.number()),
	},
	handler: listSummariesForCurrentUserHandler,
});

export const getForCurrentUser = query({
	args: {
		routeId: v.string(),
	},
	handler: getForCurrentUserHandler,
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
