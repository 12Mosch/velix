import { v } from "convex/values";
import { Effect } from "effect";

import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { runConvexEffect, tryConvexPromise } from "./effect";

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

class UserPreferencesAuthenticationError extends Error {
	readonly _tag = "UserPreferencesAuthenticationError";

	constructor() {
		super("Authentication is required to sync user preferences.");
	}
}

function getAuthenticatedUserIdEffect(
	ctx: QueryCtx | MutationCtx,
): Effect.Effect<string, Error | UserPreferencesAuthenticationError> {
	return tryConvexPromise(
		() => ctx.auth.getUserIdentity(),
		"Could not read authenticated user.",
	).pipe(
		Effect.flatMap((identity) =>
			identity
				? Effect.succeed(identity.subject)
				: Effect.fail(new UserPreferencesAuthenticationError()),
		),
	);
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

function getPreferenceRowEffect(ctx: QueryCtx | MutationCtx, userId: string) {
	return tryConvexPromise(
		() =>
			ctx.db
				.query("userPreferences")
				.withIndex("by_user", (q) => q.eq("userId", userId))
				.unique(),
		"Could not read user preferences.",
	);
}

export function getForCurrentUserHandler(ctx: QueryCtx) {
	return runConvexEffect(
		Effect.gen(function* () {
			const userId = yield* getAuthenticatedUserIdEffect(ctx);
			const row = yield* getPreferenceRowEffect(ctx, userId);

			return row ? snapshotFromRow(row) : null;
		}),
	);
}

export function upsertForCurrentUserHandler(
	ctx: MutationCtx,
	args: {
		preferences: {
			themeMode?: "system" | "light" | "dark";
			mapStyle?:
				| "stadia-alidade-smooth"
				| "stadia-alidade-smooth-dark"
				| "stadia-stamen-terrain"
				| "maptiler-satellite-hybrid"
				| "maptiler-outdoor";
			distanceUnit?: "km" | "mi";
		};
	},
) {
	return runConvexEffect(
		Effect.gen(function* () {
			const userId = yield* getAuthenticatedUserIdEffect(ctx);
			const existingPreferences = yield* getPreferenceRowEffect(ctx, userId);
			const now = Date.now();

			if (existingPreferences) {
				yield* tryConvexPromise(
					() =>
						ctx.db.patch(existingPreferences._id, {
							...args.preferences,
							updatedAtMs: now,
						}),
					"Could not update user preferences.",
				);
				return { inserted: false };
			}

			yield* tryConvexPromise(
				() =>
					ctx.db.insert("userPreferences", {
						userId,
						...args.preferences,
						createdAtMs: now,
						updatedAtMs: now,
					}),
				"Could not insert user preferences.",
			);

			return { inserted: true };
		}),
	);
}

export const getForCurrentUser = query({
	args: {},
	handler: getForCurrentUserHandler,
});

export const upsertForCurrentUser = mutation({
	args: {
		preferences: v.object({
			themeMode: v.optional(themeModeValidator),
			mapStyle: v.optional(mapStyleValidator),
			distanceUnit: v.optional(distanceUnitValidator),
		}),
	},
	handler: upsertForCurrentUserHandler,
});
