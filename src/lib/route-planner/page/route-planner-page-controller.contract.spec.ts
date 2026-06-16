import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteApiError } from "$lib/route-planning";

import { createPlannerRoutesController } from "./planner-routes-controller.svelte";
import { createRoutePlannerPageController } from "./route-planner-page-controller.svelte";
import { createPlannerStop, type PlannerFormState } from "./planner-state";

const formKeys = [
	"plannerMode",
	"startStop",
	"waypointStops",
	"destinationStop",
	"roundCourseTargetKind",
	"roundCourseDistanceInput",
	"roundCourseDistanceMetersInput",
	"roundCourseDurationInput",
	"roundCourseAscendMeters",
	"workoutPlanInput",
	"workoutPlanError",
	"spatialConstraintKind",
	"spatialConstraintEnforcement",
	"constraintCenterStop",
	"areaRadiusInput",
	"corridorWidthInput",
	"areaRadiusMetersInput",
	"corridorWidthMetersInput",
	"formattedInputDistanceUnit",
	"fieldErrors",
	"advancedOpen",
	"completionController",
	"isRoundCourseMode",
	"isOutAndBackMode",
	"hasAdvancedErrors",
	"getPlannerFormState",
	"applyPlannerFormState",
	"setPlannerMode",
	"getDestinationFieldLabel",
	"getDestinationSuggestionsLabel",
	"getDestinationPlaceholder",
	"getCurrentLocationDestinationLabel",
	"getSubmitButtonText",
	"resetSpatialConstraintDefaults",
	"updateRoundCourseTargetKind",
	"updateRoundCourseDistanceInput",
	"updateRoundCourseDuration",
	"updateRoundCourseAscend",
	"updateWorkoutPlanInput",
	"updateSpatialConstraintKind",
	"updateSpatialConstraintEnforcement",
	"setConstraintCenterStop",
	"updateConstraintCenterInput",
	"updateAreaRadiusInput",
	"updateCorridorWidthInput",
	"closeCompletionMenu",
	"setFieldStop",
	"setWaypointStop",
	"handleFieldInput",
	"updateField",
	"getWaypointError",
	"clearWaypointError",
	"updateWaypoint",
	"handleWaypointInput",
	"addWaypoint",
	"removeWaypoint",
	"canMoveWaypoint",
	"moveWaypoint",
	"useCurrentLocationAsStop",
] as const;

const routesKeys = [
	"routeRequestError",
	"isRouting",
	"routeAlternatives",
	"selectedRouteIndex",
	"routeNeedsRecalculation",
	"lockedSegmentIndexes",
	"avoidedRoads",
	"lastGeneratedRouteCount",
	"fitInitialSavedRouteBounds",
	"activeRouteWindAnalysisLoading",
	"undoStack",
	"redoStack",
	"activeRoute",
	"activeDirections",
	"activeTurnCount",
	"activeRoundCourseTarget",
	"activeImportedRouteSource",
	"alternativeInfoMessage",
	"canUndoRouteEdit",
	"canRedoRouteEdit",
	"getPlannerRouteState",
	"applyPlannerRouteState",
	"syncStopsFromRoute",
	"syncActiveRouteManualEditing",
	"setRouteAlternativesState",
	"setSingleRouteState",
	"selectRouteAlternative",
	"markPlannerEdited",
	"captureRouteEditSnapshot",
	"performRouteEdit",
	"performAsyncRouteEdit",
	"undoRouteEdit",
	"redoRouteEdit",
	"clearRouteEditHistory",
	"removeAvoidedRoad",
	"requestRouteCalculation",
	"ensureActiveRouteWindAnalysis",
	"rerouteAfterManualEdit",
	"isLockedStopIndex",
	"handleGenerateRoute",
] as const;

const mapKeys = [
	"mapClickSelection",
	"isResolvingMapSelection",
	"currentLocation",
	"currentLocationFocusKey",
	"recenterRouteRequestKey",
	"isLocating",
	"currentLocationError",
	"selectedBasemap",
	"availableBasemapOptions",
	"showCurrentLocationOnMap",
	"recenterActiveRoute",
	"closeMapClickMenu",
	"handleMapClick",
	"getMapClickMenuTitle",
	"getMapClickMenuSubtitle",
	"getRemoveActionLabel",
	"removeSelectedMapStop",
	"getSelectedSegmentIndex",
	"isMapSelectionSegmentLocked",
	"toggleMapSelectionSegmentLock",
	"getAvoidanceForSelection",
	"isMapSelectionRoadAvoided",
	"toggleMapSelectionRoadAvoidance",
	"getMapWaypointInsertionSegmentIndex",
	"isMapWaypointInsertionLocked",
	"applyMapPointAsStop",
	"handleRouteStopDragEnd",
	"handleRouteSegmentDragEnd",
	"chooseBasemap",
] as const;

const importExportKeys = [
	"routeImportError",
	"isImportingGpx",
	"routeExportError",
	"gpxImportInput",
	"handleExportGpx",
	"handleExportFit",
	"openGpxImportPicker",
	"handleGpxImportSelection",
] as const;

const sharingKeys = [
	"routeShareErrors",
	"routeShareUrls",
	"isSharingRoute",
	"activeRouteShareCopied",
	"activeRouteShareKey",
	"activeRouteShareError",
	"activeRouteShareUrl",
	"isActiveRouteShareCopied",
	"handleShareActiveRoute",
] as const;

const saveKeys = [
	"saveSyncError",
	"activeSavedRouteId",
	"plannerDraftRouteId",
	"isActiveRouteSaved",
	"pendingSavedRouteId",
	"cancelAutosaveTimer",
	"getActiveRouteForSaving",
	"saveActiveRouteDraft",
	"scheduleActiveRouteAutosave",
	"restoreSavedRouteFromLocation",
	"restorePendingSavedRoute",
	"restoreSavedRoute",
	"handleSaveDraft",
] as const;

const overlayKeys = [
	"gradientOverlayEnabled",
	"windOverlayEnabled",
	"trafficStressOverlayEnabled",
	"activeRouteGradientGeoJson",
	"canShowGradientOverlay",
	"activeRouteWindGeoJson",
	"canShowWindOverlay",
	"canLoadWindOverlay",
	"activeRouteWindAnalysisLoading",
	"windDataUnavailable",
	"toggleWindOverlay",
	"activeRouteTrafficStressGeoJson",
	"canShowTrafficStressOverlay",
	"routeOverlays",
	"constraintOverlay",
	"avoidanceOverlay",
	"activeRouteSegmentCount",
	"sanitizedLockedSegmentIndexes",
	"lockedSegmentOverlay",
	"combinedRouteBounds",
	"highlightedRouteCoordinate",
] as const;

const analysisKeys = [
	"directionsOpen",
	"routeAnalysisOpen",
	"selectedCueIndex",
	"selectedCueFocusKey",
	"lastCueRouteKey",
	"selectedCue",
	"activeProfileIndex",
	"chartScrubPointerId",
	"activeRouteClimbs",
	"activeRouteGradientMetrics",
	"activeRouteGradientSections",
	"notableGradientSections",
	"activeRouteQuality",
	"activeTrainingSuitability",
	"routeAlternativeQualities",
	"activeWindSummary",
	"strongestWindSegments",
	"activeCategorizedClimbs",
	"activeKeyClimbs",
	"hardestClimb",
	"surfaceMix",
	"activeWarnings",
	"activeReadinessWarnings",
	"activeProviderWarnings",
	"primaryActiveWarning",
	"elevationSamples",
	"chartH",
	"elevMin",
	"elevMax",
	"elevRange",
	"sampledProfileDistanceTotal",
	"chartProfilePoints",
	"activeProfilePoint",
	"linePoints",
	"areaD",
	"distanceTickLabels",
	"getWarningContainerClass",
	"getWarningBadgeClass",
	"selectCue",
	"getWindSegmentDistanceRange",
	"formatCueSegmentTime",
	"handleChartPointerDown",
	"handleChartPointerMove",
	"handleChartPointerLeave",
	"releaseChartScrub",
	"handleChartLostPointerCapture",
] as const;

function expectKeys<T extends object>(
	slice: T,
	keys: readonly (keyof T & string)[],
) {
	expect(Object.keys(slice).sort(), "public slice keys").toEqual(
		[...keys].sort(),
	);
}

function expectWritable(slice: object, key: string) {
	const descriptor = Object.getOwnPropertyDescriptor(slice, key);

	expect(descriptor?.set, key).toEqual(expect.any(Function));
}

function createDeferredResponse(body: unknown) {
	let resolve!: () => void;
	const promise = new Promise<Response>((deferredResolve) => {
		resolve = () => deferredResolve(new Response(JSON.stringify(body)));
	});

	return { promise, resolve };
}

function createTestPlannerFormState(): PlannerFormState {
	return {
		plannerMode: "point_to_point",
		startStop: createPlannerStop("Munich"),
		waypointStops: [],
		destinationStop: createPlannerStop("Schliersee"),
		roundCourseTargetKind: "distance",
		roundCourseDistanceInput: "50",
		roundCourseDistanceMetersInput: 50000,
		roundCourseDurationInput: "",
		roundCourseAscendMeters: "",
		roundCourseWorkoutTarget: null,
		spatialConstraintKind: "none",
		spatialConstraintEnforcement: "preferred",
		constraintCenterStop: createPlannerStop(),
		areaRadiusInput: "30",
		corridorWidthInput: "12",
		areaRadiusMetersInput: 30000,
		corridorWidthMetersInput: 12000,
		fieldErrors: {},
	};
}

describe("route planner page controller contract", () => {
	const controllers: ReturnType<typeof createRoutePlannerPageController>[] = [];

	afterEach(() => {
		for (const controller of controllers.splice(0)) {
			controller.destroy();
		}
	});

	function createController() {
		const controller = createRoutePlannerPageController();

		controllers.push(controller);

		return controller;
	}

	it("creates all public controller slices", () => {
		const controller = createController();

		expect(controller.mount).toEqual(expect.any(Function));
		expect(controller.destroy).toEqual(expect.any(Function));
		expect(controller.form).toBeTruthy();
		expect(controller.routes).toBeTruthy();
		expect(controller.map).toBeTruthy();
		expect(controller.importExport).toBeTruthy();
		expect(controller.sharing).toBeTruthy();
		expect(controller.save).toBeTruthy();
		expect(controller.overlays).toBeTruthy();
		expect(controller.analysis).toBeTruthy();
	});

	it("keeps the component-facing slice keys stable", () => {
		const controller = createController();

		expectKeys(controller.form, formKeys);
		expectKeys(controller.routes, routesKeys);
		expectKeys(controller.map, mapKeys);
		expectKeys(controller.importExport, importExportKeys);
		expectKeys(controller.sharing, sharingKeys);
		expectKeys(controller.save, saveKeys);
		expectKeys(controller.overlays, overlayKeys);
		expectKeys(controller.analysis, analysisKeys);
	});

	it("keeps writable slice properties writable", () => {
		const controller = createController();

		expectWritable(controller.form, "advancedOpen");
		expectWritable(controller.importExport, "gpxImportInput");
		expectWritable(controller.analysis, "directionsOpen");
		expectWritable(controller.analysis, "routeAnalysisOpen");
		expectWritable(controller.overlays, "gradientOverlayEnabled");
		expectWritable(controller.overlays, "windOverlayEnabled");
		expectWritable(controller.overlays, "trafficStressOverlayEnabled");
	});

	it("ignores stale route generation responses after planner edits", async () => {
		const routeDeferred = createDeferredResponse({
			routes: [],
			selectedRouteIndex: 0,
		});
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockImplementation(() => routeDeferred.promise);
		let formState = createTestPlannerFormState();
		let fieldErrors: NonNullable<RouteApiError["fieldErrors"]> = {};
		const applyPlannerFormState = vi.fn((form: PlannerFormState) => {
			formState = form;
		});
		const scheduleActiveRouteAutosave = vi.fn();
		const bumpRouteSaveRevision = vi.fn();

		const routes = createPlannerRoutesController({
			getFetch: () => fetchMock,
			getPlannerFormState: () => formState,
			applyPlannerFormState,
			getFieldErrors: () => fieldErrors,
			setFieldErrors: (errors) => {
				fieldErrors = errors;
			},
			clearFieldErrors: () => {
				fieldErrors = {};
			},
			closeCompletionMenu: vi.fn(),
			closeMapClickMenu: vi.fn(),
			resetAnalysisState: vi.fn(),
			cancelAutosaveTimer: vi.fn(),
			scheduleActiveRouteAutosave,
			bumpRouteSaveRevision,
			captureSavedRouteEditMetadata: () => ({
				activeSavedRouteId: null,
				plannerDraftRouteId: null,
				pendingSavedRouteId: null,
				pendingSavedRouteRestoreRevision: null,
				isActiveRouteSaved: false,
			}),
			restoreSavedRouteEditMetadata: vi.fn(),
			markUnsaved: vi.fn(),
			setPendingSavedRouteId: vi.fn(),
			setRouteImportError: vi.fn(),
			setRouteExportError: vi.fn(),
			clearRouteShareState: vi.fn(),
			getActiveRouteShareKey: () => null,
			applyWorkoutPlanTarget: () => true,
			validateDistanceInputs: () => true,
		});

		const routeEffect = routes.handleGenerateRoute({
			preventDefault: vi.fn(),
		} as unknown as SubmitEvent);
		const routePromise = Effect.runPromise(routeEffect);
		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);

		formState = {
			...formState,
			destinationStop: createPlannerStop("Garmisch"),
		};
		routes.markPlannerEdited();
		routeDeferred.resolve();
		await routePromise;

		expect(formState.destinationStop.label).toBe("Garmisch");
		expect(routes.routeAlternatives).toEqual([]);
		expect(routes.routeNeedsRecalculation).toBe(false);
		expect(routes.routeRequestError).toBeNull();
		expect(applyPlannerFormState).not.toHaveBeenCalled();
		expect(scheduleActiveRouteAutosave).not.toHaveBeenCalled();
		expect(bumpRouteSaveRevision).not.toHaveBeenCalled();
		expect(routes.isRouting).toBe(false);
	});
});
