import { v } from "convex/values";

import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	cloneRoute,
	isRecord,
	normalizePlannedRoute,
	type SavedRoute,
} from "../lib/saved-routes-core";

const maxMergeRouteCount = 200;

type ValidatedSavedRoute = SavedRoute & {
	createdAtMs: number;
};

async function getAuthenticatedUserId(ctx: QueryCtx | MutationCtx) {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new Error("Authentication is required to sync saved routes.");
	}

	return identity.subject;
}

function validateSavedRoutePayload(value: unknown): ValidatedSavedRoute | null {
	if (!isRecord(value)) {
		return null;
	}

	const id = typeof value.id === "string" ? value.id.trim() : "";
	const createdAtMs =
		typeof value.createdAt === "string" ? Date.parse(value.createdAt) : NaN;
	const route = normalizePlannedRoute(value.route);

	if (
		id.length === 0 ||
		typeof value.createdAt !== "string" ||
		!Number.isFinite(createdAtMs) ||
		!route
	) {
		return null;
	}

	return {
		id,
		createdAt: new Date(createdAtMs).toISOString(),
		createdAtMs,
		route: cloneRoute(route),
	};
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

		return rows.map((row) => ({
			id: row.routeId,
			createdAt: new Date(row.createdAtMs).toISOString(),
			route: row.route,
		}));
	},
});

export const upsert = mutation({
	args: {
		savedRoute: v.any(),
	},
	handler: async (ctx, args) => {
		const userId = await getAuthenticatedUserId(ctx);
		const savedRoute = validateSavedRoutePayload(args.savedRoute);

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
			await ctx.db.patch(existingRoute._id, {
				createdAtMs: savedRoute.createdAtMs,
				updatedAtMs: now,
				route: savedRoute.route,
			});
			return { inserted: false };
		}

		await ctx.db.insert("savedRoutes", {
			userId,
			routeId: savedRoute.id,
			createdAtMs: savedRoute.createdAtMs,
			updatedAtMs: now,
			route: savedRoute.route,
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
			const savedRoute = validateSavedRoutePayload(candidateRoute);

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
				route: savedRoute.route,
			});
			existingRouteIds.add(savedRoute.id);
			inserted += 1;
		}

		return { inserted, skipped, invalid, duplicate };
	},
});
