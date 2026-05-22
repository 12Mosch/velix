import type { PlannerPageContext } from "./planner-page-context.svelte";

export function createPlannerImportExportController(
	context: PlannerPageContext,
) {
	return context.importExport;
}

export type PlannerImportExportController = ReturnType<
	typeof createPlannerImportExportController
>;
