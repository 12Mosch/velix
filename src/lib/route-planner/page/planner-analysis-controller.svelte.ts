import type { PlannerPageContext } from "./planner-page-context.svelte";

export function createPlannerAnalysisController(context: PlannerPageContext) {
	return context.analysis;
}

export type PlannerAnalysisController = ReturnType<
	typeof createPlannerAnalysisController
>;
