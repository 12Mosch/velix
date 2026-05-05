import { v } from "convex/values";

import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	deserializeRemoteSavedRoute,
	isRecord,
	normalizePlannedRoute,
	serializeSavedRouteForRemote,
	type RemoteSavedRoutePayload,
} from "../lib/saved-routes-core";
import { remoteSavedRoutePayloadValidator } from "../lib/saved-route-convex-validators";

const maxMergeRouteCount = 200;

type ValidatedRemoteSavedRoute = RemoteSavedRoutePayload & {
	createdAtMs: number;
};

async function getAuthenticatedUserId(ctx: QueryCtx | MutationCtx) {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new Error("Authentication is required to sync saved routes.");
	}

	return identity.subject;
}

function validateRemoteSavedRoutePayload(
	value: unknown,
): ValidatedRemoteSavedRoute | null {
	if (!isRecord(value)) {
		return null;
	}

	const savedRoute = deserializeRemoteSavedRoute(value);
	if (!savedRoute) {
		return null;
	}
	const remotePayload = serializeSavedRouteForRemote(savedRoute);
	const createdAtMs = Date.parse(remotePayload.createdAt);

	return {
		...remotePayload,
		createdAtMs,
	};
}

function remotePayloadFromRow(row: {
	routeId: string;
	createdAtMs: number;
	routeJson?: string;
	route?: unknown;
}): RemoteSavedRoutePayload | null {
	const createdAt = new Date(row.createdAtMs).toISOString();
	const routeJson =
		typeof row.routeJson === "string"
			? row.routeJson
			: (() => {
					const legacyRoute = normalizePlannedRoute(row.route);
					return legacyRoute ? JSON.stringify(legacyRoute) : null;
				})();

	if (!routeJson) {
		return null;
	}

	const payload = {
		id: row.routeId,
		createdAt,
		routeJson,
	};

	const savedRoute = deserializeRemoteSavedRoute(payload);

	return savedRoute ? serializeSavedRouteForRemote(savedRoute) : null;
}

export const listForCurrentUser = query({
	args: {},
	handler: async (ctx) => {
		const userId = await getAuthenticatedUserId(ctx);
		const rows = await ctx.db
			.query("savedRoutes")
			.withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
			.order("desc")
			.collect();

		return rows.flatMap((row) => {
			const payload = remotePayloadFromRow(row);

			return payload ? [payload] : [];
		});
	},
});

export const upsert = mutation({
	args: {
		savedRoute: remoteSavedRoutePayloadValidator,
	},
	handler: async (ctx, args) => {
		const userId = await getAuthenticatedUserId(ctx);
		const savedRoute = validateRemoteSavedRoutePayload(args.savedRoute);

		if (!savedRoute) {
			throw new Error("Saved route payload is invalid.");
		}

		const existingRoute = await ctx.db
			.query("savedRoutes")
			.withIndex("by_user_routeId", (q) =>
				q.eq("userId", userId).eq("routeId", savedRoute.id),
			)
			.unique();
		const now = Date.now();

		if (existingRoute) {
			await ctx.db.replace(existingRoute._id, {
				userId,
				routeId: savedRoute.id,
				createdAtMs: savedRoute.createdAtMs,
				updatedAtMs: now,
				routeJson: savedRoute.routeJson,
			});
			return { inserted: false };
		}

		await ctx.db.insert("savedRoutes", {
			userId,
			routeId: savedRoute.id,
			createdAtMs: savedRoute.createdAtMs,
			updatedAtMs: now,
			routeJson: savedRoute.routeJson,
		});

		return { inserted: true };
	},
});

export const remove = mutation({
	args: {
		routeId: v.string(),
	},
	handler: async (ctx, args) => {
		const userId = await getAuthenticatedUserId(ctx);

		if (args.routeId.trim().length === 0) {
			throw new Error("Saved route id is required.");
		}

		const existingRoute = await ctx.db
			.query("savedRoutes")
			.withIndex("by_user_routeId", (q) =>
				q.eq("userId", userId).eq("routeId", args.routeId),
			)
			.unique();

		if (!existingRoute) {
			return { deleted: false };
		}

		await ctx.db.delete(existingRoute._id);
		return { deleted: true };
	},
});

export const mergeLocalRoutes = mutation({
	args: {
		savedRoutes: v.array(v.any()),
	},
	handler: async (ctx, args) => {
		const userId = await getAuthenticatedUserId(ctx);

		if (args.savedRoutes.length > maxMergeRouteCount) {
			throw new Error(`Cannot merge more than ${maxMergeRouteCount} routes.`);
		}

		const seenRouteIds = new Set<string>();
		let inserted = 0;
		let skipped = 0;
		let invalid = 0;
		let duplicate = 0;
		const now = Date.now();
		const existingRoutes = await ctx.db
			.query("savedRoutes")
			.withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
			.collect();
		const existingRouteIds = new Set(
			existingRoutes.map((route) => route.routeId),
		);

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

			if (existingRouteIds.has(savedRoute.id)) {
				skipped += 1;
				continue;
			}

			await ctx.db.insert("savedRoutes", {
				userId,
				routeId: savedRoute.id,
				createdAtMs: savedRoute.createdAtMs,
				updatedAtMs: now,
				routeJson: savedRoute.routeJson,
			});
			existingRouteIds.add(savedRoute.id);
			inserted += 1;
		}

		return { inserted, skipped, invalid, duplicate };
	},
});
