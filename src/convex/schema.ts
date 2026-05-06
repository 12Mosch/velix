import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { plannedRouteValidator } from "../lib/saved-route-convex-validators";

export default defineSchema({
	savedRoutes: defineTable({
		userId: v.string(),
		routeId: v.string(),
		createdAtMs: v.number(),
		updatedAtMs: v.number(),
		routeJson: v.optional(v.string()),
		route: v.optional(plannedRouteValidator),
	})
		.index("by_user_createdAt", ["userId", "createdAtMs"])
		.index("by_user_routeId", ["userId", "routeId"]),
	userPreferences: defineTable({
		userId: v.string(),
		themeMode: v.optional(
			v.union(v.literal("system"), v.literal("light"), v.literal("dark")),
		),
		mapStyle: v.optional(
			v.union(
				v.literal("stadia-alidade-smooth"),
				v.literal("stadia-alidade-smooth-dark"),
				v.literal("stadia-stamen-terrain"),
				v.literal("maptiler-satellite-hybrid"),
				v.literal("maptiler-outdoor"),
			),
		),
		distanceUnit: v.optional(v.union(v.literal("km"), v.literal("mi"))),
		createdAtMs: v.number(),
		updatedAtMs: v.number(),
	}).index("by_user", ["userId"]),
});
