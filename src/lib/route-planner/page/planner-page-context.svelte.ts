import { env } from "$env/dynamic/public";
import { api } from "../../../convex/_generated/api";
import type { FeatureCollection } from "geojson";
import { getOptionalConvexClient } from "$lib/convex-client.svelte";
import { getBasemapById } from "$lib/map/basemaps";
import { parseRouteGpx, RouteGpxImportError } from "$lib/route-gpx-import";
import { downloadRouteFit, downloadRouteGpx } from "$lib/route-export";
import {
	basemapOptions,
	mapStylePreference,
	setMapStylePreference,
	type BasemapId,
} from "$lib/map-style-settings.svelte";
import {
	formatDistance,
	formatDistanceInput,
	initUnitPreference,
	parseDistanceInputToMeters,
	unitPreference,
} from "$lib/unit-settings.svelte";
import {
	deleteSavedRoute,
	getSavedRouteById,
	initSavedRoutes,
	isPlannedRoute,
	savedRoutesState,
	type SavedRoute,
	upsertSavedRoute,
} from "$lib/saved-routes.svelte";
import { serializeSavedRouteForRemote } from "$lib/saved-routes-core";
import {
	buildShareUrl,
	copyTextToClipboard,
	generateShareToken,
} from "$lib/shared-routes";
import {
	buildRouteGeoJson,
	buildRouteClimbGeoJson,
	buildRouteGradientGeoJson,
	buildRouteSurfaceGeoJson,
	buildRouteWindGeoJson,
	buildLockedSegmentGeoJson,
	buildRouteAvoidanceGeoJson,
	buildSpatialConstraintGeoJson,
	analyzeRouteClimbs,
	calculateRouteGradientMetrics,
	getRouteElevationAnalysisPoints,
	getRouteLegIndexForCoordinateSegment,
	getRouteSegmentCount,
	getRouteTurnCount,
	getProviderWarnings,
	getReadinessWarnings,
	getRouteWarnings,
	getSurfaceMix,
	getWindSummary,
	getWaypointInsertionIndex,
	isImportedRoute,
	isRouteStopLocked,
	mergeRouteBounds,
	sampleElevationProfile,
	sanitizeLockedSegmentIndexes,
	type ManualRouteEditingState,
	type PlannedRoute,
	type ResolvedRouteAvoidance,
	type RouteApiError,
	type RouteApiSuccess,
	type RouteMapOverlay,
	type RouteClimb,
	type RouteGradientMetrics,
	type RouteRequestPayload,
	type RouteWarning,
	type RouteWindSegment,
	type SpatialConstraintEnforcement,
} from "$lib/route-planning";
import {
	chartW,
	completionDebounceMs,
	constraintCenterCompletionTarget,
	defaultAreaRadiusMeters,
	defaultCorridorWidthMeters,
	defaultSpatialConstraintEnforcement,
	destinationCompletionTarget,
	desiredAlternativeRoutes,
	maxRouteEditHistoryEntries,
	maxWaypoints,
	minCompletionQueryLength,
	minRoundCourseDistanceMeters,
	padY,
	startCompletionTarget,
} from "$lib/route-planner/constants";
import {
	formatCoordinateLabel,
	formatDuration,
	formatExactDistance,
} from "$lib/route-planner/formatters";
import type {
	CurrentLocation,
	MapClickSelection,
	PlannerMode,
	PlannerStop,
	ReverseGeocodeApiSuccess,
	RouteEditSnapshot,
	RouteEditSnapshotOptions,
	RouteField,
	RouteSegmentDragEnd,
	RouteStopDragEnd,
	RoundCourseTargetKind,
	SelectedMapStop,
	SpatialConstraintKind,
} from "$lib/route-planner/types";
import {
	buildCurrentRouteRequest as buildPlannerCurrentRouteRequest,
	captureRouteEditSnapshot as capturePlannerRouteEditSnapshot,
	createPlannerStop,
	getActiveRouteForSaving as getSaveableActiveRoute,
	getAvoidanceRequest as getPlannerAvoidanceRequest,
	getDefaultSpatialConstraintState,
	getManualEditingRequest as getPlannerManualEditingRequest,
	getRoundCourseTarget,
	getRouteShareSignature,
	hydratePlannerStateFromRoute,
	pruneRouteShareState,
	restoreRouteEditSnapshot as restorePlannerSnapshot,
	validatePlannerForm as runPlannerValidation,
	withAvoidancesState,
	withManualEditingState,
	withPlannerRouteState,
	type PlannerFormState,
	type PlannerRouteState,
} from "$lib/route-planner/page/planner-state";
import {
	createPlannerCompletionController,
	getWaypointCompletionTarget,
} from "$lib/route-planner/page/planner-completion.svelte";
import {
	buildAvoidancePlaceholderPolygon,
	findAvoidanceNearSelection,
} from "$lib/route-planner/page/map-selection";

export function createPlannerPageContext() {
	let directionsOpen = $state(false);
	let selectedCueIndex = $state<number | null>(null);
	let selectedCueFocusKey = $state(0);
	let lastCueRouteKey = $state<string | null>(null);

	const convexClient = getOptionalConvexClient();

	function getWarningContainerClass(warning: RouteWarning): string {
		if (warning.severity === "info") {
			return "border-border/40 bg-secondary/45 text-foreground";
		}

		return warning.severity === "warning"
			? "border-amber-600/30 bg-amber-500/12 text-amber-950 dark:text-amber-100"
			: "border-amber-500/20 bg-amber-500/8 text-amber-900 dark:text-amber-100";
	}

	function getWarningBadgeClass(warning: RouteWarning): string {
		if (warning.severity === "info") {
			return "border-border/40 bg-background/70 text-muted-foreground";
		}

		return "border-amber-500/25 bg-amber-500/10 text-amber-900 dark:text-amber-100";
	}

	let routeAnalysisOpen = $state(false);
	let gradientOverlayEnabled = $state(false);
	let windOverlayEnabled = $state(false);
	let plannerMode = $state<PlannerMode>("point_to_point");
	let startStop = $state<PlannerStop>(createPlannerStop());
	let waypointStops = $state<PlannerStop[]>([]);
	let destinationStop = $state<PlannerStop>(createPlannerStop());
	let roundCourseTargetKind = $state<RoundCourseTargetKind>("distance");
	let roundCourseDistanceInput = $state("");
	let roundCourseDistanceMetersInput = $state<number | null>(null);
	let roundCourseDurationInput = $state("");
	let roundCourseAscendMeters = $state("");
	let spatialConstraintKind = $state<SpatialConstraintKind>("none");
	let spatialConstraintEnforcement = $state<SpatialConstraintEnforcement>(
		defaultSpatialConstraintEnforcement,
	);
	let constraintCenterStop = $state<PlannerStop>(createPlannerStop());
	let areaRadiusInput = $state("");
	let corridorWidthInput = $state("");
	let areaRadiusMetersInput = $state<number | null>(defaultAreaRadiusMeters);
	let corridorWidthMetersInput = $state<number | null>(
		defaultCorridorWidthMeters,
	);
	let formattedInputDistanceUnit = $state<string | null>(null);
	let routeRequestError = $state<string | null>(null);
	let routeImportError = $state<string | null>(null);
	let fieldErrors = $state<NonNullable<RouteApiError["fieldErrors"]>>({});
	let isRouting = $state(false);
	let isImportingGpx = $state(false);
	let routeAlternatives = $state<PlannedRoute[]>([]);
	let selectedRouteIndex = $state<number | null>(null);
	let lockedSegmentIndexes = $state<number[]>([]);
	let avoidedRoads = $state<ResolvedRouteAvoidance[]>([]);
	let lastGeneratedRouteCount = $state<number | null>(null);
	let routeExportError = $state<string | null>(null);
	let routeShareErrors = $state<Record<string, string | null>>({});
	let routeShareUrls = $state<Record<string, string | null>>({});
	let isSharingRoute = $state(false);
	let activeRouteShareCopied = $state<Record<string, boolean>>({});
	let saveSyncError = $state<string | null>(null);
	let activeSavedRouteId = $state<string | null>(null);
	let plannerDraftRouteId = $state<string | null>(null);
	let isActiveRouteSaved = $state(false);
	let pendingSavedRouteId = $state<string | null>(null);
	let clientFetch = $state<typeof window.fetch | null>(null);
	let activeProfileIndex = $state<number | null>(null);
	let chartScrubPointerId = $state<number | null>(null);
	let mapClickSelection = $state<MapClickSelection | null>(null);
	let isResolvingMapSelection = $state(false);
	let currentLocation = $state<CurrentLocation | null>(null);
	let currentLocationFocusKey = $state(0);
	let recenterRouteRequestKey = $state(0);
	let fitInitialSavedRouteBounds = $state(false);
	let isLocating = $state(false);
	let currentLocationError = $state<string | null>(null);
	let gpxImportInput = $state<HTMLInputElement | null>(null);
	let undoStack = $state<RouteEditSnapshot[]>([]);
	let redoStack = $state<RouteEditSnapshot[]>([]);
	let advancedOpen = $state(false);

	const autosaveDebounceMs = 750;
	const minRoundCourseDurationMs = 15 * 60 * 1000;
	const minRoundCourseAscendMeters = 50;

	type AsyncRouteEditResult = "committed" | "noop" | "rollback";

	type CachedRouteOverlayGeoJson = {
		signature: string;
		baseGeoJson: FeatureCollection;
		surfaceGeoJson?: FeatureCollection;
		climbGeoJsonBySignature: Map<string, FeatureCollection>;
		gradientMetrics?: RouteGradientMetrics;
		gradientGeoJson?: FeatureCollection;
		windSignature?: string;
		windGeoJson?: FeatureCollection;
	};

	type SavedRouteEditMetadata = {
		activeSavedRouteId: string | null;
		plannerDraftRouteId: string | null;
		pendingSavedRouteId: string | null;
		isActiveRouteSaved: boolean;
	};

	const routeOverlayGeoJsonCache = new WeakMap<
		PlannedRoute,
		CachedRouteOverlayGeoJson
	>();

	let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
	let routeSaveRevision = 0;
	let lastAutosavedRouteId: string | null = null;
	let lastAutosavedRevision: number | null = null;
	let browserWindow: Window | null = null;
	let detachRouteEditKeyboardListener = () => {};
	const completionController = createPlannerCompletionController(
		() => clientFetch,
		{
			debounceMs: completionDebounceMs,
			minQueryLength: minCompletionQueryLength,
			getValue: (target) => {
				if (target.kind === "startQuery") {
					return startStop.label;
				}

				if (target.kind === "destinationQuery") {
					return destinationStop.label;
				}

				if (target.kind === "constraintCenter") {
					return constraintCenterStop.label;
				}

				return waypointStops[target.index]?.label ?? "";
			},
			onSelect: (target, suggestion) => {
				const selectedStop = createPlannerStop(
					suggestion.label,
					suggestion.point,
					"suggestion",
				);

				if (target.kind === "waypoint") {
					setWaypointStop(target.index, selectedStop);
				} else if (target.kind === "constraintCenter") {
					setConstraintCenterStop(selectedStop);
				} else {
					setFieldStop(target.kind, selectedStop);
				}
			},
			onError: (error) => {
				console.error("Failed to load route suggestions", error);
			},
		},
	);

	function getPlannerFormState(): PlannerFormState {
		return {
			plannerMode,
			startStop,
			waypointStops,
			destinationStop,
			roundCourseTargetKind,
			roundCourseDistanceInput,
			roundCourseDistanceMetersInput,
			roundCourseDurationInput,
			roundCourseAscendMeters,
			spatialConstraintKind,
			spatialConstraintEnforcement,
			constraintCenterStop,
			areaRadiusInput,
			corridorWidthInput,
			areaRadiusMetersInput,
			corridorWidthMetersInput,
			fieldErrors,
		};
	}

	function getPlannerRouteState(): PlannerRouteState {
		return {
			routeAlternatives,
			selectedRouteIndex,
			lockedSegmentIndexes,
			avoidedRoads,
			lastGeneratedRouteCount,
		};
	}

	function applyPlannerFormState(form: PlannerFormState) {
		plannerMode = form.plannerMode;
		startStop = form.startStop;
		waypointStops = form.waypointStops;
		destinationStop = form.destinationStop;
		roundCourseTargetKind = form.roundCourseTargetKind;
		roundCourseDistanceInput = form.roundCourseDistanceInput;
		roundCourseDistanceMetersInput = form.roundCourseDistanceMetersInput;
		roundCourseDurationInput = form.roundCourseDurationInput;
		roundCourseAscendMeters = form.roundCourseAscendMeters;
		spatialConstraintKind = form.spatialConstraintKind;
		spatialConstraintEnforcement = form.spatialConstraintEnforcement;
		constraintCenterStop = form.constraintCenterStop;
		areaRadiusInput = form.areaRadiusInput;
		corridorWidthInput = form.corridorWidthInput;
		areaRadiusMetersInput = form.areaRadiusMetersInput;
		corridorWidthMetersInput = form.corridorWidthMetersInput;
		fieldErrors = form.fieldErrors;
	}

	function applyPlannerRouteState(state: PlannerRouteState) {
		routeAlternatives = state.routeAlternatives;
		selectedRouteIndex = state.selectedRouteIndex;
		lockedSegmentIndexes = state.lockedSegmentIndexes;
		avoidedRoads = state.avoidedRoads;
		lastGeneratedRouteCount = state.lastGeneratedRouteCount;
	}

	function formatSignatureNumber(value: number | undefined, precision: number) {
		return Number.isFinite(value) ? Number(value).toFixed(precision) : "";
	}

	function getCoordinateSignature(
		coordinate: PlannedRoute["coordinates"][number] | undefined,
	) {
		if (!coordinate) {
			return "";
		}

		return [
			formatSignatureNumber(coordinate[0], 6),
			formatSignatureNumber(coordinate[1], 6),
			formatSignatureNumber(coordinate[2], 1),
		].join(",");
	}

	function getCoordinateFingerprint(route: PlannedRoute) {
		let hash = 2166136261;

		for (const coordinate of route.coordinates) {
			for (const value of [
				Math.round((coordinate[0] ?? 0) * 1_000_000),
				Math.round((coordinate[1] ?? 0) * 1_000_000),
				Math.round((coordinate[2] ?? 0) * 10),
			]) {
				hash ^= value;
				hash = Math.imul(hash, 16777619) >>> 0;
			}
		}

		const middleIndex = Math.floor(route.coordinates.length / 2);

		return [
			route.coordinates.length,
			getCoordinateSignature(route.coordinates[0]),
			getCoordinateSignature(route.coordinates[middleIndex]),
			getCoordinateSignature(route.coordinates[route.coordinates.length - 1]),
			hash.toString(36),
		].join("|");
	}

	function getRouteSourceSignature(route: PlannedRoute) {
		if (route.source.kind === "gpx_import") {
			return [
				route.source.kind,
				route.source.filename,
				route.source.stopDerivation,
				route.source.hasDuration ? "1" : "0",
			].join(":");
		}

		return route.source.kind;
	}

	function getRouteWaypointSignature(route: PlannedRoute) {
		return route.waypoints
			.map(
				(waypoint) =>
					`${waypoint.label}:${getCoordinateSignature(waypoint.coordinate)}`,
			)
			.join(";");
	}

	function getRouteOverlaySignature(route: PlannedRoute): string {
		return [
			route.mode,
			getRouteSourceSignature(route),
			route.startLabel,
			route.destinationLabel,
			getRouteWaypointSignature(route),
			getCoordinateFingerprint(route),
			formatSignatureNumber(route.distanceMeters, 1),
			formatSignatureNumber(route.durationMs, 0),
			formatSignatureNumber(route.ascendMeters, 1),
			formatSignatureNumber(route.descendMeters, 1),
			route.surfaceDetails.length,
			route.smoothnessDetails.length,
			route.windAnalysis?.segments.length ?? 0,
		].join("||");
	}

	function getRouteClimbOverlaySignature(
		route: PlannedRoute,
		climbs: RouteClimb[],
	): string {
		return [
			getRouteOverlaySignature(route),
			climbs.length,
			climbs
				.map((climb) =>
					[
						formatSignatureNumber(climb.startDistanceMeters, 1),
						formatSignatureNumber(climb.endDistanceMeters, 1),
						climb.rawStartIndex,
						climb.rawEndIndex,
						climb.category,
						climb.isKeyClimb ? "1" : "0",
					].join(":"),
				)
				.join(";"),
		].join("||");
	}

	function getRouteWindOverlaySignature(route: PlannedRoute): string {
		return [
			getRouteOverlaySignature(route),
			route.windAnalysis?.segments.length ?? 0,
			route.windAnalysis?.segments
				.map((segment) =>
					[
						segment.from,
						segment.to,
						segment.bucket,
						formatSignatureNumber(segment.speedKmh, 1),
						formatSignatureNumber(segment.directionDegrees, 1),
						formatSignatureNumber(segment.routeBearingDegrees, 1),
						formatSignatureNumber(segment.relativeAngleDegrees, 1),
						formatSignatureNumber(segment.headwindComponentKmh, 1),
						formatSignatureNumber(segment.crosswindComponentKmh, 1),
					].join(":"),
				)
				.join(";") ?? "",
		].join("||");
	}

	function getCachedRouteOverlayGeoJson(
		route: PlannedRoute,
	): CachedRouteOverlayGeoJson {
		const signature = getRouteOverlaySignature(route);
		const cached = routeOverlayGeoJsonCache.get(route);

		if (cached?.signature === signature) {
			return cached;
		}

		const nextCached: CachedRouteOverlayGeoJson = {
			signature,
			baseGeoJson: buildRouteGeoJson(route),
			climbGeoJsonBySignature: new Map(),
		};
		routeOverlayGeoJsonCache.set(route, nextCached);

		return nextCached;
	}

	function getCachedBaseRouteGeoJson(route: PlannedRoute): FeatureCollection {
		return getCachedRouteOverlayGeoJson(route).baseGeoJson;
	}

	function getCachedSurfaceRouteGeoJson(
		route: PlannedRoute,
	): FeatureCollection {
		const cached = getCachedRouteOverlayGeoJson(route);

		cached.surfaceGeoJson ??= buildRouteSurfaceGeoJson(route);

		return cached.surfaceGeoJson;
	}

	function getCachedClimbRouteGeoJson(
		route: PlannedRoute,
		climbs: RouteClimb[],
	): FeatureCollection {
		const cached = getCachedRouteOverlayGeoJson(route);
		const climbSignature = getRouteClimbOverlaySignature(route, climbs);
		const cachedClimbGeoJson =
			cached.climbGeoJsonBySignature.get(climbSignature);

		if (cachedClimbGeoJson) {
			return cachedClimbGeoJson;
		}

		const climbGeoJson = buildRouteClimbGeoJson(route, climbs);
		cached.climbGeoJsonBySignature.set(climbSignature, climbGeoJson);

		return climbGeoJson;
	}

	function getCachedGradientRouteGeoJson(
		route: PlannedRoute,
	): FeatureCollection {
		const cached = getCachedRouteOverlayGeoJson(route);

		cached.gradientGeoJson ??= buildRouteGradientGeoJson(route);

		return cached.gradientGeoJson;
	}

	function getCachedRouteGradientMetrics(
		route: PlannedRoute,
	): RouteGradientMetrics {
		const cached = getCachedRouteOverlayGeoJson(route);

		cached.gradientMetrics ??= calculateRouteGradientMetrics(route);

		return cached.gradientMetrics;
	}

	function getCachedWindRouteGeoJson(route: PlannedRoute): FeatureCollection {
		const cached = getCachedRouteOverlayGeoJson(route);
		const windSignature = getRouteWindOverlaySignature(route);

		if (cached.windGeoJson && cached.windSignature === windSignature) {
			return cached.windGeoJson;
		}

		cached.windGeoJson = buildRouteWindGeoJson(route);
		cached.windSignature = windSignature;

		return cached.windGeoJson;
	}

	const selectedBasemap = $derived(
		mapStylePreference.selectedBasemapId
			? getBasemapById(mapStylePreference.selectedBasemapId)
			: null,
	);
	const availableBasemapOptions = $derived(
		basemapOptions.filter((basemap) => basemap.available),
	);
	const isRoundCourseMode = $derived(plannerMode === "round_course");
	const isOutAndBackMode = $derived(plannerMode === "out_and_back");
	const activeRoute = $derived(
		selectedRouteIndex === null
			? null
			: (routeAlternatives[selectedRouteIndex] ?? null),
	);
	const activeDirections = $derived(activeRoute?.instructions ?? []);
	const activeTurnCount = $derived(
		activeRoute ? getRouteTurnCount(activeRoute) : 0,
	);
	const selectedCue = $derived(
		selectedCueIndex === null
			? null
			: (activeDirections[selectedCueIndex] ?? null),
	);
	const activeRouteShareKey = $derived(
		activeRoute
			? (plannerDraftRouteId ??
					activeSavedRouteId ??
					getRouteShareSignature(activeRoute))
			: null,
	);
	const activeRouteShareError = $derived(
		activeRouteShareKey
			? (routeShareErrors[activeRouteShareKey] ?? null)
			: null,
	);
	const activeRouteShareUrl = $derived(
		activeRouteShareKey ? (routeShareUrls[activeRouteShareKey] ?? null) : null,
	);
	const isActiveRouteShareCopied = $derived(
		activeRouteShareKey
			? Boolean(activeRouteShareCopied[activeRouteShareKey])
			: false,
	);
	const activeRoundCourseTarget = $derived(getRoundCourseTarget(activeRoute));
	const activeRouteClimbs = $derived<RouteClimb[]>(
		activeRoute
			? analyzeRouteClimbs(
					getRouteElevationAnalysisPoints(activeRoute.coordinates),
				)
			: [],
	);
	const activeRouteGradientMetrics = $derived(
		activeRoute ? getCachedRouteGradientMetrics(activeRoute) : null,
	);
	const activeRouteGradientGeoJson = $derived(
		activeRoute && (gradientOverlayEnabled || activeRouteGradientMetrics)
			? getCachedGradientRouteGeoJson(activeRoute)
			: null,
	);
	const canShowGradientOverlay = $derived(
		activeRoute
			? getCachedGradientRouteGeoJson(activeRoute).features.length > 0
			: false,
	);
	const activeRouteWindGeoJson = $derived(
		activeRoute?.windAnalysis &&
			(windOverlayEnabled || activeRoute.windAnalysis.segments.length > 0)
			? getCachedWindRouteGeoJson(activeRoute)
			: null,
	);
	const canShowWindOverlay = $derived(
		activeRoute?.windAnalysis
			? getCachedWindRouteGeoJson(activeRoute).features.length > 0
			: false,
	);
	const activeWindSummary = $derived(
		activeRoute ? getWindSummary(activeRoute) : null,
	);
	const strongestWindSegments = $derived(
		activeRoute?.windAnalysis
			? [...activeRoute.windAnalysis.segments]
					.sort(
						(left, right) =>
							Math.max(
								Math.abs(right.headwindComponentKmh),
								Math.abs(right.crosswindComponentKmh),
							) -
							Math.max(
								Math.abs(left.headwindComponentKmh),
								Math.abs(left.crosswindComponentKmh),
							),
					)
					.slice(0, 5)
			: [],
	);
	const activeCategorizedClimbs = $derived(
		activeRouteClimbs.filter((climb) => climb.category !== "Uncategorized"),
	);
	const activeKeyClimbs = $derived(
		activeRouteClimbs.filter((climb) => climb.isKeyClimb),
	);
	const hardestClimb = $derived(
		activeRouteClimbs.reduce<RouteClimb | null>(
			(hardest, climb) =>
				!hardest || climb.score > hardest.score ? climb : hardest,
			null,
		),
	);
	const routeOverlays = $derived<RouteMapOverlay[]>(
		routeAlternatives.map((route, index) => {
			const isSelected = index === selectedRouteIndex;
			const baseGeoJson = getCachedBaseRouteGeoJson(route);

			if (!isSelected) {
				return {
					id: `route-${index}`,
					geoJson: baseGeoJson,
					bounds: route.bounds,
					isSelected,
				};
			}

			const features = [...baseGeoJson.features];
			const surfaceGeoJson = getCachedSurfaceRouteGeoJson(route);

			if (surfaceGeoJson.features.length > 0) {
				features.push(...surfaceGeoJson.features);
			}

			const climbGeoJson = getCachedClimbRouteGeoJson(route, activeRouteClimbs);

			if (climbGeoJson.features.length > 0) {
				features.push(...climbGeoJson.features);
			}

			if (gradientOverlayEnabled && activeRouteGradientGeoJson) {
				features.push(...activeRouteGradientGeoJson.features);
			}

			if (windOverlayEnabled && activeRouteWindGeoJson) {
				features.push(...activeRouteWindGeoJson.features);
			}

			return {
				id: `route-${index}`,
				geoJson: {
					...baseGeoJson,
					features,
				},
				bounds: route.bounds,
				isSelected,
			};
		}),
	);
	const constraintOverlay = $derived(
		activeRoute?.spatialConstraint
			? buildSpatialConstraintGeoJson(activeRoute.spatialConstraint)
			: null,
	);
	const avoidanceOverlay = $derived(
		avoidedRoads.length > 0 ? buildRouteAvoidanceGeoJson(avoidedRoads) : null,
	);
	const activeRouteSegmentCount = $derived(
		activeRoute ? getRouteSegmentCount(activeRoute) : 0,
	);
	const sanitizedLockedSegmentIndexes = $derived(
		sanitizeLockedSegmentIndexes(lockedSegmentIndexes, activeRouteSegmentCount),
	);
	const lockedSegmentOverlay = $derived(
		activeRoute && sanitizedLockedSegmentIndexes.length > 0
			? buildLockedSegmentGeoJson(activeRoute, sanitizedLockedSegmentIndexes)
			: null,
	);
	const combinedRouteBounds = $derived(mergeRouteBounds(routeAlternatives));
	const surfaceMix = $derived(activeRoute ? getSurfaceMix(activeRoute) : []);
	const activeWarnings = $derived(
		activeRoute ? getRouteWarnings(activeRoute) : [],
	);
	const activeReadinessWarnings = $derived(
		activeRoute ? getReadinessWarnings(activeRoute) : [],
	);
	const activeProviderWarnings = $derived(
		activeRoute ? getProviderWarnings(activeRoute) : [],
	);
	const primaryActiveWarning = $derived(
		activeReadinessWarnings[0] ?? activeProviderWarnings[0] ?? null,
	);
	const activeImportedRouteSource = $derived(
		isImportedRoute(activeRoute) ? activeRoute.source : null,
	);
	const alternativeInfoMessage = $derived(
		lastGeneratedRouteCount !== null &&
			lastGeneratedRouteCount < desiredAlternativeRoutes
			? `Found ${lastGeneratedRouteCount} distinct route${lastGeneratedRouteCount === 1 ? "" : "s"} for this request.`
			: null,
	);
	const elevationSamples = $derived(
		activeRoute ? sampleElevationProfile(activeRoute.coordinates) : [],
	);
	const chartH = $derived(routeAnalysisOpen ? 72 : 44);
	const elevMin = $derived(
		elevationSamples.length > 0
			? Math.min(...elevationSamples.map((point) => point.elevationMeters))
			: 0,
	);
	const elevMax = $derived(
		elevationSamples.length > 0
			? Math.max(...elevationSamples.map((point) => point.elevationMeters))
			: 0,
	);
	const elevRange = $derived(Math.max(elevMax - elevMin, 1));
	const sampledProfileDistanceTotal = $derived(
		elevationSamples[elevationSamples.length - 1]?.distanceMeters ?? null,
	);
	const chartProfilePoints = $derived(
		elevationSamples.map((point) => {
			const x =
				elevationSamples.length > 1
					? (point.distanceMeters /
							Math.max(sampledProfileDistanceTotal ?? 1, 1)) *
						chartW
					: chartW / 2;
			const y = elevY(point.elevationMeters, chartH, padY);

			return {
				...point,
				x,
				y,
			};
		}),
	);
	const activeProfilePoint = $derived(
		activeProfileIndex === null
			? null
			: (chartProfilePoints[activeProfileIndex] ?? null),
	);
	const highlightedRouteCoordinate = $derived(
		selectedCue?.coordinate ?? activeProfilePoint?.coordinate ?? null,
	);
	const linePoints = $derived(
		chartProfilePoints.map((point) => `${point.x},${point.y}`).join(" "),
	);
	const areaD = $derived(
		linePoints
			? `M ${chartProfilePoints[0]?.x ?? 0},${chartH} L ${linePoints.replaceAll(" ", " L ")} L ${chartProfilePoints[chartProfilePoints.length - 1]?.x ?? chartW},${chartH} Z`
			: "",
	);
	const distanceTickLabels = $derived(
		activeRoute
			? [
					formatDistance(activeRoute.distanceMeters * 0.25),
					formatDistance(activeRoute.distanceMeters * 0.5),
					formatDistance(activeRoute.distanceMeters * 0.75),
					formatDistance(activeRoute.distanceMeters),
				]
			: [],
	);
	const canUndoRouteEdit = $derived(undoStack.length > 0 && !isRouting);
	const canRedoRouteEdit = $derived(redoStack.length > 0 && !isRouting);
	const hasAdvancedErrors = $derived(
		Boolean(
			fieldErrors.spatialConstraint ||
				fieldErrors.waypointQueries?.some(Boolean) ||
				(isRoundCourseMode &&
					roundCourseTargetKind !== "distance" &&
					fieldErrors.roundCourseTarget),
		),
	);

	$effect(() => {
		if (!activeRoute && routeAnalysisOpen) {
			routeAnalysisOpen = false;
		}
	});

	$effect(() => {
		const nextRouteKey = activeRoute
			? getRouteShareSignature(activeRoute)
			: null;

		if (!nextRouteKey && directionsOpen) {
			directionsOpen = false;
		}

		if (nextRouteKey !== lastCueRouteKey) {
			selectedCueIndex = null;
			lastCueRouteKey = nextRouteKey;
		}
	});

	$effect(() => {
		if (hasAdvancedErrors) {
			advancedOpen = true;
		}
	});

	$effect(() => {
		const keepKeys = new Set(
			savedRoutesState.savedRoutes.map((savedRoute) => savedRoute.id),
		);
		if (activeRouteShareKey) {
			keepKeys.add(activeRouteShareKey);
		}

		routeShareErrors = pruneRouteShareState(routeShareErrors, keepKeys);
		routeShareUrls = pruneRouteShareState(routeShareUrls, keepKeys);
		activeRouteShareCopied = pruneRouteShareState(
			activeRouteShareCopied,
			keepKeys,
		);
	});

	$effect(() => {
		if (gradientOverlayEnabled && !canShowGradientOverlay) {
			gradientOverlayEnabled = false;
		}
	});

	$effect(() => {
		if (windOverlayEnabled && !canShowWindOverlay) {
			windOverlayEnabled = false;
		}
	});

	$effect(() => {
		const nextLockedSegmentIndexes = sanitizedLockedSegmentIndexes;

		if (
			nextLockedSegmentIndexes.length !== lockedSegmentIndexes.length ||
			nextLockedSegmentIndexes.some(
				(index, itemIndex) => index !== lockedSegmentIndexes[itemIndex],
			)
		) {
			lockedSegmentIndexes = nextLockedSegmentIndexes;
			return;
		}

		syncActiveRouteManualEditing(nextLockedSegmentIndexes);
	});

	$effect(() => {
		if (!activeRoute || chartProfilePoints.length === 0) {
			activeProfileIndex = null;
			chartScrubPointerId = null;
			return;
		}

		if (
			activeProfileIndex !== null &&
			(activeProfileIndex < 0 ||
				activeProfileIndex >= chartProfilePoints.length)
		) {
			activeProfileIndex = null;
		}
	});

	$effect(() => {
		saveSyncError = savedRoutesState.syncError;
	});

	$effect(() => {
		if (!pendingSavedRouteId) {
			return;
		}

		savedRoutesState.savedRoutes;
		void restorePendingSavedRoute();
	});

	$effect(() => {
		const nextDistanceUnit = unitPreference.selectedDistanceUnit;

		if (
			!unitPreference.initialized ||
			formattedInputDistanceUnit === nextDistanceUnit
		) {
			return;
		}

		formattedInputDistanceUnit = nextDistanceUnit;

		if (roundCourseDistanceMetersInput !== null) {
			roundCourseDistanceInput = formatDistanceInput(
				roundCourseDistanceMetersInput,
			);
		}

		if (areaRadiusMetersInput !== null) {
			areaRadiusInput = formatDistanceInput(areaRadiusMetersInput);
		}

		if (corridorWidthMetersInput !== null) {
			corridorWidthInput = formatDistanceInput(corridorWidthMetersInput);
		}
	});

	function mount(nextWindow: Window) {
		browserWindow = nextWindow;
		clientFetch = nextWindow.fetch.bind(nextWindow);
		initUnitPreference();
		resetSpatialConstraintDefaults();
		void initSavedRoutes()
			.then(() => restoreSavedRouteFromLocation(nextWindow.location))
			.catch((error) => {
				console.error("Failed to initialize saved routes.", error);
			});
		const handleRouteEditKeydown = (event: KeyboardEvent) => {
			if (!isRouteEditKeyboardShortcutAllowed(event)) {
				return;
			}

			const key = event.key.toLowerCase();

			if ((event.metaKey || event.ctrlKey) && key === "z" && event.shiftKey) {
				event.preventDefault();
				redoRouteEdit();
				return;
			}

			if ((event.metaKey || event.ctrlKey) && key === "y") {
				event.preventDefault();
				redoRouteEdit();
				return;
			}

			if ((event.metaKey || event.ctrlKey) && key === "z") {
				event.preventDefault();
				undoRouteEdit();
			}
		};

		nextWindow.addEventListener("keydown", handleRouteEditKeydown);
		detachRouteEditKeyboardListener = () => {
			nextWindow.removeEventListener("keydown", handleRouteEditKeydown);
			detachRouteEditKeyboardListener = () => {};
		};
	}

	function destroy() {
		completionController.destroy();
		cancelAutosaveTimer();
		detachRouteEditKeyboardListener();
		browserWindow = null;
	}

	function getCurrentLocationUnavailableMessage() {
		return "Current location is unavailable. Check browser location permissions.";
	}

	function getCurrentPosition(): Promise<GeolocationPosition> {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			return Promise.reject(new Error("Geolocation is not supported."));
		}

		return new Promise((resolve, reject) => {
			navigator.geolocation.getCurrentPosition(resolve, reject, {
				enableHighAccuracy: true,
				timeout: 10000,
				maximumAge: 30000,
			});
		});
	}

	function getCurrentLocationStop(
		point: [number, number],
		label: string,
	): PlannerStop {
		return createPlannerStop(label, point, "currentLocation");
	}

	async function resolveCurrentLocationLabel(point: [number, number]) {
		if (!clientFetch) {
			return "Current location";
		}

		try {
			const response = await clientFetch(
				`/api/route/reverse?lat=${encodeURIComponent(String(point[1]))}&lng=${encodeURIComponent(String(point[0]))}`,
			);

			if (!response.ok) {
				throw new Error(
					`Reverse geocoding failed with status ${response.status}`,
				);
			}

			const payload =
				(await response.json()) as Partial<ReverseGeocodeApiSuccess>;
			return typeof payload.label === "string" &&
				payload.label.trim().length > 0
				? payload.label
				: "Current location";
		} catch (error) {
			console.error("Failed to reverse geocode current location", error);
			return "Current location";
		}
	}

	async function locateCurrentPosition(): Promise<CurrentLocation | null> {
		if (isLocating) {
			return null;
		}

		isLocating = true;
		currentLocationError = null;

		try {
			const position = await getCurrentPosition();
			const point: [number, number] = [
				position.coords.longitude,
				position.coords.latitude,
			];
			const nextLocation: CurrentLocation = {
				point,
				accuracyMeters:
					typeof position.coords.accuracy === "number" &&
					Number.isFinite(position.coords.accuracy)
						? position.coords.accuracy
						: undefined,
			};

			currentLocation = nextLocation;
			currentLocationFocusKey += 1;
			return nextLocation;
		} catch (error) {
			console.error("Failed to get current location", error);
			currentLocationError = getCurrentLocationUnavailableMessage();
			return null;
		} finally {
			isLocating = false;
		}
	}

	async function showCurrentLocationOnMap() {
		closeCompletionMenu();
		closeMapClickMenu();
		await locateCurrentPosition();
	}

	function recenterActiveRoute() {
		if (!activeRoute) {
			return;
		}

		closeCompletionMenu();
		closeMapClickMenu();
		recenterRouteRequestKey += 1;
	}

	function selectCue(index: number) {
		selectedCueIndex = index;
		selectedCueFocusKey += 1;
	}

	function getWindSegmentDistanceRange(
		route: PlannedRoute,
		segment: RouteWindSegment,
	): string {
		const segmentCount = Math.max(route.coordinates.length - 1, 1);
		const fromDistance = (route.distanceMeters * segment.from) / segmentCount;
		const toDistance = (route.distanceMeters * segment.to) / segmentCount;

		return `${formatExactDistance(fromDistance)}-${formatExactDistance(toDistance)}`;
	}

	function formatCueSegmentTime(ms: number): string {
		if (!Number.isFinite(ms) || ms <= 0) {
			return "0 min";
		}

		return formatDuration(ms);
	}

	function getDestinationFieldLabel() {
		return isOutAndBackMode ? "Turnaround" : "Destination";
	}

	function getDestinationSuggestionsLabel() {
		return `${getDestinationFieldLabel()} suggestions`;
	}

	function getDestinationPlaceholder() {
		return isOutAndBackMode ? "Turnaround point..." : "Destination...";
	}

	function getCurrentLocationDestinationLabel() {
		return isOutAndBackMode
			? "Use current location as turnaround"
			: "Use current location as destination";
	}

	function getSubmitButtonText() {
		if (isRouting) {
			if (isRoundCourseMode) {
				return "Calculating round course...";
			}

			if (isOutAndBackMode) {
				return "Calculating out and back...";
			}

			return "Calculating route...";
		}

		if (isRoundCourseMode) {
			return "Generate Round Course";
		}

		if (isOutAndBackMode) {
			return "Generate Out and Back";
		}

		return "Generate Route";
	}

	function resetSpatialConstraintDefaults() {
		const defaults = getDefaultSpatialConstraintState();
		spatialConstraintKind = defaults.spatialConstraintKind;
		spatialConstraintEnforcement = defaults.spatialConstraintEnforcement;
		constraintCenterStop = defaults.constraintCenterStop;
		areaRadiusMetersInput = defaults.areaRadiusMetersInput;
		corridorWidthMetersInput = defaults.corridorWidthMetersInput;
		areaRadiusInput = defaults.areaRadiusInput;
		corridorWidthInput = defaults.corridorWidthInput;
	}

	function syncStopsFromRoute(route: PlannedRoute) {
		const hydratedState = hydratePlannerStateFromRoute(route);
		applyPlannerFormState({
			...hydratedState.form,
			fieldErrors,
		});
		avoidedRoads = hydratedState.avoidedRoads;
	}

	function syncActiveRouteManualEditing(indexes: number[]) {
		if (selectedRouteIndex === null) {
			return;
		}

		const selectedRoute = routeAlternatives[selectedRouteIndex];

		if (!selectedRoute) {
			return;
		}

		const nextRoute = withManualEditingState(selectedRoute, indexes);
		const currentIndexes =
			selectedRoute.manualEditing?.lockedSegmentIndexes ?? [];
		const nextIndexes = nextRoute.manualEditing?.lockedSegmentIndexes ?? [];

		if (
			currentIndexes.length === nextIndexes.length &&
			currentIndexes.every(
				(index, itemIndex) => index === nextIndexes[itemIndex],
			)
		) {
			return;
		}

		routeAlternatives = routeAlternatives.map((route, index) =>
			index === selectedRouteIndex ? nextRoute : route,
		);
	}

	function setRouteAlternativesState(
		routes: PlannedRoute[],
		nextSelectedRouteIndex: number,
	) {
		const nextIndex =
			routes.length === 0
				? null
				: Math.min(Math.max(nextSelectedRouteIndex, 0), routes.length - 1);
		const selectedRoute = nextIndex === null ? null : routes[nextIndex];
		const nextLockedSegmentIndexes = selectedRoute
			? sanitizeLockedSegmentIndexes(
					lockedSegmentIndexes,
					getRouteSegmentCount(selectedRoute),
				)
			: [];
		const nextAvoidedRoads = selectedRoute?.avoidances ?? avoidedRoads;
		routeAlternatives = routes.map((route, index) =>
			index === nextIndex
				? withPlannerRouteState(
						route,
						nextLockedSegmentIndexes,
						nextAvoidedRoads,
					)
				: withAvoidancesState(route, nextAvoidedRoads),
		);
		selectedRouteIndex = nextIndex;
		lockedSegmentIndexes = nextLockedSegmentIndexes;
		avoidedRoads = nextAvoidedRoads.map((avoidance) => ({ ...avoidance }));
	}

	function setSingleRouteState(route: PlannedRoute) {
		lockedSegmentIndexes = sanitizeLockedSegmentIndexes(
			route.manualEditing?.lockedSegmentIndexes ?? [],
			getRouteSegmentCount(route),
		);
		avoidedRoads = route.avoidances ?? [];
		setRouteAlternativesState([route], 0);
	}

	function selectRouteAlternative(index: number) {
		if (index < 0 || index >= routeAlternatives.length) {
			return;
		}

		const selectedRoute = routeAlternatives[index] as PlannedRoute;
		const nextLockedSegmentIndexes = sanitizeLockedSegmentIndexes(
			lockedSegmentIndexes,
			getRouteSegmentCount(selectedRoute),
		);

		selectedRouteIndex = index;
		lockedSegmentIndexes = nextLockedSegmentIndexes;
		avoidedRoads = selectedRoute.avoidances ?? avoidedRoads;
		routeAlternatives = routeAlternatives.map((route, routeIndex) =>
			routeIndex === index
				? withPlannerRouteState(route, nextLockedSegmentIndexes, avoidedRoads)
				: withAvoidancesState(route, avoidedRoads),
		);
		activeProfileIndex = null;
		chartScrubPointerId = null;
		clearRouteEditHistory();
		bumpRouteSaveRevision();
		scheduleActiveRouteAutosave();
	}

	function bumpRouteSaveRevision() {
		routeSaveRevision += 1;
	}

	function markPlannerEdited() {
		if (routeRequestError) {
			routeRequestError = null;
		}

		if (routeImportError) {
			routeImportError = null;
		}

		activeSavedRouteId = null;
		isActiveRouteSaved = false;
		pendingSavedRouteId = null;
		bumpRouteSaveRevision();
	}

	function cancelAutosaveTimer() {
		if (!autosaveTimer) {
			return;
		}

		clearTimeout(autosaveTimer);
		autosaveTimer = null;
	}

	function getActiveRouteForSaving(): PlannedRoute | null {
		return getSaveableActiveRoute({
			activeRoute,
			lockedSegmentIndexes,
			avoidedRoads,
		});
	}

	function setRouteShareError(routeKey: string, error: string | null) {
		routeShareErrors = {
			...routeShareErrors,
			[routeKey]: error,
		};
	}

	function setRouteShareUrl(routeKey: string, url: string | null) {
		routeShareUrls = {
			...routeShareUrls,
			[routeKey]: url,
		};
	}

	function setRouteShareCopied(routeKey: string, copied: boolean) {
		activeRouteShareCopied = {
			...activeRouteShareCopied,
			[routeKey]: copied,
		};
	}

	async function saveActiveRouteDraft(
		options: {
			force?: boolean;
			source?: "autosave" | "explicit" | "share";
		} = {},
	) {
		cancelAutosaveTimer();
		const routeId = plannerDraftRouteId ?? activeSavedRouteId;

		if (
			!options.force &&
			options.source === "autosave" &&
			routeId === lastAutosavedRouteId &&
			routeSaveRevision === lastAutosavedRevision
		) {
			return null;
		}

		const routeForSaving = getActiveRouteForSaving();

		if (!routeForSaving) {
			return null;
		}

		const savedRoute = await upsertSavedRoute(
			routeForSaving,
			plannerDraftRouteId ?? activeSavedRouteId ?? undefined,
			{ source: options.source },
		);
		plannerDraftRouteId = savedRoute.id;
		activeSavedRouteId = savedRoute.id;
		isActiveRouteSaved = true;
		lastAutosavedRouteId = savedRoute.id;
		lastAutosavedRevision = routeSaveRevision;
		return savedRoute;
	}

	function scheduleActiveRouteAutosave() {
		cancelAutosaveTimer();
		autosaveTimer = setTimeout(() => {
			void saveActiveRouteDraft({ source: "autosave" });
		}, autosaveDebounceMs);
	}

	function captureRouteEditSnapshot(
		options: RouteEditSnapshotOptions = {},
	): RouteEditSnapshot {
		return capturePlannerRouteEditSnapshot(
			getPlannerFormState(),
			getPlannerRouteState(),
			options,
		);
	}

	function captureSavedRouteEditMetadata(): SavedRouteEditMetadata {
		return {
			activeSavedRouteId,
			plannerDraftRouteId,
			pendingSavedRouteId,
			isActiveRouteSaved,
		};
	}

	function applyRestoredRouteEditSnapshot(snapshot: RouteEditSnapshot) {
		closeCompletionMenu();
		closeMapClickMenu();
		const restoredState = restorePlannerSnapshot(snapshot);
		applyPlannerRouteState(restoredState.routeState);
		applyPlannerFormState(restoredState.form);
		activeProfileIndex = null;
		chartScrubPointerId = null;
	}

	function restoreRouteEditSnapshot(snapshot: RouteEditSnapshot) {
		applyRestoredRouteEditSnapshot(snapshot);
		routeRequestError = null;
		routeImportError = null;
		routeExportError = null;
		markPlannerEdited();
		scheduleActiveRouteAutosave();
	}

	function rollbackRouteEditSnapshot(
		snapshot: RouteEditSnapshot,
		savedRouteMetadata: SavedRouteEditMetadata,
		preservedRouteRequestError: string | null,
	) {
		applyRestoredRouteEditSnapshot(snapshot);
		activeSavedRouteId = savedRouteMetadata.activeSavedRouteId;
		plannerDraftRouteId = savedRouteMetadata.plannerDraftRouteId;
		pendingSavedRouteId = savedRouteMetadata.pendingSavedRouteId;
		isActiveRouteSaved = savedRouteMetadata.isActiveRouteSaved;
		routeRequestError = preservedRouteRequestError;
		routeImportError = null;
		routeExportError = null;
		bumpRouteSaveRevision();
		scheduleActiveRouteAutosave();
	}

	function pushRouteEditUndoSnapshot(snapshot: RouteEditSnapshot) {
		undoStack = [...undoStack, snapshot].slice(-maxRouteEditHistoryEntries);
	}

	function clearRouteEditHistory() {
		undoStack = [];
		redoStack = [];
	}

	function performRouteEdit(editFn: () => boolean | undefined) {
		if (!activeRoute) {
			editFn();
			return;
		}

		const previousSnapshot = captureRouteEditSnapshot();
		const changed = editFn();

		if (changed === false) {
			return;
		}

		pushRouteEditUndoSnapshot(previousSnapshot);
		redoStack = [];
	}

	async function performAsyncRouteEdit(
		editFn: () => Promise<AsyncRouteEditResult>,
		options: RouteEditSnapshotOptions = {},
	) {
		if (!activeRoute) {
			await editFn();
			return;
		}

		const previousSnapshot = captureRouteEditSnapshot(options);
		const savedRouteMetadata = captureSavedRouteEditMetadata();
		const result = await editFn();

		if (result === "noop") {
			return;
		}

		if (result === "rollback") {
			const preservedRouteRequestError = routeRequestError;
			rollbackRouteEditSnapshot(
				previousSnapshot,
				savedRouteMetadata,
				preservedRouteRequestError,
			);
			return;
		}

		pushRouteEditUndoSnapshot(previousSnapshot);
		redoStack = [];
	}

	function undoRouteEdit() {
		const previousSnapshot = undoStack[undoStack.length - 1];

		if (!previousSnapshot || isRouting) {
			return;
		}

		undoStack = undoStack.slice(0, -1);
		redoStack = [
			...redoStack,
			captureRouteEditSnapshot({ includeRoutesGeometry: true }),
		].slice(-maxRouteEditHistoryEntries);
		restoreRouteEditSnapshot(previousSnapshot);
	}

	function redoRouteEdit() {
		const nextSnapshot = redoStack[redoStack.length - 1];

		if (!nextSnapshot || isRouting) {
			return;
		}

		redoStack = redoStack.slice(0, -1);
		pushRouteEditUndoSnapshot(
			captureRouteEditSnapshot({ includeRoutesGeometry: true }),
		);
		restoreRouteEditSnapshot(nextSnapshot);
	}

	function isRouteEditKeyboardShortcutAllowed(event: KeyboardEvent) {
		if (!event.metaKey && !event.ctrlKey) {
			return false;
		}

		if (event.altKey) {
			return false;
		}

		const key = event.key.toLowerCase();

		if (key !== "z" && key !== "y") {
			return false;
		}

		const target = event.target;

		if (!(target instanceof HTMLElement)) {
			return true;
		}

		return !target.closest("input, textarea, select, [contenteditable]");
	}

	function clearModeSpecificFieldErrors(nextMode: PlannerMode) {
		fieldErrors = {
			...fieldErrors,
			destinationQuery:
				nextMode === "round_course" ? undefined : fieldErrors.destinationQuery,
			waypointQueries:
				nextMode === "point_to_point" ? fieldErrors.waypointQueries : [],
			roundCourseTarget:
				nextMode === "round_course" ? fieldErrors.roundCourseTarget : undefined,
		};
	}

	function setPlannerMode(nextMode: PlannerMode) {
		if (plannerMode === nextMode) {
			return;
		}

		plannerMode = nextMode;
		lockedSegmentIndexes = [];
		avoidedRoads = [];
		if (nextMode === "round_course") {
			roundCourseTargetKind = "distance";
			if (spatialConstraintKind === "corridor") {
				resetSpatialConstraintDefaults();
				clearSpatialConstraintError();
			}
		}
		closeMapClickMenu();
		clearModeSpecificFieldErrors(nextMode);

		if (
			nextMode !== "point_to_point" &&
			completionController.viewState.activeTarget &&
			completionController.viewState.activeTarget.kind !== "startQuery"
		) {
			closeCompletionMenu();
		}

		markPlannerEdited();
	}

	async function restoreSavedRouteFromLocation(location: Location) {
		const savedRouteId = new URLSearchParams(location.search).get("savedRoute");

		if (!savedRouteId) {
			return;
		}

		fitInitialSavedRouteBounds = true;
		const savedRoute = await getSavedRouteById(savedRouteId);

		if (!savedRoute) {
			pendingSavedRouteId = savedRouteId;
			return;
		}

		restoreSavedRoute(savedRoute);
	}

	async function restorePendingSavedRoute() {
		if (!pendingSavedRouteId) {
			return;
		}

		const savedRoute = await getSavedRouteById(pendingSavedRouteId);

		if (!savedRoute) {
			return;
		}

		restoreSavedRoute(savedRoute);
		pendingSavedRouteId = null;
	}

	function restoreSavedRoute(savedRoute: SavedRoute) {
		if (!isPlannedRoute(savedRoute.route)) {
			return;
		}

		setSingleRouteState(savedRoute.route);
		lastGeneratedRouteCount = null;
		syncStopsFromRoute(savedRoute.route);
		activeSavedRouteId = savedRoute.id;
		plannerDraftRouteId = savedRoute.id;
		isActiveRouteSaved = true;
		routeRequestError = null;
		fieldErrors = {};
		activeProfileIndex = null;
		chartScrubPointerId = null;
		clearRouteEditHistory();
	}

	function elevY(meters: number, height: number, pad: number): number {
		const normalized = (meters - elevMin) / elevRange;
		return pad + (1 - normalized) * (height - pad * 2);
	}

	function clearRoundCourseTargetError() {
		if (!fieldErrors.roundCourseTarget) {
			return;
		}

		fieldErrors = {
			...fieldErrors,
			roundCourseTarget: undefined,
		};
	}

	function updateRoundCourseTargetKind(value: RoundCourseTargetKind) {
		roundCourseTargetKind = value;
		clearRoundCourseTargetError();
		markPlannerEdited();
	}

	function updateRoundCourseDistanceInput(value: string) {
		roundCourseDistanceInput = value;
		roundCourseDistanceMetersInput = parseDistanceInputToMeters(value);
		clearRoundCourseTargetError();
		markPlannerEdited();
	}

	function updateRoundCourseDuration(value: string) {
		roundCourseDurationInput = value;
		clearRoundCourseTargetError();
		markPlannerEdited();
	}

	function updateRoundCourseAscend(value: string) {
		roundCourseAscendMeters = value;
		clearRoundCourseTargetError();
		markPlannerEdited();
	}

	function clearSpatialConstraintError() {
		if (!fieldErrors.spatialConstraint) {
			return;
		}

		fieldErrors = {
			...fieldErrors,
			spatialConstraint: undefined,
		};
	}

	function updateSpatialConstraintKind(value: SpatialConstraintKind) {
		spatialConstraintKind = value;
		clearSpatialConstraintError();
		closeCompletionMenu();
		markPlannerEdited();
	}

	function updateSpatialConstraintEnforcement(
		value: SpatialConstraintEnforcement,
	) {
		spatialConstraintEnforcement = value;
		clearSpatialConstraintError();
		markPlannerEdited();
	}

	function setConstraintCenterStop(stop: PlannerStop) {
		constraintCenterStop = stop;
		clearSpatialConstraintError();
		markPlannerEdited();
	}

	function updateConstraintCenterInput(value: string) {
		setConstraintCenterStop(createPlannerStop(value));
		completionController.scheduleLookup(
			constraintCenterCompletionTarget,
			value,
		);
	}

	function updateAreaRadiusInput(value: string) {
		areaRadiusInput = value;
		areaRadiusMetersInput = parseDistanceInputToMeters(value);
		clearSpatialConstraintError();
		markPlannerEdited();
	}

	function updateCorridorWidthInput(value: string) {
		corridorWidthInput = value;
		corridorWidthMetersInput = parseDistanceInputToMeters(value);
		clearSpatialConstraintError();
		markPlannerEdited();
	}

	function getNearestProfileIndex(chartX: number): number | null {
		if (chartProfilePoints.length === 0) {
			return null;
		}

		let nearestIndex = 0;
		let nearestDistance = Math.abs((chartProfilePoints[0]?.x ?? 0) - chartX);

		for (const [index, point] of chartProfilePoints.entries()) {
			const distance = Math.abs(point.x - chartX);

			if (distance < nearestDistance) {
				nearestIndex = index;
				nearestDistance = distance;
			}
		}

		return nearestIndex;
	}

	function getChartPointerX(event: PointerEvent): number {
		const bounds = (
			event.currentTarget as SVGSVGElement
		).getBoundingClientRect();

		if (bounds.width === 0) {
			return 0;
		}

		const xRatio = (event.clientX - bounds.left) / bounds.width;
		return Math.min(chartW, Math.max(0, xRatio * chartW));
	}

	function updateActiveProfileFromPointer(event: PointerEvent) {
		const nextIndex = getNearestProfileIndex(getChartPointerX(event));

		if (nextIndex === null) {
			return;
		}

		activeProfileIndex = nextIndex;
	}

	function clearActiveProfilePoint() {
		activeProfileIndex = null;
	}

	function handleChartPointerDown(event: PointerEvent) {
		if (event.pointerType === "mouse") {
			return;
		}

		chartScrubPointerId = event.pointerId;

		try {
			(event.currentTarget as SVGSVGElement).setPointerCapture?.(
				event.pointerId,
			);
		} catch {
			// Synthetic test events can dispatch without an active capturable pointer.
		}

		updateActiveProfileFromPointer(event);
	}

	function handleChartPointerMove(event: PointerEvent) {
		if (
			event.pointerType !== "mouse" &&
			chartScrubPointerId !== event.pointerId
		) {
			return;
		}

		updateActiveProfileFromPointer(event);
	}

	function handleChartPointerLeave() {
		if (chartScrubPointerId !== null) {
			return;
		}

		clearActiveProfilePoint();
	}

	function releaseChartScrub(event: PointerEvent) {
		if (chartScrubPointerId !== event.pointerId) {
			return;
		}

		try {
			(event.currentTarget as SVGSVGElement).releasePointerCapture?.(
				event.pointerId,
			);
		} catch {
			// Releasing is optional when capture was never established.
		}

		chartScrubPointerId = null;
		clearActiveProfilePoint();
	}

	function handleChartLostPointerCapture(event: PointerEvent) {
		if (chartScrubPointerId !== event.pointerId) {
			return;
		}

		chartScrubPointerId = null;
		clearActiveProfilePoint();
	}

	function closeCompletionMenu() {
		completionController.close();
	}

	function setFieldStop(
		field: RouteField,
		stop: PlannerStop,
		options: {
			clearFieldError?: boolean;
		} = {},
	) {
		if (field === "startQuery") {
			startStop = stop;
		} else {
			destinationStop = stop;
		}

		if (options.clearFieldError !== false && fieldErrors[field]) {
			fieldErrors = {
				...fieldErrors,
				[field]: undefined,
			};
		}

		markPlannerEdited();
	}

	function setWaypointStop(index: number, stop: PlannerStop) {
		waypointStops = waypointStops.map((waypoint, waypointIndex) =>
			waypointIndex === index ? stop : waypoint,
		);
		clearWaypointError(index);
		markPlannerEdited();
	}

	function handleFieldInput(field: RouteField, value: string) {
		updateField(field, value);
		completionController.scheduleLookup(
			field === "startQuery"
				? startCompletionTarget
				: destinationCompletionTarget,
			value,
		);
	}

	function updateField(field: RouteField, value: string) {
		setFieldStop(field, createPlannerStop(value));
	}

	function getWaypointError(index: number) {
		return fieldErrors.waypointQueries?.[index] || "";
	}

	function clearWaypointError(index: number) {
		if (!fieldErrors.waypointQueries?.[index]) {
			return;
		}

		fieldErrors = {
			...fieldErrors,
			waypointQueries: waypointStops.map((_, waypointIndex) =>
				waypointIndex === index
					? ""
					: fieldErrors.waypointQueries?.[waypointIndex] || "",
			),
		};
	}

	function updateWaypoint(index: number, value: string) {
		setWaypointStop(index, createPlannerStop(value));
	}

	function handleWaypointInput(index: number, value: string) {
		updateWaypoint(index, value);
		completionController.scheduleLookup(
			getWaypointCompletionTarget(index),
			value,
		);
	}

	function addWaypoint(
		stop = createPlannerStop(),
		index = waypointStops.length,
		recordHistory = true,
	): boolean {
		if (recordHistory && activeRoute) {
			let changed = false;
			performRouteEdit(() => {
				changed = addWaypoint(stop, index, false);
				return changed;
			});
			return changed;
		}

		if (waypointStops.length >= maxWaypoints) {
			return false;
		}

		const nextIndex = Math.max(0, Math.min(index, waypointStops.length));
		waypointStops = [
			...waypointStops.slice(0, nextIndex),
			stop,
			...waypointStops.slice(nextIndex),
		];
		const nextWaypointErrors = [...(fieldErrors.waypointQueries ?? [])];
		nextWaypointErrors.splice(nextIndex, 0, "");
		fieldErrors = {
			...fieldErrors,
			waypointQueries: nextWaypointErrors,
		};

		completionController.handleWaypointInserted(nextIndex);

		markPlannerEdited();
		return true;
	}

	function removeWaypoint(index: number, recordHistory = true): boolean {
		if (recordHistory && activeRoute) {
			let changed = false;
			performRouteEdit(() => {
				changed = removeWaypoint(index, false);
				return changed;
			});
			return changed;
		}

		if (isLockedStopIndex(index + 1)) {
			return false;
		}

		completionController.handleWaypointRemoved(index);

		waypointStops = waypointStops.filter(
			(_, waypointIndex) => waypointIndex !== index,
		);
		fieldErrors = {
			...fieldErrors,
			waypointQueries: (fieldErrors.waypointQueries ?? []).filter(
				(_, waypointIndex) => waypointIndex !== index,
			),
		};

		markPlannerEdited();
		return true;
	}

	function canMoveWaypoint(index: number, direction: -1 | 1) {
		const nextIndex = index + direction;

		return (
			nextIndex >= 0 &&
			nextIndex < waypointStops.length &&
			!isLockedStopIndex(index + 1) &&
			!isLockedStopIndex(nextIndex + 1)
		);
	}

	function moveWaypoint(
		index: number,
		direction: -1 | 1,
		recordHistory = true,
	): boolean {
		if (recordHistory && activeRoute) {
			let changed = false;
			performRouteEdit(() => {
				changed = moveWaypoint(index, direction, false);
				return changed;
			});
			return changed;
		}

		const nextIndex = index + direction;

		if (!canMoveWaypoint(index, direction)) {
			return false;
		}

		const nextWaypointStops = [...waypointStops];
		[nextWaypointStops[index], nextWaypointStops[nextIndex]] = [
			nextWaypointStops[nextIndex] ?? createPlannerStop(),
			nextWaypointStops[index] ?? createPlannerStop(),
		];
		waypointStops = nextWaypointStops;

		const nextWaypointErrors = [...(fieldErrors.waypointQueries ?? [])];
		[nextWaypointErrors[index], nextWaypointErrors[nextIndex]] = [
			nextWaypointErrors[nextIndex] ?? "",
			nextWaypointErrors[index] ?? "",
		];
		fieldErrors = {
			...fieldErrors,
			waypointQueries: nextWaypointErrors,
		};

		completionController.handleWaypointSwap(index, nextIndex);

		markPlannerEdited();
		return true;
	}

	function closeMapClickMenu() {
		mapClickSelection = null;
		isResolvingMapSelection = false;
	}

	function handleMapClick(selection: MapClickSelection) {
		closeCompletionMenu();
		mapClickSelection = selection;
	}

	function getMapClickMenuTitle(selection: MapClickSelection) {
		if (selection.selectedStop) {
			return "Selected point";
		}

		if (selection.selectedSegment) {
			return "Selected segment";
		}

		return "Use clicked point";
	}

	function getMapClickMenuSubtitle(selection: MapClickSelection) {
		if (selection.selectedSegment) {
			const segmentIndex = getSelectedSegmentIndex(selection);
			return typeof segmentIndex === "number"
				? `Segment ${segmentIndex + 1}`
				: "Route segment";
		}

		return (
			selection.selectedStop?.label || formatCoordinateLabel(selection.point)
		);
	}

	function getRemoveActionLabel(selectedStop: SelectedMapStop) {
		if (selectedStop.kind === "start") {
			return "Remove start";
		}

		if (selectedStop.kind === "destination") {
			return isOutAndBackMode ? "Remove turnaround" : "Remove destination";
		}

		if (selectedStop.kind === "waypoint") {
			if (isOutAndBackMode) {
				return "Remove turnaround";
			}

			return `Remove waypoint ${selectedStop.index + 1}`;
		}

		return "Remove stop";
	}

	function removeSelectedMapStop(
		selectedStop: SelectedMapStop,
		recordHistory = true,
	): boolean {
		if (recordHistory && activeRoute) {
			let changed = false;
			performRouteEdit(() => {
				changed = removeSelectedMapStop(selectedStop, false);
				return changed;
			});
			return changed;
		}

		const selectedStopIndex = (() => {
			if (selectedStop.kind === "start") {
				return 0;
			}

			return selectedStop.kind === "waypoint"
				? selectedStop.index + 1
				: waypointStops.length + 1;
		})();

		if (isLockedStopIndex(selectedStopIndex)) {
			return false;
		}

		if (selectedStop.kind === "start") {
			setFieldStop("startQuery", createPlannerStop());
			closeMapClickMenu();
			return true;
		}

		if (selectedStop.kind === "destination") {
			setFieldStop("destinationQuery", createPlannerStop());
			closeMapClickMenu();
			return true;
		}

		if (selectedStop.kind === "waypoint") {
			if (isOutAndBackMode) {
				setFieldStop("destinationQuery", createPlannerStop());
				closeMapClickMenu();
				return true;
			}

			const changed = removeWaypoint(selectedStop.index, false);
			closeMapClickMenu();
			return changed;
		}

		return false;
	}

	function getSelectedSegmentIndex(selection: MapClickSelection) {
		if (!activeRoute || !selection.selectedSegment) {
			return null;
		}

		return (
			getRouteLegIndexForCoordinateSegment(
				activeRoute,
				selection.selectedSegment.coordinateSegmentIndex,
			) ?? selection.selectedSegment.segmentIndex
		);
	}

	function isMapSelectionSegmentLocked(selection: MapClickSelection) {
		const segmentIndex = getSelectedSegmentIndex(selection);
		return segmentIndex === null
			? false
			: sanitizedLockedSegmentIndexes.includes(segmentIndex);
	}

	function toggleMapSelectionSegmentLock(
		selection: MapClickSelection,
		recordHistory = true,
	): boolean {
		if (recordHistory && activeRoute) {
			let changed = false;
			performRouteEdit(() => {
				changed = toggleMapSelectionSegmentLock(selection, false);
				return changed;
			});
			return changed;
		}

		const segmentIndex = getSelectedSegmentIndex(selection);

		if (segmentIndex === null) {
			return false;
		}

		const nextLockedSegmentIndexes = sanitizedLockedSegmentIndexes.includes(
			segmentIndex,
		)
			? sanitizedLockedSegmentIndexes.filter((index) => index !== segmentIndex)
			: sanitizeLockedSegmentIndexes(
					[...sanitizedLockedSegmentIndexes, segmentIndex],
					activeRouteSegmentCount,
				);
		lockedSegmentIndexes = nextLockedSegmentIndexes;
		syncActiveRouteManualEditing(nextLockedSegmentIndexes);
		markPlannerEdited();
		closeMapClickMenu();
		scheduleActiveRouteAutosave();
		return true;
	}

	function getAvoidanceForSelection(selection: MapClickSelection) {
		if (!selection.selectedSegment) {
			return null;
		}

		const point = selection.point;
		return findAvoidanceNearSelection(point, avoidedRoads);
	}

	function isMapSelectionRoadAvoided(selection: MapClickSelection) {
		return !!selection.selectedSegment && !!getAvoidanceForSelection(selection);
	}

	function getSelectedAvoidanceCenterline(selection: MapClickSelection) {
		if (!activeRoute || !selection.selectedSegment) {
			return null;
		}

		const selectedIndex = selection.selectedSegment.coordinateSegmentIndex;
		const startIndex = Math.max(0, selectedIndex - 3);
		const endIndex = Math.min(
			activeRoute.coordinates.length - 1,
			selectedIndex + 4,
		);
		const centerline = activeRoute.coordinates
			.slice(startIndex, endIndex + 1)
			.map((coordinate): [number, number] => [coordinate[0], coordinate[1]])
			.slice(0, 8);

		return centerline.length >= 2 ? centerline : null;
	}

	async function toggleMapSelectionRoadAvoidance(selection: MapClickSelection) {
		if (!activeRoute || !selection.selectedSegment || isRouting) {
			return false;
		}

		closeCompletionMenu();
		closeMapClickMenu();
		await performAsyncRouteEdit(
			async () => {
				const targetAvoidance = getAvoidanceForSelection(selection);

				if (targetAvoidance) {
					avoidedRoads = avoidedRoads.filter(
						(avoidance) => avoidance !== targetAvoidance,
					);
					return (await rerouteAfterManualEdit()) ? "committed" : "rollback";
				}

				const centerline = getSelectedAvoidanceCenterline(selection);
				if (!centerline) {
					return "noop";
				}

				const bufferMeters = 35;
				avoidedRoads = [
					...avoidedRoads,
					{
						kind: "road_segment",
						label: `Avoided road ${avoidedRoads.length + 1}`,
						centerline,
						bufferMeters,
						polygon: buildAvoidancePlaceholderPolygon(centerline, bufferMeters),
					},
				];
				return (await rerouteAfterManualEdit()) ? "committed" : "rollback";
			},
			{ includeRoutesGeometry: true },
		);
		return true;
	}

	function removeAvoidedRoad(index: number) {
		if (index < 0 || index >= avoidedRoads.length || isRouting) {
			return;
		}

		void performAsyncRouteEdit(
			async () => {
				avoidedRoads = avoidedRoads.filter(
					(_, itemIndex) => itemIndex !== index,
				);
				return (await rerouteAfterManualEdit()) ? "committed" : "rollback";
			},
			{ includeRoutesGeometry: true },
		);
	}

	function getWaypointInsertionTarget(point: [number, number]) {
		const hasCompleteOrderedStops =
			plannerMode === "point_to_point" &&
			!!startStop.point &&
			startStop.label.trim().length > 0 &&
			!!destinationStop.point &&
			destinationStop.label.trim().length > 0 &&
			waypointStops.every(
				(waypoint) => waypoint.label.trim().length > 0 && !!waypoint.point,
			);

		if (hasCompleteOrderedStops) {
			return getWaypointInsertionIndex(
				[startStop, ...waypointStops, destinationStop],
				point,
				activeRoute,
			);
		}

		return waypointStops.length;
	}

	function getMapWaypointInsertionSegmentIndex(selection: MapClickSelection) {
		return (
			getSelectedSegmentIndex(selection) ??
			getWaypointInsertionTarget(selection.point)
		);
	}

	function isMapWaypointInsertionLocked(selection: MapClickSelection) {
		const segmentIndex = getMapWaypointInsertionSegmentIndex(selection);

		return sanitizedLockedSegmentIndexes.includes(segmentIndex);
	}

	async function resolveMapStopLabel(point: [number, number]) {
		if (!clientFetch) {
			return formatCoordinateLabel(point);
		}

		try {
			const response = await clientFetch(
				`/api/route/reverse?lat=${encodeURIComponent(String(point[1]))}&lng=${encodeURIComponent(String(point[0]))}`,
			);

			if (!response.ok) {
				throw new Error(
					`Reverse geocoding failed with status ${response.status}`,
				);
			}

			const payload =
				(await response.json()) as Partial<ReverseGeocodeApiSuccess>;
			return typeof payload.label === "string" &&
				payload.label.trim().length > 0
				? payload.label
				: formatCoordinateLabel(point);
		} catch (error) {
			console.error("Failed to reverse geocode clicked map point", error);
			return formatCoordinateLabel(point);
		}
	}

	async function applyMapPointAsStop(
		target:
			| { kind: "startQuery" }
			| { kind: "destinationQuery" }
			| { kind: "waypoint" },
		recordHistory = true,
	): Promise<boolean> {
		if (recordHistory && activeRoute) {
			let changed = false;
			await performAsyncRouteEdit(async () => {
				changed = await applyMapPointAsStop(target, false);
				return changed ? "committed" : "noop";
			});
			return changed;
		}

		const selection = mapClickSelection;

		if (!selection) {
			return false;
		}

		isResolvingMapSelection = true;
		closeCompletionMenu();
		const fallbackStop = createPlannerStop(
			formatCoordinateLabel(selection.point),
			selection.point,
			"map",
		);

		if (target.kind === "startQuery") {
			setFieldStop("startQuery", fallbackStop);
		} else if (target.kind === "destinationQuery") {
			setFieldStop("destinationQuery", fallbackStop);
		} else {
			if (isMapWaypointInsertionLocked(selection)) {
				isResolvingMapSelection = false;
				return false;
			}

			addWaypoint(
				fallbackStop,
				getMapWaypointInsertionSegmentIndex(selection),
				false,
			);
		}

		closeMapClickMenu();
		const resolvedLabel = await resolveMapStopLabel(selection.point);

		if (target.kind === "startQuery") {
			if (
				startStop.source === "map" &&
				startStop.point?.[0] === selection.point[0] &&
				startStop.point?.[1] === selection.point[1]
			) {
				startStop = {
					...startStop,
					label: resolvedLabel,
				};
			}
			return true;
		}

		if (target.kind === "destinationQuery") {
			if (
				destinationStop.source === "map" &&
				destinationStop.point?.[0] === selection.point[0] &&
				destinationStop.point?.[1] === selection.point[1]
			) {
				destinationStop = {
					...destinationStop,
					label: resolvedLabel,
				};
			}
			return true;
		}

		waypointStops = waypointStops.map((waypoint) =>
			waypoint.source === "map" &&
			waypoint.point?.[0] === selection.point[0] &&
			waypoint.point?.[1] === selection.point[1]
				? {
						...waypoint,
						label: resolvedLabel,
					}
				: waypoint,
		);
		return true;
	}

	function validateDistanceInputs(): boolean {
		const validation = runPlannerValidation(getPlannerFormState(), {
			minRoundCourseDistanceMeters,
			minRoundCourseDurationMs,
			minRoundCourseAscendMeters,
		});

		if (validation.valid) {
			return true;
		}

		fieldErrors = {
			...fieldErrors,
			...validation.fieldErrors,
		};
		return false;
	}

	function applyManualEditingToRoutes(routes: PlannedRoute[]) {
		const manualEditing = getPlannerManualEditingRequest(
			activeRoute,
			lockedSegmentIndexes,
		);

		return routes.map((route) => ({
			...withAvoidancesState(route, route.avoidances ?? avoidedRoads),
			...(manualEditing ? { manualEditing } : {}),
		}));
	}

	async function requestRouteCalculation(
		routeRequest: RouteRequestPayload & {
			manualEditing?: ManualRouteEditingState;
		},
	) {
		if (!clientFetch) {
			throw new Error(
				"Route requests are only available after the page has mounted.",
			);
		}

		const response = await clientFetch("/api/route", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(routeRequest),
		});

		if (!response.ok) {
			const errorPayload = (await response.json()) as RouteApiError;
			fieldErrors = errorPayload.fieldErrors ?? {};
			routeRequestError = errorPayload.error;
			return null;
		}

		return (await response.json()) as RouteApiSuccess;
	}

	function isLockedStopIndex(stopIndex: number) {
		return activeRoute
			? isRouteStopLocked(
					stopIndex,
					sanitizedLockedSegmentIndexes,
					getRouteSegmentCount(activeRoute),
					activeRoute.mode === "round_course",
				)
			: false;
	}

	function updateDraggedStop(
		selectedStop: SelectedMapStop,
		point: [number, number],
		label: string,
	) {
		const stop = createPlannerStop(label, point, "map");

		if (selectedStop.kind === "start") {
			setFieldStop("startQuery", stop);
			return;
		}

		if (selectedStop.kind === "destination") {
			setFieldStop("destinationQuery", stop);
			return;
		}

		if (selectedStop.kind !== "waypoint") {
			return;
		}

		if (
			plannerMode === "out_and_back" &&
			selectedStop.index >= waypointStops.length
		) {
			setFieldStop("destinationQuery", stop);
			return;
		}

		if (selectedStop.index >= 0 && selectedStop.index < waypointStops.length) {
			setWaypointStop(selectedStop.index, stop);
		}
	}

	async function rerouteAfterManualEdit(): Promise<boolean> {
		if (isRouting) {
			return false;
		}

		isRouting = true;
		pendingSavedRouteId = null;
		activeSavedRouteId = null;
		isActiveRouteSaved = false;
		routeRequestError = null;
		routeImportError = null;
		fieldErrors = {};
		routeExportError = null;

		try {
			const payload = await requestRouteCalculation(
				buildPlannerCurrentRouteRequest(
					getPlannerFormState(),
					getPlannerManualEditingRequest(activeRoute, lockedSegmentIndexes),
					getPlannerAvoidanceRequest(avoidedRoads),
				),
			);

			if (!payload) {
				return false;
			}

			const nextRoutes = applyManualEditingToRoutes(payload.routes ?? []);
			const nextSelectedRoute =
				nextRoutes[payload.selectedRouteIndex] ?? nextRoutes[0] ?? null;

			if (!nextSelectedRoute) {
				throw new Error("Route API returned no routes.");
			}

			setRouteAlternativesState(nextRoutes, payload.selectedRouteIndex);
			lastGeneratedRouteCount = nextRoutes.length;
			syncStopsFromRoute(nextSelectedRoute);
			activeProfileIndex = null;
			chartScrubPointerId = null;
			bumpRouteSaveRevision();
			scheduleActiveRouteAutosave();
			return true;
		} catch (error) {
			console.error("Failed to reroute manual edit", error);
			routeRequestError = "The manual route edit could not be recalculated.";
			return false;
		} finally {
			isRouting = false;
		}
	}

	async function handleRouteStopDragEnd(detail: RouteStopDragEnd) {
		if (!activeRoute || isLockedStopIndex(detail.stopIndex)) {
			return;
		}

		closeCompletionMenu();
		closeMapClickMenu();
		await performAsyncRouteEdit(
			async () => {
				const label = await resolveMapStopLabel(detail.point);
				updateDraggedStop(detail.selectedStop, detail.point, label);
				return (await rerouteAfterManualEdit()) ? "committed" : "rollback";
			},
			{ includeRoutesGeometry: true },
		);
	}

	function getManualSegmentWaypointIndex(segmentIndex: number): number | null {
		if (waypointStops.length === 0) {
			return null;
		}

		if (plannerMode === "round_course") {
			const index = segmentIndex === 0 ? 0 : segmentIndex - 1;
			return index >= 0 && index < waypointStops.length ? index : null;
		}

		const index = segmentIndex - 1;
		return index >= 0 && index < waypointStops.length ? index : null;
	}

	async function handleRouteSegmentDragEnd(detail: RouteSegmentDragEnd) {
		if (!activeRoute) {
			return;
		}

		const routeLegIndex =
			getRouteLegIndexForCoordinateSegment(
				activeRoute,
				detail.coordinateSegmentIndex,
			) ?? detail.segmentIndex;

		if (sanitizedLockedSegmentIndexes.includes(routeLegIndex)) {
			return;
		}

		closeCompletionMenu();
		closeMapClickMenu();
		await performAsyncRouteEdit(
			async () => {
				const existingWaypointIndex =
					getManualSegmentWaypointIndex(routeLegIndex);
				const label = await resolveMapStopLabel(detail.point);
				const stop = createPlannerStop(label, detail.point, "map");

				if (existingWaypointIndex !== null) {
					setWaypointStop(existingWaypointIndex, stop);
				} else {
					if (waypointStops.length >= maxWaypoints) {
						routeRequestError = `You can add up to ${maxWaypoints} waypoints per route.`;
						return "noop";
					}

					addWaypoint(
						stop,
						Math.max(0, Math.min(routeLegIndex, waypointStops.length)),
						false,
					);
				}

				return (await rerouteAfterManualEdit()) ? "committed" : "rollback";
			},
			{ includeRoutesGeometry: true },
		);
	}

	async function useCurrentLocationAsStop(field: RouteField) {
		closeCompletionMenu();
		closeMapClickMenu();
		const location = await locateCurrentPosition();

		if (!location) {
			return;
		}

		const label = await resolveCurrentLocationLabel(location.point);
		setFieldStop(field, getCurrentLocationStop(location.point, label));
	}

	async function handleGenerateRoute(event: SubmitEvent) {
		event.preventDefault();

		if (isRouting) {
			return;
		}

		if (!clientFetch) {
			routeRequestError =
				"Route requests are only available after the page has mounted.";
			return;
		}

		closeCompletionMenu();
		pendingSavedRouteId = null;
		activeSavedRouteId = null;
		isActiveRouteSaved = false;
		routeRequestError = null;
		fieldErrors = {};

		if (!validateDistanceInputs()) {
			return;
		}

		isRouting = true;

		try {
			const payload = await requestRouteCalculation(
				buildPlannerCurrentRouteRequest(
					getPlannerFormState(),
					getPlannerManualEditingRequest(activeRoute, lockedSegmentIndexes),
					getPlannerAvoidanceRequest(avoidedRoads),
				),
			);

			if (!payload) {
				return;
			}

			const nextRoutes = applyManualEditingToRoutes(payload.routes ?? []);
			const nextSelectedRoute =
				nextRoutes[payload.selectedRouteIndex] ?? nextRoutes[0] ?? null;

			if (!nextSelectedRoute) {
				throw new Error("Route API returned no routes.");
			}

			setRouteAlternativesState(nextRoutes, payload.selectedRouteIndex);
			lastGeneratedRouteCount = nextRoutes.length;
			syncStopsFromRoute(nextSelectedRoute);
			activeSavedRouteId = null;
			isActiveRouteSaved = false;
			routeRequestError = null;
			routeExportError = null;
			activeProfileIndex = null;
			chartScrubPointerId = null;
			clearRouteEditHistory();
			bumpRouteSaveRevision();
			scheduleActiveRouteAutosave();
		} catch (error) {
			console.error("Failed to generate route", error);
			routeRequestError =
				plannerMode === "round_course"
					? "The round-course request failed before we heard back from GraphHopper."
					: plannerMode === "out_and_back"
						? "The out-and-back request failed before we heard back from GraphHopper."
						: "The route request failed before we heard back from GraphHopper.";
		} finally {
			isRouting = false;
		}
	}

	async function handleSaveDraft() {
		if (!activeRoute) {
			return;
		}

		if (isActiveRouteSaved && activeSavedRouteId) {
			const deletedRouteId = activeSavedRouteId;
			cancelAutosaveTimer();
			await deleteSavedRoute(deletedRouteId);
			if (plannerDraftRouteId === deletedRouteId) {
				plannerDraftRouteId = null;
			}
			activeSavedRouteId = null;
			isActiveRouteSaved = false;
			return;
		}

		const savedRoute = await saveActiveRouteDraft({
			force: true,
			source: "explicit",
		});
		if (!savedRoute) {
			return;
		}
		plannerDraftRouteId = savedRoute.id;
		activeSavedRouteId = savedRoute.id;
		isActiveRouteSaved = true;
	}

	async function handleShareActiveRoute() {
		if (!activeRoute) {
			return;
		}

		const routeKey = activeRouteShareKey;
		if (!routeKey) {
			return;
		}
		let shareErrorKey = routeKey;

		setRouteShareError(routeKey, null);
		setRouteShareUrl(routeKey, null);
		setRouteShareCopied(routeKey, false);

		if (!convexClient || !env.PUBLIC_CONVEX_URL) {
			setRouteShareError(
				routeKey,
				"Route sharing needs Convex to be configured.",
			);
			return;
		}

		if (savedRoutesState.authStatus !== "signedIn") {
			setRouteShareError(routeKey, "Sign in to share routes.");
			return;
		}

		isSharingRoute = true;

		try {
			const savedRoute = await saveActiveRouteDraft({
				force: true,
				source: "share",
			});

			if (!savedRoute) {
				return;
			}

			const savedRouteKey = savedRoute.id;
			shareErrorKey = savedRouteKey;
			setRouteShareError(savedRouteKey, null);
			setRouteShareUrl(savedRouteKey, null);
			setRouteShareCopied(savedRouteKey, false);

			const shareToken = generateShareToken();
			const result = await convexClient.mutation(api.sharedRoutes.create, {
				shareToken,
				sourceRouteId: savedRoute.id,
				savedRoute: serializeSavedRouteForRemote(savedRoute),
			});
			const shareUrl = buildShareUrl(
				browserWindow?.location.origin ?? globalThis.location.origin,
				result.shareToken,
			);
			const copied = await copyTextToClipboard(shareUrl);

			if (!copied) {
				setRouteShareUrl(savedRouteKey, shareUrl);
				setRouteShareError(
					savedRouteKey,
					"Share link created, but copying failed.",
				);
				return;
			}

			setRouteShareUrl(savedRouteKey, null);
			setRouteShareCopied(savedRouteKey, true);
		} catch (error) {
			setRouteShareError(
				shareErrorKey,
				error instanceof Error
					? `Could not share route: ${error.message}`
					: "Could not share route.",
			);
		} finally {
			isSharingRoute = false;
		}
	}

	function handleExportGpx() {
		if (!activeRoute) {
			return;
		}

		routeExportError = null;

		try {
			downloadRouteGpx(activeRoute);
		} catch (error) {
			routeExportError =
				error instanceof Error
					? `Could not export GPX: ${error.message}`
					: "Could not export GPX.";
		}
	}

	function handleExportFit() {
		if (!activeRoute) {
			return;
		}

		routeExportError = null;

		try {
			downloadRouteFit(activeRoute);
		} catch (error) {
			routeExportError =
				error instanceof Error
					? `Could not export FIT: ${error.message}`
					: "Could not export FIT.";
		}
	}

	function openGpxImportPicker() {
		routeImportError = null;
		gpxImportInput?.click();
	}

	function chooseBasemap(id: BasemapId) {
		const basemap = availableBasemapOptions.find((option) => option.id === id);

		if (basemap) {
			setMapStylePreference(basemap.id);
		}
	}

	async function handleGpxImportSelection(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const selectedFile = input.files?.[0];

		if (!selectedFile) {
			return;
		}

		isImportingGpx = true;
		routeImportError = null;

		try {
			const importedRoute = parseRouteGpx(await selectedFile.text(), {
				filename: selectedFile.name,
			});

			closeCompletionMenu();
			closeMapClickMenu();
			pendingSavedRouteId = null;
			setSingleRouteState(importedRoute);
			lastGeneratedRouteCount = null;
			syncStopsFromRoute(importedRoute);
			activeSavedRouteId = null;
			isActiveRouteSaved = false;
			routeRequestError = null;
			routeExportError = null;
			fieldErrors = {};
			activeProfileIndex = null;
			chartScrubPointerId = null;
			clearRouteEditHistory();
			bumpRouteSaveRevision();
			scheduleActiveRouteAutosave();
		} catch (error) {
			console.error("Failed to import GPX", error);
			routeImportError =
				error instanceof RouteGpxImportError
					? error.message
					: "Could not import the selected GPX file.";
		} finally {
			isImportingGpx = false;
			input.value = "";
		}
	}
	const controller = {
		mount,
		destroy,
		getWarningContainerClass,
		getWarningBadgeClass,
		get directionsOpen() {
			return directionsOpen;
		},
		set directionsOpen(value) {
			directionsOpen = value;
		},
		get routeAnalysisOpen() {
			return routeAnalysisOpen;
		},
		set routeAnalysisOpen(value) {
			routeAnalysisOpen = value;
		},
		get gradientOverlayEnabled() {
			return gradientOverlayEnabled;
		},
		set gradientOverlayEnabled(value) {
			gradientOverlayEnabled = value;
		},
		get windOverlayEnabled() {
			return windOverlayEnabled;
		},
		set windOverlayEnabled(value) {
			windOverlayEnabled = value;
		},
		get plannerMode() {
			return plannerMode;
		},
		get startStop() {
			return startStop;
		},
		get waypointStops() {
			return waypointStops;
		},
		get destinationStop() {
			return destinationStop;
		},
		get roundCourseTargetKind() {
			return roundCourseTargetKind;
		},
		get roundCourseDistanceInput() {
			return roundCourseDistanceInput;
		},
		get roundCourseDistanceMetersInput() {
			return roundCourseDistanceMetersInput;
		},
		get roundCourseDurationInput() {
			return roundCourseDurationInput;
		},
		get roundCourseAscendMeters() {
			return roundCourseAscendMeters;
		},
		get spatialConstraintKind() {
			return spatialConstraintKind;
		},
		get spatialConstraintEnforcement() {
			return spatialConstraintEnforcement;
		},
		get constraintCenterStop() {
			return constraintCenterStop;
		},
		get areaRadiusInput() {
			return areaRadiusInput;
		},
		get corridorWidthInput() {
			return corridorWidthInput;
		},
		get areaRadiusMetersInput() {
			return areaRadiusMetersInput;
		},
		get corridorWidthMetersInput() {
			return corridorWidthMetersInput;
		},
		get formattedInputDistanceUnit() {
			return formattedInputDistanceUnit;
		},
		get routeRequestError() {
			return routeRequestError;
		},
		get routeImportError() {
			return routeImportError;
		},
		get fieldErrors() {
			return fieldErrors;
		},
		get isRouting() {
			return isRouting;
		},
		get isImportingGpx() {
			return isImportingGpx;
		},
		get routeAlternatives() {
			return routeAlternatives;
		},
		get selectedRouteIndex() {
			return selectedRouteIndex;
		},
		get lockedSegmentIndexes() {
			return lockedSegmentIndexes;
		},
		get avoidedRoads() {
			return avoidedRoads;
		},
		get lastGeneratedRouteCount() {
			return lastGeneratedRouteCount;
		},
		get routeExportError() {
			return routeExportError;
		},
		get routeShareErrors() {
			return routeShareErrors;
		},
		get routeShareUrls() {
			return routeShareUrls;
		},
		get isSharingRoute() {
			return isSharingRoute;
		},
		get activeRouteShareCopied() {
			return activeRouteShareCopied;
		},
		get saveSyncError() {
			return saveSyncError;
		},
		get activeSavedRouteId() {
			return activeSavedRouteId;
		},
		get plannerDraftRouteId() {
			return plannerDraftRouteId;
		},
		get isActiveRouteSaved() {
			return isActiveRouteSaved;
		},
		get pendingSavedRouteId() {
			return pendingSavedRouteId;
		},
		get clientFetch() {
			return clientFetch;
		},
		get activeProfileIndex() {
			return activeProfileIndex;
		},
		get chartScrubPointerId() {
			return chartScrubPointerId;
		},
		get mapClickSelection() {
			return mapClickSelection;
		},
		get isResolvingMapSelection() {
			return isResolvingMapSelection;
		},
		get currentLocation() {
			return currentLocation;
		},
		get currentLocationFocusKey() {
			return currentLocationFocusKey;
		},
		get recenterRouteRequestKey() {
			return recenterRouteRequestKey;
		},
		get fitInitialSavedRouteBounds() {
			return fitInitialSavedRouteBounds;
		},
		get isLocating() {
			return isLocating;
		},
		get currentLocationError() {
			return currentLocationError;
		},
		get gpxImportInput() {
			return gpxImportInput;
		},
		set gpxImportInput(value) {
			gpxImportInput = value;
		},
		get undoStack() {
			return undoStack;
		},
		get redoStack() {
			return redoStack;
		},
		get advancedOpen() {
			return advancedOpen;
		},
		set advancedOpen(value) {
			advancedOpen = value;
		},
		get completionController() {
			return completionController;
		},
		get selectedCueIndex() {
			return selectedCueIndex;
		},
		get selectedCueFocusKey() {
			return selectedCueFocusKey;
		},
		get lastCueRouteKey() {
			return lastCueRouteKey;
		},
		get selectedBasemap() {
			return selectedBasemap;
		},
		get availableBasemapOptions() {
			return availableBasemapOptions;
		},
		get isRoundCourseMode() {
			return isRoundCourseMode;
		},
		get isOutAndBackMode() {
			return isOutAndBackMode;
		},
		get activeRoute() {
			return activeRoute;
		},
		get activeDirections() {
			return activeDirections;
		},
		get activeTurnCount() {
			return activeTurnCount;
		},
		get selectedCue() {
			return selectedCue;
		},
		get activeRouteShareKey() {
			return activeRouteShareKey;
		},
		get activeRouteShareError() {
			return activeRouteShareError;
		},
		get activeRouteShareUrl() {
			return activeRouteShareUrl;
		},
		get isActiveRouteShareCopied() {
			return isActiveRouteShareCopied;
		},
		get activeRoundCourseTarget() {
			return activeRoundCourseTarget;
		},
		get activeRouteClimbs() {
			return activeRouteClimbs;
		},
		get activeRouteGradientMetrics() {
			return activeRouteGradientMetrics;
		},
		get activeRouteGradientGeoJson() {
			return activeRouteGradientGeoJson;
		},
		get canShowGradientOverlay() {
			return canShowGradientOverlay;
		},
		get activeRouteWindGeoJson() {
			return activeRouteWindGeoJson;
		},
		get canShowWindOverlay() {
			return canShowWindOverlay;
		},
		get activeWindSummary() {
			return activeWindSummary;
		},
		get strongestWindSegments() {
			return strongestWindSegments;
		},
		get activeCategorizedClimbs() {
			return activeCategorizedClimbs;
		},
		get activeKeyClimbs() {
			return activeKeyClimbs;
		},
		get hardestClimb() {
			return hardestClimb;
		},
		get routeOverlays() {
			return routeOverlays;
		},
		get constraintOverlay() {
			return constraintOverlay;
		},
		get avoidanceOverlay() {
			return avoidanceOverlay;
		},
		get activeRouteSegmentCount() {
			return activeRouteSegmentCount;
		},
		get sanitizedLockedSegmentIndexes() {
			return sanitizedLockedSegmentIndexes;
		},
		get lockedSegmentOverlay() {
			return lockedSegmentOverlay;
		},
		get combinedRouteBounds() {
			return combinedRouteBounds;
		},
		get surfaceMix() {
			return surfaceMix;
		},
		get activeWarnings() {
			return activeWarnings;
		},
		get activeReadinessWarnings() {
			return activeReadinessWarnings;
		},
		get activeProviderWarnings() {
			return activeProviderWarnings;
		},
		get primaryActiveWarning() {
			return primaryActiveWarning;
		},
		get activeImportedRouteSource() {
			return activeImportedRouteSource;
		},
		get alternativeInfoMessage() {
			return alternativeInfoMessage;
		},
		get elevationSamples() {
			return elevationSamples;
		},
		get chartH() {
			return chartH;
		},
		get elevMin() {
			return elevMin;
		},
		get elevMax() {
			return elevMax;
		},
		get elevRange() {
			return elevRange;
		},
		get sampledProfileDistanceTotal() {
			return sampledProfileDistanceTotal;
		},
		get chartProfilePoints() {
			return chartProfilePoints;
		},
		get activeProfilePoint() {
			return activeProfilePoint;
		},
		get highlightedRouteCoordinate() {
			return highlightedRouteCoordinate;
		},
		get linePoints() {
			return linePoints;
		},
		get areaD() {
			return areaD;
		},
		get distanceTickLabels() {
			return distanceTickLabels;
		},
		get canUndoRouteEdit() {
			return canUndoRouteEdit;
		},
		get canRedoRouteEdit() {
			return canRedoRouteEdit;
		},
		get hasAdvancedErrors() {
			return hasAdvancedErrors;
		},
		showCurrentLocationOnMap,
		recenterActiveRoute,
		selectCue,
		getWindSegmentDistanceRange,
		formatCueSegmentTime,
		getDestinationFieldLabel,
		getDestinationSuggestionsLabel,
		getDestinationPlaceholder,
		getCurrentLocationDestinationLabel,
		getSubmitButtonText,
		resetSpatialConstraintDefaults,
		getPlannerFormState,
		applyPlannerFormState,
		getPlannerRouteState,
		applyPlannerRouteState,
		syncStopsFromRoute,
		syncActiveRouteManualEditing,
		setRouteAlternativesState,
		setSingleRouteState,
		selectRouteAlternative,
		markPlannerEdited,
		cancelAutosaveTimer,
		getActiveRouteForSaving,
		saveActiveRouteDraft,
		scheduleActiveRouteAutosave,
		captureRouteEditSnapshot,
		performRouteEdit,
		performAsyncRouteEdit,
		undoRouteEdit,
		redoRouteEdit,
		clearRouteEditHistory,
		setPlannerMode,
		restoreSavedRouteFromLocation,
		restorePendingSavedRoute,
		restoreSavedRoute,
		updateRoundCourseTargetKind,
		updateRoundCourseDistanceInput,
		updateRoundCourseDuration,
		updateRoundCourseAscend,
		updateSpatialConstraintKind,
		updateSpatialConstraintEnforcement,
		setConstraintCenterStop,
		updateConstraintCenterInput,
		updateAreaRadiusInput,
		updateCorridorWidthInput,
		handleChartPointerDown,
		handleChartPointerMove,
		handleChartPointerLeave,
		get releaseChartScrub() {
			return releaseChartScrub;
		},
		handleChartLostPointerCapture,
		closeCompletionMenu,
		setFieldStop,
		setWaypointStop,
		handleFieldInput,
		updateField,
		getWaypointError,
		clearWaypointError,
		updateWaypoint,
		handleWaypointInput,
		addWaypoint,
		removeWaypoint,
		canMoveWaypoint,
		moveWaypoint,
		closeMapClickMenu,
		handleMapClick,
		getMapClickMenuTitle,
		getMapClickMenuSubtitle,
		getRemoveActionLabel,
		removeSelectedMapStop,
		getSelectedSegmentIndex,
		isMapSelectionSegmentLocked,
		toggleMapSelectionSegmentLock,
		getAvoidanceForSelection,
		isMapSelectionRoadAvoided,
		toggleMapSelectionRoadAvoidance,
		removeAvoidedRoad,
		getMapWaypointInsertionSegmentIndex,
		isMapWaypointInsertionLocked,
		applyMapPointAsStop,
		requestRouteCalculation,
		rerouteAfterManualEdit,
		isLockedStopIndex,
		handleRouteStopDragEnd,
		handleRouteSegmentDragEnd,
		useCurrentLocationAsStop,
		handleGenerateRoute,
		handleSaveDraft,
		handleShareActiveRoute,
		handleExportGpx,
		handleExportFit,
		openGpxImportPicker,
		chooseBasemap,
		handleGpxImportSelection,
	};

	return {
		...controller,
		form: controller,
		routes: controller,
		map: controller,
		importExport: controller,
		sharing: controller,
		save: controller,
		overlays: controller,
		analysis: controller,
	};
}

export type PlannerPageContext = ReturnType<typeof createPlannerPageContext>;
