import type { PlannerPageContext } from "./planner-page-context.svelte";

export function createPlannerSaveController(context: PlannerPageContext) {
	return context.save;
}

export type PlannerSaveController = ReturnType<
	typeof createPlannerSaveController
>;
