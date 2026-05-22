import type { PlannerPageContext } from "./planner-page-context.svelte";

export function createPlannerOverlayController(context: PlannerPageContext) {
	return context.overlays;
}

export type PlannerOverlayController = ReturnType<
	typeof createPlannerOverlayController
>;
