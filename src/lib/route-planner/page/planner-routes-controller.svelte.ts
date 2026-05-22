import type { PlannerPageContext } from "./planner-page-context.svelte";

export function createPlannerRoutesController(context: PlannerPageContext) {
	return context.routes;
}

export type PlannerRoutesController = ReturnType<
	typeof createPlannerRoutesController
>;
