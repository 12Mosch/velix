import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { plannedRouteValidator } from "../lib/saved-route-convex-validators";
import {
	optionalDistanceUnitValidator,
	optionalMapStyleValidator,
	optionalThemeModeValidator,
} from "./userPreferenceValidators";

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
	savedRouteVersions: defineTable({
		userId: v.string(),
		routeId: v.string(),
		versionId: v.string(),
		capturedAtMs: v.number(),
		createdAtMs: v.number(),
		routeJson: v.string(),
	})
		.index("by_user_route_capturedAt", ["userId", "routeId", "capturedAtMs"])
		.index("by_user_route_version", ["userId", "routeId", "versionId"]),
	sharedRoutes: defineTable({
		shareToken: v.string(),
		ownerUserId: v.string(),
		sourceRouteId: v.optional(v.string()),
		createdAtMs: v.number(),
		routeJson: v.string(),
	})
		.index("by_shareToken", ["shareToken"])
		.index("by_owner_createdAt", ["ownerUserId", "createdAtMs"]),
	paidUpstreamRateLimits: defineTable({
		bucket: v.union(
			v.literal("route"),
			v.literal("suggestion"),
			v.literal("reverse"),
		),
		subjectHash: v.string(),
		count: v.number(),
		resetAtMs: v.number(),
		updatedAtMs: v.number(),
	})
		.index("by_bucket_subject", ["bucket", "subjectHash"])
		.index("by_resetAtMs", ["resetAtMs"]),
	userPreferences: defineTable({
		userId: v.string(),
		themeMode: optionalThemeModeValidator,
		mapStyle: optionalMapStyleValidator,
		distanceUnit: optionalDistanceUnitValidator,
		createdAtMs: v.number(),
		updatedAtMs: v.number(),
	}).index("by_user", ["userId"]),
});
