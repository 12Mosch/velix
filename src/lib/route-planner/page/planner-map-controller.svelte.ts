import type { PlannerPageContext } from "./planner-page-context.svelte";

export function createPlannerMapController(context: PlannerPageContext) {
	return context.map;
}

export type PlannerMapController = ReturnType<
	typeof createPlannerMapController
>;
