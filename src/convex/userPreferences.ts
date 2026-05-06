import { v } from "convex/values";

import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

const themeModeValidator = v.union(
	v.literal("system"),
	v.literal("light"),
	v.literal("dark"),
);
const mapStyleValidator = v.union(
	v.literal("stadia-alidade-smooth"),
	v.literal("stadia-alidade-smooth-dark"),
	v.literal("stadia-stamen-terrain"),
	v.literal("maptiler-satellite-hybrid"),
	v.literal("maptiler-outdoor"),
);
const distanceUnitValidator = v.union(v.literal("km"), v.literal("mi"));

async function getAuthenticatedUserId(ctx: QueryCtx | MutationCtx) {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new Error("Authentication is required to sync user preferences.");
	}

	return identity.subject;
}

async function getPreferenceRow(ctx: QueryCtx | MutationCtx, userId: string) {
	return await ctx.db
		.query("userPreferences")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.unique();
}

function snapshotFromRow(row: {
	themeMode?: "system" | "light" | "dark";
	mapStyle?:
		| "stadia-alidade-smooth"
		| "stadia-alidade-smooth-dark"
		| "stadia-stamen-terrain"
		| "maptiler-satellite-hybrid"
		| "maptiler-outdoor";
	distanceUnit?: "km" | "mi";
	createdAtMs: number;
	updatedAtMs: number;
}) {
	return {
		themeMode: row.themeMode,
		mapStyle: row.mapStyle,
		distanceUnit: row.distanceUnit,
		createdAtMs: row.createdAtMs,
		updatedAtMs: row.updatedAtMs,
	};
}

export const getForCurrentUser = query({
	args: {},
	handler: async (ctx) => {
		const userId = await getAuthenticatedUserId(ctx);
		const row = await getPreferenceRow(ctx, userId);

		return row ? snapshotFromRow(row) : null;
	},
});

export const upsertForCurrentUser = mutation({
	args: {
		preferences: v.object({
			themeMode: v.optional(themeModeValidator),
			mapStyle: v.optional(mapStyleValidator),
			distanceUnit: v.optional(distanceUnitValidator),
		}),
	},
	handler: async (ctx, args) => {
		const userId = await getAuthenticatedUserId(ctx);
		const existingPreferences = await getPreferenceRow(ctx, userId);
		const now = Date.now();

		if (existingPreferences) {
			await ctx.db.patch(existingPreferences._id, {
				...args.preferences,
				updatedAtMs: now,
			});
			return { inserted: false };
		}

		await ctx.db.insert("userPreferences", {
			userId,
			...args.preferences,
			createdAtMs: now,
			updatedAtMs: now,
		});

		return { inserted: true };
	},
});
