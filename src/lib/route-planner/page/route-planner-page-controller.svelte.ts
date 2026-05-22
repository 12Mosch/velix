import { createPlannerAnalysisController } from "./planner-analysis-controller.svelte";
import { createPlannerFormController } from "./planner-form-controller.svelte";
import { createPlannerImportExportController } from "./planner-import-export-controller.svelte";
import { createPlannerMapController } from "./planner-map-controller.svelte";
import { createPlannerPageContext } from "./planner-page-context.svelte";
import { createPlannerOverlayController } from "./planner-overlay-controller.svelte";
import { createPlannerRoutesController } from "./planner-routes-controller.svelte";
import { createPlannerSaveController } from "./planner-save-controller.svelte";
import { createPlannerSharingController } from "./planner-sharing-controller.svelte";

export function createRoutePlannerPageController() {
	const context = createPlannerPageContext();

	return {
		mount: context.mount,
		destroy: context.destroy,
		form: createPlannerFormController(context),
		routes: createPlannerRoutesController(context),
		map: createPlannerMapController(context),
		importExport: createPlannerImportExportController(context),
		sharing: createPlannerSharingController(context),
		save: createPlannerSaveController(context),
		overlays: createPlannerOverlayController(context),
		analysis: createPlannerAnalysisController(context),
	};
}

export type RoutePlannerPageController = ReturnType<
	typeof createRoutePlannerPageController
>;
export type { PlannerFormController } from "./planner-form-controller.svelte";
export type { PlannerRoutesController } from "./planner-routes-controller.svelte";
export type { PlannerMapController } from "./planner-map-controller.svelte";
export type { PlannerImportExportController } from "./planner-import-export-controller.svelte";
export type { PlannerSharingController } from "./planner-sharing-controller.svelte";
export type { PlannerSaveController } from "./planner-save-controller.svelte";
export type { PlannerOverlayController } from "./planner-overlay-controller.svelte";
export type { PlannerAnalysisController } from "./planner-analysis-controller.svelte";
