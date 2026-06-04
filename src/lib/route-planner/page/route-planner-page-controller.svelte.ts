import { createPlannerAnalysisController } from "./planner-analysis-controller.svelte";
import { createPlannerFormController } from "./planner-form-controller.svelte";
import { createPlannerImportExportController } from "./planner-import-export-controller.svelte";
import { createPlannerMapController } from "./planner-map-controller.svelte";
import { createPlannerOverlayController } from "./planner-overlay-controller.svelte";
import { createPlannerOverlayCache } from "./planner-overlay-cache";
import { createPlannerRoutesController } from "./planner-routes-controller.svelte";
import { createPlannerRuntime } from "./planner-runtime.svelte";
import { createPlannerSaveController } from "./planner-save-controller.svelte";
import { createPlannerSharingController } from "./planner-sharing-controller.svelte";
import type { PlannerAnalysisController as PlannerAnalysisImplementation } from "./planner-analysis-controller.svelte";
import type { PlannerFormController as PlannerFormImplementation } from "./planner-form-controller.svelte";
import type { PlannerImportExportController as PlannerImportExportImplementation } from "./planner-import-export-controller.svelte";
import type { PlannerMapController as PlannerMapImplementation } from "./planner-map-controller.svelte";
import type { PlannerOverlayController as PlannerOverlayImplementation } from "./planner-overlay-controller.svelte";
import type { PlannerRoutesController as PlannerRoutesImplementation } from "./planner-routes-controller.svelte";
import type { PlannerRuntime } from "./planner-runtime.svelte";
import type { PlannerSaveController as PlannerSaveImplementation } from "./planner-save-controller.svelte";
import type { PlannerSharingController as PlannerSharingImplementation } from "./planner-sharing-controller.svelte";

function omitControllerKeys<
	T extends object,
	const K extends readonly (keyof T)[],
>(controller: T, keys: K): Omit<T, K[number]> {
	const descriptors = { ...Object.getOwnPropertyDescriptors(controller) };

	for (const key of keys) {
		delete descriptors[key as keyof typeof descriptors];
	}

	return Object.defineProperties({}, descriptors) as Omit<T, K[number]>;
}

export function createRoutePlannerPageController() {
	const cache = createPlannerOverlayCache();
	const graph = {} as {
		runtime: PlannerRuntime;
		form: PlannerFormImplementation;
		routes: PlannerRoutesImplementation;
		map: PlannerMapImplementation;
		importExport: PlannerImportExportImplementation;
		sharing: PlannerSharingImplementation;
		save: PlannerSaveImplementation;
		overlays: PlannerOverlayImplementation;
		analysis: PlannerAnalysisImplementation;
	};

	graph.form = createPlannerFormController({
		getFetch: () => graph.runtime.getFetch(),
		isRouting: () => graph.routes.isRouting,
		hasActiveRoute: () => Boolean(graph.routes.activeRoute),
		isLockedStopIndex: (index) => graph.routes.isLockedStopIndex(index),
		markPlannerEdited: (options) => graph.routes.markPlannerEdited(options),
		performRouteEdit: (editFn) => graph.routes.performRouteEdit(editFn),
		clearManualRouteState: () => graph.routes.clearManualRouteState(),
		closeMapClickMenu: () => graph.map.closeMapClickMenu(),
		useCurrentLocationAsStop: (field) =>
			graph.map.useCurrentLocationAsStop(field),
	});

	graph.routes = createPlannerRoutesController({
		getFetch: () => graph.runtime.getFetch(),
		getPlannerFormState: () => graph.form.getPlannerFormState(),
		applyPlannerFormState: (form) => graph.form.applyPlannerFormState(form),
		getFieldErrors: () => graph.form.fieldErrors,
		setFieldErrors: (errors) => graph.form.setFieldErrors(errors),
		clearFieldErrors: () => graph.form.setFieldErrors({}),
		closeCompletionMenu: () => graph.form.closeCompletionMenu(),
		closeMapClickMenu: () => graph.map.closeMapClickMenu(),
		resetAnalysisState: () => graph.analysis.resetActiveProfile(),
		cancelAutosaveTimer: () => graph.save.cancelAutosaveTimer(),
		scheduleActiveRouteAutosave: () => graph.save.scheduleActiveRouteAutosave(),
		bumpRouteSaveRevision: () => graph.save.bumpRouteSaveRevision(),
		captureSavedRouteEditMetadata: () =>
			graph.save.captureSavedRouteEditMetadata(),
		restoreSavedRouteEditMetadata: (metadata) =>
			graph.save.restoreSavedRouteEditMetadata(metadata),
		markUnsaved: () => graph.save.markUnsaved(),
		setPendingSavedRouteId: (id) => graph.save.setPendingSavedRouteId(id),
		setRouteImportError: (error) =>
			graph.importExport.setRouteImportError(error),
		setRouteExportError: (error) =>
			graph.importExport.setRouteExportError(error),
		clearRouteShareState: (routeKey) =>
			graph.sharing.clearRouteShareState(routeKey),
		getActiveRouteShareKey: () => graph.sharing.activeRouteShareKey,
		applyWorkoutPlanTarget: () => graph.form.applyWorkoutPlanTarget(),
		validateDistanceInputs: () => graph.form.validateDistanceInputs(),
	});

	graph.save = createPlannerSaveController({
		isDestroyed: () => graph.runtime.isDestroyed(),
		getRouteNeedsRecalculation: () => graph.routes.routeNeedsRecalculation,
		getActiveRoute: () => graph.routes.activeRoute,
		getActiveRouteForSaving: () => graph.routes.getActiveRouteForSaving(),
		setSingleRouteState: (route) => graph.routes.setSingleRouteState(route),
		setLastGeneratedRouteCount: (count) =>
			graph.routes.setLastGeneratedRouteCount(count),
		syncStopsFromRoute: (route) => graph.routes.syncStopsFromRoute(route),
		setRouteNeedsRecalculation: (value) =>
			graph.routes.setRouteNeedsRecalculation(value),
		setRouteRequestError: (value) => graph.routes.setRouteRequestError(value),
		clearFieldErrors: () => graph.form.setFieldErrors({}),
		resetAnalysisState: () => graph.analysis.resetActiveProfile(),
		clearRouteEditHistory: () => graph.routes.clearRouteEditHistory(),
	});

	graph.analysis = createPlannerAnalysisController({
		getActiveRoute: () => graph.routes.activeRoute,
		getRouteAlternatives: () => graph.routes.routeAlternatives,
		cache,
	});

	graph.overlays = createPlannerOverlayController({
		getActiveRoute: () => graph.routes.activeRoute,
		getRouteAlternatives: () => graph.routes.routeAlternatives,
		getSelectedRouteIndex: () => graph.routes.selectedRouteIndex,
		getAvoidedRoads: () => graph.routes.avoidedRoads,
		getLockedSegmentIndexes: () => graph.routes.lockedSegmentIndexes,
		setLockedSegmentIndexes: (indexes) =>
			graph.routes.setLockedSegmentIndexes(indexes),
		syncActiveRouteManualEditing: (indexes) =>
			graph.routes.syncActiveRouteManualEditing(indexes),
		getActiveRouteClimbs: () => graph.analysis.activeRouteClimbs,
		getHighlightedRouteCoordinate: () =>
			graph.analysis.highlightedRouteCoordinate,
		cache,
	});

	graph.map = createPlannerMapController({
		getFetch: () => graph.runtime.getFetch(),
		getActiveRoute: () => graph.routes.activeRoute,
		getPlannerMode: () => graph.form.plannerMode,
		getWaypointStops: () => graph.form.waypointStops,
		getStartStop: () => graph.form.startStop,
		getDestinationStop: () => graph.form.destinationStop,
		setFieldStop: (field, stop) => graph.form.setFieldStop(field, stop),
		setWaypointStop: (index, stop) => graph.form.setWaypointStop(index, stop),
		addWaypoint: (stop, index, recordHistory) =>
			graph.form.addWaypoint(stop, index, recordHistory),
		removeWaypoint: (index, recordHistory) =>
			graph.form.removeWaypoint(index, recordHistory),
		closeCompletionMenu: () => graph.form.closeCompletionMenu(),
		performRouteEdit: (editFn) => graph.routes.performRouteEdit(editFn),
		performAsyncRouteEdit: (editFn, options) =>
			graph.routes.performAsyncRouteEdit(editFn, options),
		rerouteAfterManualEdit: () => graph.routes.rerouteAfterManualEdit(),
		isLockedStopIndex: (index) => graph.routes.isLockedStopIndex(index),
		getRouteNeedsRecalculation: () => graph.routes.routeNeedsRecalculation,
		getIsRouting: () => graph.routes.isRouting,
		getLockedSegmentIndexes: () => graph.routes.lockedSegmentIndexes,
		setLockedSegmentIndexes: (indexes) =>
			graph.routes.setLockedSegmentIndexes(indexes),
		syncActiveRouteManualEditing: (indexes) =>
			graph.routes.syncActiveRouteManualEditing(indexes),
		getAvoidedRoads: () => graph.routes.avoidedRoads,
		setAvoidedRoads: (avoidances) => graph.routes.setAvoidedRoads(avoidances),
		markPlannerEdited: (options) => graph.routes.markPlannerEdited(options),
		scheduleActiveRouteAutosave: () => graph.save.scheduleActiveRouteAutosave(),
		setRouteRequestError: (error) => graph.routes.setRouteRequestError(error),
	});

	graph.importExport = createPlannerImportExportController({
		getActiveRoute: () => graph.routes.activeRoute,
		getRouteNeedsRecalculation: () => graph.routes.routeNeedsRecalculation,
		closeCompletionMenu: () => graph.form.closeCompletionMenu(),
		closeMapClickMenu: () => graph.map.closeMapClickMenu(),
		setSingleRouteState: (route) => graph.routes.setSingleRouteState(route),
		setLastGeneratedRouteCount: (count) =>
			graph.routes.setLastGeneratedRouteCount(count),
		syncStopsFromRoute: (route) => graph.routes.syncStopsFromRoute(route),
		markImportedRouteReplaced: () => graph.save.markReplaced(),
		setRouteNeedsRecalculation: (value) =>
			graph.routes.setRouteNeedsRecalculation(value),
		setRouteRequestError: (value) => graph.routes.setRouteRequestError(value),
		clearFieldErrors: () => graph.form.setFieldErrors({}),
		resetAnalysisState: () => graph.analysis.resetActiveProfile(),
		clearRouteEditHistory: () => graph.routes.clearRouteEditHistory(),
		bumpRouteSaveRevision: () => graph.save.bumpRouteSaveRevision(),
		scheduleActiveRouteAutosave: () => graph.save.scheduleActiveRouteAutosave(),
	});

	graph.sharing = createPlannerSharingController({
		getActiveRoute: () => graph.routes.activeRoute,
		getRouteNeedsRecalculation: () => graph.routes.routeNeedsRecalculation,
		getPlannerDraftRouteId: () => graph.save.plannerDraftRouteId,
		getActiveSavedRouteId: () => graph.save.activeSavedRouteId,
		getBrowserWindow: () => graph.runtime.getWindow(),
		saveActiveRouteDraft: (options) => graph.save.saveActiveRouteDraft(options),
	});

	graph.runtime = createPlannerRuntime({
		resetSpatialConstraintDefaults: () =>
			graph.form.resetSpatialConstraintDefaults(),
		restoreSavedRouteFromLocation: (location) =>
			graph.save.restoreSavedRouteFromLocation(location),
		handleRouteEditKeydown: (event) =>
			graph.routes.handleRouteEditKeydown(event),
	});

	function destroy() {
		graph.save.cancelAutosaveTimer();
		graph.form.destroy();
		graph.runtime.destroy();
	}

	return {
		mount: graph.runtime.mount,
		destroy,
		form: omitControllerKeys(graph.form, [
			"setFieldErrors",
			"validateDistanceInputs",
			"applyWorkoutPlanTarget",
			"destroy",
		] as const),
		routes: omitControllerKeys(graph.routes, [
			"handleRouteEditKeydown",
			"getActiveRouteForSaving",
			"setRouteRequestError",
			"setRouteNeedsRecalculation",
			"setLastGeneratedRouteCount",
			"setLockedSegmentIndexes",
			"setAvoidedRoads",
			"clearManualRouteState",
		] as const),
		map: omitControllerKeys(graph.map, ["useCurrentLocationAsStop"] as const),
		importExport: omitControllerKeys(graph.importExport, [
			"setRouteImportError",
			"setRouteExportError",
		] as const),
		sharing: omitControllerKeys(graph.sharing, [
			"setRouteShareError",
			"setRouteShareUrl",
			"setRouteShareCopied",
			"clearRouteShareState",
		] as const),
		save: omitControllerKeys(graph.save, [
			"routeSaveRevision",
			"bumpRouteSaveRevision",
			"markUnsaved",
			"markReplaced",
			"setPendingSavedRouteId",
			"captureSavedRouteEditMetadata",
			"restoreSavedRouteEditMetadata",
		] as const),
		overlays: graph.overlays,
		analysis: omitControllerKeys(graph.analysis, [
			"highlightedRouteCoordinate",
			"resetActiveProfile",
		] as const),
	};
}

export type RoutePlannerPageController = ReturnType<
	typeof createRoutePlannerPageController
>;
export type PlannerFormController = RoutePlannerPageController["form"];
export type PlannerRoutesController = RoutePlannerPageController["routes"];
export type PlannerMapController = RoutePlannerPageController["map"];
export type PlannerImportExportController =
	RoutePlannerPageController["importExport"];
export type PlannerSharingController = RoutePlannerPageController["sharing"];
export type PlannerSaveController = RoutePlannerPageController["save"];
export type PlannerOverlayController = RoutePlannerPageController["overlays"];
export type PlannerAnalysisController = RoutePlannerPageController["analysis"];
