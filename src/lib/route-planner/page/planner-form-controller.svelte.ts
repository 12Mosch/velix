import type { PlannerPageContext } from "./planner-page-context.svelte";

export function createPlannerFormController(context: PlannerPageContext) {
	return context.form;
}

export type PlannerFormController = ReturnType<
	typeof createPlannerFormController
>;
