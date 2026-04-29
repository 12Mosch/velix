import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { plannedRouteValidator } from "../lib/saved-route-convex-validators";

export default defineSchema({
	savedRoutes: defineTable({
		userId: v.string(),
		routeId: v.string(),
		createdAtMs: v.number(),
		updatedAtMs: v.number(),
		route: plannedRouteValidator,
	})
		.index("by_user_createdAt", ["userId", "createdAtMs"])
		.index("by_user_routeId", ["userId", "routeId"]),
});
