import type {
	PlannerAnalysisController,
	PlannerImportExportController,
	PlannerRoutesController,
	PlannerSaveController,
	PlannerSharingController,
} from "$lib/route-planner/page/route-planner-page-controller.svelte";

export type RouteResultDockChromeView = {
	directionsOpen: boolean;
	routeAnalysisOpen: boolean;
	isRouting: boolean;
	isImportingGpx: boolean;
	routeAlternatives: PlannerRoutesController["routeAlternatives"];
	selectedRouteIndex: PlannerRoutesController["selectedRouteIndex"];
	routeNeedsRecalculation: boolean;
	avoidedRoads: PlannerRoutesController["avoidedRoads"];
	routeExportError: PlannerImportExportController["routeExportError"];
	isSharingRoute: boolean;
	saveSyncError: PlannerSaveController["saveSyncError"];
	isActiveRouteSaved: boolean;
	selectedCueIndex: PlannerAnalysisController["selectedCueIndex"];
	isRoundCourseMode: boolean;
	isOutAndBackMode: boolean;
	activeRoute: PlannerRoutesController["activeRoute"];
	activeDirections: PlannerRoutesController["activeDirections"];
	activeTurnCount: PlannerRoutesController["activeTurnCount"];
	activeRouteShareError: PlannerSharingController["activeRouteShareError"];
	activeRouteShareUrl: PlannerSharingController["activeRouteShareUrl"];
	isActiveRouteShareCopied: boolean;
	activeRoundCourseTarget: PlannerRoutesController["activeRoundCourseTarget"];
	activeImportedRouteSource: PlannerRoutesController["activeImportedRouteSource"];
	alternativeInfoMessage: PlannerRoutesController["alternativeInfoMessage"];
	canUndoRouteEdit: boolean;
	canRedoRouteEdit: boolean;
	routeActionsDisabled: boolean;
};
