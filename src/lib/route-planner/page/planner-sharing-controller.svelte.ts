import type { PlannerPageContext } from "./planner-page-context.svelte";

export function createPlannerSharingController(context: PlannerPageContext) {
	return context.sharing;
}

export type PlannerSharingController = ReturnType<
	typeof createPlannerSharingController
>;
