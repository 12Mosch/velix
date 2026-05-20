<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { env } from "$env/dynamic/public";
	import { useConvexClient } from "convex-svelte";
	import { api } from "../convex/_generated/api";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Separator } from "$lib/components/ui/separator/index.js";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { useSidebar } from "$lib/components/ui/sidebar/index.js";
	import MapView from "$lib/components/map-view.svelte";
	import MapClickMenu from "$lib/components/route-planner/map-click-menu.svelte";
	import PlannerStopInput from "$lib/components/route-planner/planner-stop-input.svelte";
	import { getBasemapById } from "$lib/map/basemaps";
	import {
		parseRouteGpx,
		RouteGpxImportError,
	} from "$lib/route-gpx-import";
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
		getDistanceUnitLabel,
		initUnitPreference,
		parseDistanceInputToMeters,
		unitPreference,
		formatDistanceValue,
	} from "$lib/unit-settings.svelte";
	import {
		deleteSavedRoute,
		getSavedRouteById,
		initSavedRoutes,
		isPlannedRoute,
		savedRoutesState,
		upsertSavedRoute,
	} from "$lib/saved-routes.svelte";
	import {
		serializeSavedRouteForRemote,
	} from "$lib/saved-routes-core";
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
		type RoundCourseTarget,
		type RouteApiError,
		type RouteApiSuccess,
		type RouteMapOverlay,
		type RouteClimb,
		type RouteRequestPayload,
		type RouteWarning,
		type RouteWindSegment,
		type SpatialConstraintEnforcement,
	} from "$lib/route-planning";
	import {
		areaRadiusStepMeters,
		chartW,
		completionDebounceMs,
		constraintCenterCompletionTarget,
		corridorWidthStepMeters,
		defaultAreaRadiusMeters,
		defaultCorridorWidthMeters,
		defaultSpatialConstraintEnforcement,
		destinationCompletionTarget,
		desiredAlternativeRoutes,
		gpxFileAccept,
		maxAreaRadiusMeters,
		maxCorridorWidthMeters,
		maxRouteEditHistoryEntries,
		maxWaypoints,
		minAreaRadiusMeters,
		minCompletionQueryLength,
		minCorridorWidthMeters,
		padY,
		plannerModeOptions,
		startCompletionTarget,
	} from "$lib/route-planner/constants";
	import {
		formatCoordinateLabel,
		formatDistanceInputAttribute,
		formatDuration,
		formatElevation,
		formatExactDistance,
		formatGrade,
		formatWindBucket,
		formatWindComponent,
		formatWindSpeed,
		formatRoundCourseTarget,
		formatSpatialConstraintEnforcement,
		formatSpatialConstraintSummary,
		getClimbColor,
		getClimbLabel,
		getImportedRouteStopSummary,
		getRouteDurationText,
		getRoutingBadgeLabel,
		getRoutingProfileLabel,
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
	} from "$lib/route-planner/page/planner-completion.svelte.ts";
	import {
		AlertTriangle,
		ArrowDown,
		ArrowLeft,
		ArrowRight,
		ArrowUp,
		Check,
		ChevronDown,
		ChevronUp,
		CircleDot,
		CornerDownLeft,
		CornerDownRight,
		Flag,
		Layers,
		LocateFixed,
		MapPin,
		MountainSnow,
		Navigation,
		Plus,
		Redo2,
		Route,
		ShieldCheck,
		Share2,
		Shuffle,
		TrendingDown,
		TrendingUp,
		Undo2,
		Wind,
		X,
	} from "@lucide/svelte";

	const sidebar = useSidebar();

	let directionsOpen = $state(false);
	let selectedCueIndex = $state<number | null>(null);
	let selectedCueFocusKey = $state(0);
	let lastCueRouteKey = $state<string | null>(null);

	function getOptionalConvexClient() {
		if (!env.PUBLIC_CONVEX_URL) {
			return null;
		}

		try {
			return useConvexClient();
		} catch {
			return null;
		}
	}

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
	let spatialConstraintEnforcement =
		$state<SpatialConstraintEnforcement>(defaultSpatialConstraintEnforcement);
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
	let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
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
		selectedRouteIndex === null ? null : routeAlternatives[selectedRouteIndex] ?? null,
	);
	const activeDirections = $derived(activeRoute?.instructions ?? []);
	const activeTurnCount = $derived(activeRoute ? getRouteTurnCount(activeRoute) : 0);
	const selectedCue = $derived(
		selectedCueIndex === null ? null : activeDirections[selectedCueIndex] ?? null,
	);
	const activeRouteShareKey = $derived(
		activeRoute ? (plannerDraftRouteId ?? activeSavedRouteId ?? getRouteShareSignature(activeRoute)) : null,
	);
	const activeRouteShareError = $derived(
		activeRouteShareKey ? (routeShareErrors[activeRouteShareKey] ?? null) : null,
	);
	const activeRouteShareUrl = $derived(
		activeRouteShareKey ? (routeShareUrls[activeRouteShareKey] ?? null) : null,
	);
	const isActiveRouteShareCopied = $derived(
		activeRouteShareKey ? Boolean(activeRouteShareCopied[activeRouteShareKey]) : false,
	);
	const activeRoundCourseTarget = $derived(getRoundCourseTarget(activeRoute));
	const activeRouteClimbs = $derived<RouteClimb[]>(
		activeRoute ? analyzeRouteClimbs(getRouteElevationAnalysisPoints(activeRoute.coordinates)) : [],
	);
	const activeRouteGradientMetrics = $derived(
		activeRoute ? calculateRouteGradientMetrics(activeRoute) : null,
	);
	const activeRouteGradientGeoJson = $derived(
		activeRoute ? buildRouteGradientGeoJson(activeRoute) : null,
	);
	const canShowGradientOverlay = $derived(
		(activeRouteGradientGeoJson?.features.length ?? 0) > 0,
	);
	const activeRouteWindGeoJson = $derived(
		activeRoute ? buildRouteWindGeoJson(activeRoute) : null,
	);
	const canShowWindOverlay = $derived(
		(activeRouteWindGeoJson?.features.length ?? 0) > 0,
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
			(hardest, climb) => (!hardest || climb.score > hardest.score ? climb : hardest),
			null,
		),
	);
	const routeOverlays = $derived<RouteMapOverlay[]>(
		routeAlternatives.map((route, index) => {
			const baseGeoJson = buildRouteGeoJson(route);
			const isSelected = index === selectedRouteIndex;

			return {
				id: `route-${index}`,
				geoJson: isSelected
					? {
							...baseGeoJson,
							features: [
								...baseGeoJson.features,
								...buildRouteSurfaceGeoJson(route).features,
								...buildRouteClimbGeoJson(route, activeRouteClimbs).features,
								...(gradientOverlayEnabled && activeRouteGradientGeoJson
									? activeRouteGradientGeoJson.features
									: []),
								...(windOverlayEnabled && activeRouteWindGeoJson
									? activeRouteWindGeoJson.features
									: []),
							],
						}
					: baseGeoJson,
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
	const activeWarnings = $derived(activeRoute ? getRouteWarnings(activeRoute) : []);
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
		lastGeneratedRouteCount !== null && lastGeneratedRouteCount < desiredAlternativeRoutes
			? `Found ${lastGeneratedRouteCount} distinct route${lastGeneratedRouteCount === 1 ? "" : "s"} for this request.`
			: null,
	);
	const elevationSamples = $derived(activeRoute ? sampleElevationProfile(activeRoute.coordinates) : []);
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
					? (point.distanceMeters / Math.max(sampledProfileDistanceTotal ?? 1, 1)) * chartW
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
		activeProfileIndex === null ? null : chartProfilePoints[activeProfileIndex] ?? null,
	);
	const highlightedRouteCoordinate = $derived(
		selectedCue?.coordinate ?? activeProfilePoint?.coordinate ?? null,
	);
	const linePoints = $derived(
		chartProfilePoints
			.map((point) => `${point.x},${point.y}`)
			.join(" "),
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
		const nextRouteKey = activeRoute ? getRouteShareSignature(activeRoute) : null;

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
			(activeProfileIndex < 0 || activeProfileIndex >= chartProfilePoints.length)
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
		restorePendingSavedRoute();
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

	onMount(() => {
		clientFetch = window.fetch.bind(window);
		initUnitPreference();
		resetSpatialConstraintDefaults();
		initSavedRoutes();
		restoreSavedRouteFromLocation();
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

		window.addEventListener("keydown", handleRouteEditKeydown);
		detachRouteEditKeyboardListener = () => {
			window.removeEventListener("keydown", handleRouteEditKeydown);
			detachRouteEditKeyboardListener = () => {};
		};
	});

	onDestroy(() => {
		completionController.destroy();
		cancelAutosaveTimer();
		detachRouteEditKeyboardListener();
	});

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

	function getCurrentLocationStop(point: [number, number], label: string): PlannerStop {
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
				throw new Error(`Reverse geocoding failed with status ${response.status}`);
			}

			const payload = (await response.json()) as Partial<ReverseGeocodeApiSuccess>;
			return typeof payload.label === "string" && payload.label.trim().length > 0
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
			currentIndexes.every((index, itemIndex) => index === nextIndexes[itemIndex])
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
				? withPlannerRouteState(route, nextLockedSegmentIndexes, nextAvoidedRoads)
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
		scheduleActiveRouteAutosave();
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

	function saveActiveRouteDraft() {
		cancelAutosaveTimer();
		const routeForSaving = getActiveRouteForSaving();

		if (!routeForSaving) {
			return null;
		}

		const savedRoute = upsertSavedRoute(
			routeForSaving,
			plannerDraftRouteId ?? activeSavedRouteId ?? undefined,
		);
		plannerDraftRouteId = savedRoute.id;
		activeSavedRouteId = savedRoute.id;
		isActiveRouteSaved = true;
		return savedRoute;
	}

	function scheduleActiveRouteAutosave() {
		cancelAutosaveTimer();
		autosaveTimer = setTimeout(() => {
			saveActiveRouteDraft();
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

	function restoreRouteEditSnapshot(snapshot: RouteEditSnapshot) {
		closeCompletionMenu();
		closeMapClickMenu();
		const restoredState = restorePlannerSnapshot(snapshot);
		applyPlannerRouteState(restoredState.routeState);
		applyPlannerFormState(restoredState.form);
		routeRequestError = null;
		routeImportError = null;
		routeExportError = null;
		activeProfileIndex = null;
		chartScrubPointerId = null;
		markPlannerEdited();
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
		editFn: () => Promise<boolean | undefined>,
		options: RouteEditSnapshotOptions = {},
	) {
		if (!activeRoute) {
			await editFn();
			return;
		}

		const previousSnapshot = captureRouteEditSnapshot(options);
		const changed = await editFn();

		if (changed === false) {
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

	function restoreSavedRouteFromLocation() {
		const savedRouteId = new URLSearchParams(window.location.search).get("savedRoute");

		if (!savedRouteId) {
			return;
		}

		fitInitialSavedRouteBounds = true;
		const savedRoute = getSavedRouteById(savedRouteId);

		if (!savedRoute) {
			pendingSavedRouteId = savedRouteId;
			return;
		}

		restoreSavedRoute(savedRoute);
	}

	function restorePendingSavedRoute() {
		if (!pendingSavedRouteId) {
			return;
		}

		const savedRoute = getSavedRouteById(pendingSavedRouteId);

		if (!savedRoute) {
			return;
		}

		restoreSavedRoute(savedRoute);
		pendingSavedRouteId = null;
	}

	function restoreSavedRoute(savedRoute: NonNullable<ReturnType<typeof getSavedRouteById>>) {
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
		completionController.scheduleLookup(constraintCenterCompletionTarget, value);
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
		const bounds = (event.currentTarget as SVGSVGElement).getBoundingClientRect();

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
			(event.currentTarget as SVGSVGElement).setPointerCapture?.(event.pointerId);
		} catch {
			// Synthetic test events can dispatch without an active capturable pointer.
		}

		updateActiveProfileFromPointer(event);
	}

	function handleChartPointerMove(event: PointerEvent) {
		if (event.pointerType !== "mouse" && chartScrubPointerId !== event.pointerId) {
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
			(event.currentTarget as SVGSVGElement).releasePointerCapture?.(event.pointerId);
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
			field === "startQuery" ? startCompletionTarget : destinationCompletionTarget,
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
				waypointIndex === index ? "" : fieldErrors.waypointQueries?.[waypointIndex] || "",
			),
		};
	}

	function updateWaypoint(index: number, value: string) {
		setWaypointStop(index, createPlannerStop(value));
	}

	function handleWaypointInput(index: number, value: string) {
		updateWaypoint(index, value);
		completionController.scheduleLookup(getWaypointCompletionTarget(index), value);
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

		waypointStops = waypointStops.filter((_, waypointIndex) => waypointIndex !== index);
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

		return selection.selectedStop?.label || formatCoordinateLabel(selection.point);
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

		const nextLockedSegmentIndexes = sanitizedLockedSegmentIndexes.includes(segmentIndex)
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

	function getDistanceToSegmentMeters(
		point: [number, number],
		start: [number, number],
		end: [number, number],
	) {
		const lat = ((point[1] + start[1] + end[1]) / 3 * Math.PI) / 180;
		const metersPerLng = 111_320 * Math.cos(lat);
		const metersPerLat = 110_540;
		const startX = (start[0] - point[0]) * metersPerLng;
		const startY = (start[1] - point[1]) * metersPerLat;
		const endX = (end[0] - point[0]) * metersPerLng;
		const endY = (end[1] - point[1]) * metersPerLat;
		const dx = endX - startX;
		const dy = endY - startY;
		const lengthSquared = dx * dx + dy * dy;

		if (lengthSquared <= 0) {
			return Math.hypot(startX, startY);
		}

		const ratio = Math.max(
			0,
			Math.min(1, -(startX * dx + startY * dy) / lengthSquared),
		);
		return Math.hypot(startX + dx * ratio, startY + dy * ratio);
	}

	function isPointNearLine(
		point: [number, number],
		line: [number, number][],
		toleranceMeters: number,
	) {
		return line.slice(0, -1).some((start, index) => {
			const end = line[index + 1];
			return end
				? getDistanceToSegmentMeters(point, start, end) <= toleranceMeters
				: false;
		});
	}

	function getAvoidanceForSelection(selection: MapClickSelection) {
		if (!selection.selectedSegment) {
			return null;
		}

		const point = selection.point;
		return (
			avoidedRoads.find((avoidance) =>
				isPointNearLine(point, avoidance.centerline, avoidance.bufferMeters + 20),
			) ?? null
		);
	}

	function isMapSelectionRoadAvoided(selection: MapClickSelection) {
		return !!selection.selectedSegment && !!getAvoidanceForSelection(selection);
	}

	function buildAvoidancePlaceholderPolygon(
		centerline: [number, number][],
		bufferMeters: number,
	): [number, number][] {
		const lngs = centerline.map((point) => point[0]);
		const lats = centerline.map((point) => point[1]);
		const centerLat = lats.reduce((sum, lat) => sum + lat, 0) / Math.max(lats.length, 1);
		const deltaLng = bufferMeters / Math.max(111_320 * Math.cos((centerLat * Math.PI) / 180), 1);
		const deltaLat = bufferMeters / 110_540;
		const minLng = Math.min(...lngs) - deltaLng;
		const maxLng = Math.max(...lngs) + deltaLng;
		const minLat = Math.min(...lats) - deltaLat;
		const maxLat = Math.max(...lats) + deltaLat;

		return [
			[minLng, minLat],
			[maxLng, minLat],
			[maxLng, maxLat],
			[minLng, maxLat],
			[minLng, minLat],
		];
	}

	function getSelectedAvoidanceCenterline(selection: MapClickSelection) {
		if (!activeRoute || !selection.selectedSegment) {
			return null;
		}

		const selectedIndex = selection.selectedSegment.coordinateSegmentIndex;
		const startIndex = Math.max(0, selectedIndex - 3);
		const endIndex = Math.min(activeRoute.coordinates.length - 1, selectedIndex + 4);
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
		await performAsyncRouteEdit(async () => {
			const previousAvoidedRoads = avoidedRoads;
			const nextAvoidedRoads = avoidedRoads.filter(
				(avoidance) =>
					!isPointNearLine(
						selection.point,
						avoidance.centerline,
						avoidance.bufferMeters + 20,
					),
			);

			if (nextAvoidedRoads.length !== avoidedRoads.length) {
				avoidedRoads = nextAvoidedRoads;
				const routed = await rerouteAfterManualEdit();
				if (!routed) avoidedRoads = previousAvoidedRoads;
				return routed;
			}

			const centerline = getSelectedAvoidanceCenterline(selection);
			if (!centerline) {
				return false;
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
			const routed = await rerouteAfterManualEdit();
			if (!routed) avoidedRoads = previousAvoidedRoads;
			return routed;
		}, { includeRoutesGeometry: true });
		return true;
	}

	function removeAvoidedRoad(index: number) {
		if (index < 0 || index >= avoidedRoads.length || isRouting) {
			return;
		}

		void performAsyncRouteEdit(async () => {
			const previousAvoidedRoads = avoidedRoads;
			avoidedRoads = avoidedRoads.filter((_, itemIndex) => itemIndex !== index);
			const routed = await rerouteAfterManualEdit();
			if (!routed) avoidedRoads = previousAvoidedRoads;
			return routed;
		}, { includeRoutesGeometry: true });
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
		return getSelectedSegmentIndex(selection) ?? getWaypointInsertionTarget(selection.point);
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
				throw new Error(`Reverse geocoding failed with status ${response.status}`);
			}

			const payload = (await response.json()) as Partial<ReverseGeocodeApiSuccess>;
			return typeof payload.label === "string" && payload.label.trim().length > 0
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
				return changed;
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
			throw new Error("Route requests are only available after the page has mounted.");
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

		if (plannerMode === "out_and_back" && selectedStop.index >= waypointStops.length) {
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
		await performAsyncRouteEdit(async () => {
			const label = await resolveMapStopLabel(detail.point);
			updateDraggedStop(detail.selectedStop, detail.point, label);
			return rerouteAfterManualEdit();
		}, { includeRoutesGeometry: true });
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
		await performAsyncRouteEdit(async () => {
			const existingWaypointIndex = getManualSegmentWaypointIndex(routeLegIndex);
			const label = await resolveMapStopLabel(detail.point);
			const stop = createPlannerStop(label, detail.point, "map");

			if (existingWaypointIndex !== null) {
				setWaypointStop(existingWaypointIndex, stop);
			} else {
				if (waypointStops.length >= maxWaypoints) {
					routeRequestError = `You can add up to ${maxWaypoints} waypoints per route.`;
					return false;
				}

				addWaypoint(
					stop,
					Math.max(0, Math.min(routeLegIndex, waypointStops.length)),
					false,
				);
			}

			return rerouteAfterManualEdit();
		}, { includeRoutesGeometry: true });
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
			routeRequestError = "Route requests are only available after the page has mounted.";
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

	function handleSaveDraft() {
		if (!activeRoute) {
			return;
		}

		if (isActiveRouteSaved && activeSavedRouteId) {
			const deletedRouteId = activeSavedRouteId;
			cancelAutosaveTimer();
			deleteSavedRoute(deletedRouteId);
			if (plannerDraftRouteId === deletedRouteId) {
				plannerDraftRouteId = null;
			}
			activeSavedRouteId = null;
			isActiveRouteSaved = false;
			return;
		}

		const savedRoute = saveActiveRouteDraft();
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
			const savedRoute = saveActiveRouteDraft();

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
			const shareUrl = buildShareUrl(window.location.origin, result.shareToken);
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
</script>

{#snippet routeSummarySkeleton()}
	<div
		class="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3"
		role="status"
		aria-live="polite"
		aria-label={getSubmitButtonText()}
	>
		<span class="sr-only">
			{isRoundCourseMode
				? "Calculating the round course..."
				: isOutAndBackMode
					? "Calculating the out-and-back route..."
					: "Calculating the road-bike route..."}
		</span>
		<Skeleton class="h-7 w-24 rounded-md" />
		<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
		<Skeleton class="h-6 w-20 rounded-md" />
		<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
		<Skeleton class="h-6 w-20 rounded-md" />
		<span class="hidden text-border md:inline" aria-hidden="true">·</span>
		<Skeleton class="h-6 w-24 rounded-md" />
	</div>
{/snippet}

<div class="relative flex h-full w-full flex-col overflow-hidden bg-background">
	<input
		bind:this={gpxImportInput}
		type="file"
		accept={gpxFileAccept}
		class="sr-only"
		aria-label="Import GPX file"
		onchange={handleGpxImportSelection}
	/>
	<MapView
		layoutState={sidebar.state}
		onMapClick={handleMapClick}
		onRouteStopDragEnd={handleRouteStopDragEnd}
		onRouteSegmentDragEnd={handleRouteSegmentDragEnd}
		routeOverlays={routeOverlays}
		plannedRoute={activeRoute}
		routeMode={activeRoute?.mode ?? plannerMode}
		manualEditingEnabled={!!activeRoute && !isRouting}
		lockedSegmentOverlay={lockedSegmentOverlay}
		lockedSegmentIndexes={sanitizedLockedSegmentIndexes}
		constraintOverlay={constraintOverlay}
		avoidanceOverlay={avoidanceOverlay}
		fitBounds={combinedRouteBounds}
		fitInitialBoundsWithRestoredCamera={fitInitialSavedRouteBounds}
		manualRecenterBounds={activeRoute?.bounds ?? null}
		manualRecenterRequestKey={recenterRouteRequestKey}
		hoveredRouteCoordinate={highlightedRouteCoordinate}
		focusedRouteCoordinate={selectedCue?.coordinate ?? null}
		focusedRouteCoordinateKey={selectedCueFocusKey}
		currentLocation={currentLocation}
		currentLocationFocusKey={currentLocationFocusKey}
	/>

	<div class="pointer-events-none absolute inset-0 z-20">
		{#if sidebar.isMobile}
			<div class="pointer-events-auto absolute left-4 top-4">
				<Sidebar.Trigger
					class="size-9 rounded-lg border border-border/60 bg-background/85 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 focus-visible:ring-offset-0"
				/>
			</div>
		{/if}
		<div class="pointer-events-auto absolute right-4 top-4 flex flex-col gap-2 md:right-5 md:top-5">
			<DropdownMenu.DropdownMenu>
				<DropdownMenu.DropdownMenuTrigger>
					{#snippet child({ props: _props })}
						<Button
							{..._props}
							variant="ghost"
							size="icon"
							class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground"
							type="button"
							aria-label="Choose basemap"
						>
							<Layers class="size-4" />
						</Button>
					{/snippet}
				</DropdownMenu.DropdownMenuTrigger>
				<DropdownMenu.DropdownMenuContent align="end" class="w-64">
					<DropdownMenu.DropdownMenuLabel>Basemap</DropdownMenu.DropdownMenuLabel>
					<DropdownMenu.DropdownMenuSeparator />
					<DropdownMenu.DropdownMenuRadioGroup
						value={mapStylePreference.selectedBasemapId ?? undefined}
						onValueChange={(id) => chooseBasemap(id as BasemapId)}
					>
						{#each availableBasemapOptions as basemap}
							<DropdownMenu.DropdownMenuRadioItem value={basemap.id}>
								<div class="flex min-w-0 flex-col gap-0.5">
									<span class="truncate text-sm font-medium">{basemap.label}</span>
									<span class="truncate text-xs text-muted-foreground capitalize">
										{basemap.provider}
									</span>
								</div>
							</DropdownMenu.DropdownMenuRadioItem>
						{/each}
					</DropdownMenu.DropdownMenuRadioGroup>
				</DropdownMenu.DropdownMenuContent>
			</DropdownMenu.DropdownMenu>
			<Button
				variant="ghost"
				size="icon"
				class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground"
				type="button"
				disabled={isLocating}
				aria-label="Show current location"
				onclick={showCurrentLocationOnMap}
			>
				<LocateFixed class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50"
				type="button"
				disabled={!activeRoute}
				aria-label="Recenter route"
				onclick={recenterActiveRoute}
			>
				<Route class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50 data-[active=true]:border-orange-300/70 data-[active=true]:bg-orange-50/90 data-[active=true]:text-orange-700"
				type="button"
				disabled={!canShowGradientOverlay}
				aria-label="Gradient overlay"
				aria-pressed={gradientOverlayEnabled}
				data-active={gradientOverlayEnabled}
				onclick={() => (gradientOverlayEnabled = !gradientOverlayEnabled)}
			>
				<MountainSnow class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50 data-[active=true]:border-teal-300/70 data-[active=true]:bg-teal-50/90 data-[active=true]:text-teal-700"
				type="button"
				disabled={!canShowWindOverlay}
				aria-label="Wind and conditions"
				aria-pressed={windOverlayEnabled}
				data-active={windOverlayEnabled}
				onclick={() => (windOverlayEnabled = !windOverlayEnabled)}
			>
				<Wind class="size-4" />
			</Button>
		</div>
		{#if mapClickSelection}
			<MapClickMenu
				selection={mapClickSelection}
				{plannerMode}
				{isOutAndBackMode}
				waypointCount={waypointStops.length}
				{maxWaypoints}
				isResolving={isResolvingMapSelection}
				title={getMapClickMenuTitle(mapClickSelection)}
				subtitle={getMapClickMenuSubtitle(mapClickSelection)}
				removeActionLabel={getRemoveActionLabel}
				isWaypointInsertionLocked={isMapWaypointInsertionLocked}
				isSegmentLocked={isMapSelectionSegmentLocked}
				isSegmentAvoided={isMapSelectionRoadAvoided}
				onApplyAsStart={() => applyMapPointAsStop({ kind: "startQuery" })}
				onApplyAsWaypoint={() => applyMapPointAsStop({ kind: "waypoint" })}
				onApplyAsDestination={() => applyMapPointAsStop({ kind: "destinationQuery" })}
				onToggleSegmentLock={() =>
					mapClickSelection && toggleMapSelectionSegmentLock(mapClickSelection)}
				onToggleRoadAvoidance={() =>
					mapClickSelection && void toggleMapSelectionRoadAvoidance(mapClickSelection)}
				onRemoveStop={removeSelectedMapStop}
				onClose={closeMapClickMenu}
			/>
		{/if}
	</div>

	<div
		class="pointer-events-none relative z-10 flex h-full min-h-0 w-full flex-col gap-3 p-4 md:p-5"
	>
		<div class="flex min-h-0 min-w-0 flex-1 gap-5 md:gap-6">
			<div
				class="pointer-events-auto absolute inset-x-3 bottom-3 flex max-h-[min(52dvh,28rem)] max-w-none flex-col gap-3 overflow-y-auto md:static md:ml-0 md:mt-4 md:w-full md:max-w-[340px] md:overflow-visible"
			>
				<form
					class="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-lg"
					novalidate
					onsubmit={handleGenerateRoute}
				>
					<div class="flex items-center justify-between gap-3">
						<h2 class="text-base font-semibold tracking-tight md:text-lg">Route Builder</h2>
					</div>

					<div class="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-secondary/15 p-1">
						{#each plannerModeOptions as option}
							<Button
								type="button"
								variant={plannerMode === option.mode ? "secondary" : "ghost"}
								size="sm"
								class={`h-auto min-w-0 whitespace-normal flex-col items-start justify-start gap-0.5 rounded-md px-3 py-2 text-left ${
									plannerMode === option.mode
										? "border-primary/20 bg-background shadow-sm"
										: "text-muted-foreground"
								}`}
								aria-pressed={plannerMode === option.mode}
								onclick={() => setPlannerMode(option.mode)}
							>
								<span class="text-xs font-semibold uppercase tracking-wide">
									{option.label}
								</span>
								<span class="text-[11px] leading-relaxed opacity-80">
									{option.description}
								</span>
							</Button>
						{/each}
					</div>

					<div class="flex min-w-0 flex-1 flex-col gap-3">
						<PlannerStopInput
							id="start-point"
							label="Start"
							value={startStop.label}
							placeholder="Enter starting point..."
							target={startCompletionTarget}
							controller={completionController}
							completionLabel="Start suggestions"
							error={fieldErrors.startQuery}
							inputClass="border-none bg-secondary/20 pl-9 pr-10 focus-visible:ring-1 focus-visible:ring-primary/50"
							onInput={(value) => handleFieldInput("startQuery", value)}
						>
							{#snippet leading()}
								<MapPin class="size-4 text-muted-foreground" />
							{/snippet}
							{#snippet trailing()}
								<Button
									variant="ghost"
									size="icon-xs"
									type="button"
									class="size-7 text-muted-foreground hover:text-foreground"
									disabled={isLocating}
									aria-label="Use current location as start"
									onclick={() => useCurrentLocationAsStop("startQuery")}
								>
									<LocateFixed class="size-3.5" />
								</Button>
							{/snippet}
						</PlannerStopInput>

						{#if isRoundCourseMode}
							{#if roundCourseTargetKind === "distance"}
								<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-3">
									<div class="space-y-2">
										<label
											for="round-course-distance"
											class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
										>
											Target distance
										</label>
										<div class="relative">
											<Input
												id="round-course-distance"
												type="number"
												min="1"
												step="0.5"
												inputmode="decimal"
												value={roundCourseDistanceInput}
												placeholder="e.g. 60"
												class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
												aria-invalid={fieldErrors.roundCourseTarget ? "true" : undefined}
												oninput={(event) =>
													updateRoundCourseDistanceInput(
														(event.currentTarget as HTMLInputElement).value,
													)}
											/>
											<span
												class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
											>
												{getDistanceUnitLabel()}
											</span>
										</div>
									</div>
									{#if fieldErrors.roundCourseTarget}
										<p class="text-xs font-medium text-destructive">
											{fieldErrors.roundCourseTarget}
										</p>
									{/if}
								</div>
							{/if}
						{:else}
							{#if advancedOpen && !isRoundCourseMode}
							<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-3">
								<div class="flex items-center justify-between gap-3">
									<div>
										<div class="text-xs font-semibold uppercase tracking-wide text-foreground/80">
											Waypoints
										</div>
									</div>
									<Button
										variant="ghost"
										size="sm"
										type="button"
										class="gap-1"
										disabled={waypointStops.length >= maxWaypoints}
										onclick={() => addWaypoint()}
									>
										<Plus class="size-3.5" />
										Add waypoint
									</Button>
								</div>

								{#if waypointStops.length > 0}
									<div class="space-y-2">
										{#each waypointStops as waypointStop, index (`waypoint-${index}`)}
											<div class="rounded-md border border-border/50 bg-background/80 p-2.5">
												<div class="flex items-start gap-2">
													<div class="flex h-9 w-7 shrink-0 items-center justify-center">
														<span
															class="flex size-6 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
														>
															{index + 1}
														</span>
													</div>
													<div class="min-w-0 flex-1 space-y-2">
														<label
															for={`waypoint-${index}`}
															class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
														>
															Waypoint {index + 1}
														</label>
														<PlannerStopInput
															id={`waypoint-${index}`}
															label={`Waypoint ${index + 1}`}
															value={waypointStop.label}
															placeholder="Add a stop..."
															target={getWaypointCompletionTarget(index)}
															controller={completionController}
															completionLabel={`Waypoint ${index + 1} suggestions`}
															error={getWaypointError(index)}
															inputClass="border-none bg-secondary/20 pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
															onInput={(value) => handleWaypointInput(index, value)}
														>
															{#snippet leading()}
																<MapPin class="size-4 text-amber-600 dark:text-amber-300" />
															{/snippet}
														</PlannerStopInput>
													</div>
												</div>
												<div class="mt-2 flex flex-wrap justify-end gap-1.5">
													<Button
														variant="outline"
														size="sm"
														type="button"
														class="gap-1"
														disabled={!canMoveWaypoint(index, -1)}
														onclick={() => moveWaypoint(index, -1)}
													>
														<ArrowUp class="size-3.5" />
														Move up
													</Button>
													<Button
														variant="outline"
														size="sm"
														type="button"
														class="gap-1"
														disabled={!canMoveWaypoint(index, 1)}
														onclick={() => moveWaypoint(index, 1)}
													>
														<ArrowDown class="size-3.5" />
														Move down
													</Button>
													<Button
														variant="ghost"
														size="sm"
														type="button"
														class="gap-1 text-muted-foreground hover:text-foreground"
														disabled={isLockedStopIndex(index + 1)}
														onclick={() => removeWaypoint(index)}
													>
														<X class="size-3.5" />
														Remove
													</Button>
												</div>
											</div>
										{/each}
									</div>
								{:else}
									<p class="rounded-md bg-background/60 px-3 py-2 text-xs text-muted-foreground">
										No waypoints yet. Add one to force the route through intermediate stops.
									</p>
								{/if}
							</div>
							{/if}

							<PlannerStopInput
								id="destination"
								label={getDestinationFieldLabel()}
								value={destinationStop.label}
								placeholder={getDestinationPlaceholder()}
								target={destinationCompletionTarget}
								controller={completionController}
								completionLabel={getDestinationSuggestionsLabel()}
								error={fieldErrors.destinationQuery}
								inputClass="border-none bg-secondary/20 pl-9 pr-10 focus-visible:ring-1 focus-visible:ring-primary/50"
								onInput={(value) => handleFieldInput("destinationQuery", value)}
							>
								{#snippet leading()}
									<Navigation class="size-4 text-primary" />
								{/snippet}
								{#snippet trailing()}
									<Button
										variant="ghost"
										size="icon-xs"
										type="button"
										class="size-7 text-muted-foreground hover:text-foreground"
										disabled={isLocating}
										aria-label={getCurrentLocationDestinationLabel()}
										onclick={() => useCurrentLocationAsStop("destinationQuery")}
									>
										<LocateFixed class="size-3.5" />
									</Button>
								{/snippet}
							</PlannerStopInput>
						{/if}
					</div>

					<Button
						type="button"
						variant="ghost"
						class="justify-between rounded-lg border border-border/60 px-3 font-semibold"
						aria-expanded={advancedOpen}
						aria-controls="route-builder-advanced"
						onclick={() => (advancedOpen = !advancedOpen)}
					>
						Advanced
						{#if advancedOpen}
							<ChevronUp class="size-4 opacity-70" />
						{:else}
							<ChevronDown class="size-4 opacity-70" />
						{/if}
					</Button>

					{#if advancedOpen}
					<div id="route-builder-advanced" class="space-y-3">
						{#if isRoundCourseMode}
							<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-3">
								<div class="space-y-1">
									<div class="block text-xs font-semibold uppercase tracking-wide text-foreground/80">
										Round-course target
									</div>
									<div class="grid grid-cols-3 gap-2">
										{#each [
											{ kind: "distance", label: "Distance" },
											{ kind: "duration", label: "Time" },
											{ kind: "ascend", label: "Climb" },
										] as option}
											<Button
												type="button"
												variant="outline"
												class={`h-auto min-w-0 justify-center rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
													roundCourseTargetKind === option.kind
														? "border-primary/20 bg-background shadow-sm"
														: "text-muted-foreground"
												}`}
												aria-pressed={roundCourseTargetKind === option.kind}
												onclick={() =>
													updateRoundCourseTargetKind(option.kind as RoundCourseTargetKind)}
											>
												{option.label}
											</Button>
										{/each}
									</div>
								</div>

								{#if roundCourseTargetKind === "duration"}
									<div class="space-y-2">
										<label
											for="round-course-time"
											class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
										>
											Target time
										</label>
										<div class="relative">
											<Input
												id="round-course-time"
												value={roundCourseDurationInput}
												placeholder="e.g. 3:30"
												class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
												aria-invalid={fieldErrors.roundCourseTarget ? "true" : undefined}
												oninput={(event) =>
													updateRoundCourseDuration(
														(event.currentTarget as HTMLInputElement).value,
													)}
											/>
											<span
												class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
											>
												h
											</span>
										</div>
									</div>
								{:else if roundCourseTargetKind === "ascend"}
									<div class="space-y-2">
										<label
											for="round-course-climb"
											class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
										>
											Target climb
										</label>
										<div class="relative">
											<Input
												id="round-course-climb"
												type="number"
												min="50"
												step="50"
												inputmode="decimal"
												value={roundCourseAscendMeters}
												placeholder="e.g. 800"
												class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
												aria-invalid={fieldErrors.roundCourseTarget ? "true" : undefined}
												oninput={(event) =>
													updateRoundCourseAscend(
														(event.currentTarget as HTMLInputElement).value,
													)}
											/>
											<span
												class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
											>
												m
											</span>
										</div>
									</div>
								{/if}

								<p class="text-xs text-muted-foreground">
									Distance targets search around the requested loop distance; time
									and climb targets search nearby loop distances for the closest match.
								</p>
								{#if roundCourseTargetKind !== "distance" && fieldErrors.roundCourseTarget}
									<p class="text-xs font-medium text-destructive">
										{fieldErrors.roundCourseTarget}
									</p>
								{/if}
							</div>
						{/if}

						<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-3">
						<div class="space-y-1">
							<div class="text-xs font-semibold uppercase tracking-wide text-foreground/80">
								Route bounds
							</div>
							<div class="grid grid-cols-3 gap-2">
								{#each [
									{ kind: "none", label: "None" },
									{ kind: "area", label: "Area" },
									{ kind: "corridor", label: "Corridor" },
								] as option}
									<Button
										type="button"
										variant="outline"
										class={`h-auto min-w-0 justify-center rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
											spatialConstraintKind === option.kind
												? "border-primary/20 bg-background shadow-sm"
												: "text-muted-foreground"
										}`}
										aria-pressed={spatialConstraintKind === option.kind}
										disabled={isRoundCourseMode && option.kind === "corridor"}
										onclick={() =>
											updateSpatialConstraintKind(option.kind as SpatialConstraintKind)}
									>
										{option.label}
									</Button>
								{/each}
							</div>
						</div>

						{#if spatialConstraintKind !== "none"}
							<div class="grid grid-cols-2 gap-2">
								{#each [
									{ enforcement: "strict", label: "Keep inside" },
									{ enforcement: "preferred", label: "Prefer inside" },
								] as option}
									<Button
										type="button"
										variant="outline"
										class={`h-auto min-w-0 justify-center rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
											spatialConstraintEnforcement === option.enforcement
												? "border-primary/20 bg-background shadow-sm"
												: "text-muted-foreground"
										}`}
										aria-pressed={spatialConstraintEnforcement === option.enforcement}
										onclick={() =>
											updateSpatialConstraintEnforcement(
												option.enforcement as SpatialConstraintEnforcement,
											)}
									>
										{option.label}
									</Button>
								{/each}
							</div>
						{/if}

						{#if spatialConstraintKind === "area"}
							<div class="space-y-2">
								<PlannerStopInput
									id="constraint-center"
									label="Area center"
									value={constraintCenterStop.label}
									placeholder="Enter area center..."
									target={constraintCenterCompletionTarget}
									controller={completionController}
									completionLabel="Area center suggestions"
									error=""
									inputClass="border-none bg-background pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
									onInput={updateConstraintCenterInput}
								>
									{#snippet leading()}
										<MapPin class="size-4 text-sky-600 dark:text-sky-300" />
									{/snippet}
								</PlannerStopInput>
								<label
									for="area-radius"
									class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
								>
									Radius
								</label>
								<div class="relative">
										<Input
											id="area-radius"
											type="number"
											min={formatDistanceInputAttribute(minAreaRadiusMeters)}
											max={formatDistanceInputAttribute(maxAreaRadiusMeters)}
											step={formatDistanceInputAttribute(areaRadiusStepMeters)}
											inputmode="decimal"
											value={areaRadiusInput}
										class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
										aria-invalid={fieldErrors.spatialConstraint ? "true" : undefined}
										oninput={(event) =>
											updateAreaRadiusInput(
												(event.currentTarget as HTMLInputElement).value,
											)}
									/>
									<span
										class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
									>
										{getDistanceUnitLabel()}
									</span>
								</div>
							</div>
						{:else if spatialConstraintKind === "corridor"}
							<div class="space-y-2">
								<label
									for="corridor-width"
									class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
								>
									Width
								</label>
								<div class="relative">
										<Input
											id="corridor-width"
											type="number"
											min={formatDistanceInputAttribute(minCorridorWidthMeters)}
											max={formatDistanceInputAttribute(maxCorridorWidthMeters)}
											step={formatDistanceInputAttribute(corridorWidthStepMeters)}
											inputmode="decimal"
											value={corridorWidthInput}
										class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
										aria-invalid={fieldErrors.spatialConstraint ? "true" : undefined}
										oninput={(event) =>
											updateCorridorWidthInput(
												(event.currentTarget as HTMLInputElement).value,
											)}
									/>
									<span
										class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
									>
										{getDistanceUnitLabel()}
									</span>
								</div>
							</div>
						{/if}

						{#if fieldErrors.spatialConstraint}
							<p class="text-xs font-medium text-destructive">
								{fieldErrors.spatialConstraint}
							</p>
						{/if}
					</div>

					<Separator class="my-0.5" />

					<div class="space-y-2.5">
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs font-semibold text-foreground/80">
								Optimization strategy
							</span>
							<Badge
								variant="secondary"
								class="h-5 shrink-0 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold text-primary"
							>
								Lower traffic bias
							</Badge>
						</div>

						<div class="flex flex-wrap gap-1.5">
							<Badge
								variant="outline"
								class="h-6 border-border/50 bg-secondary/30 px-2 text-[10px] font-medium"
							>
								Avoid ferries
							</Badge>
							<Badge
								variant="outline"
								class="h-6 border-border/50 bg-secondary/30 px-2 text-[10px] font-medium"
							>
								Penalize rough surface
							</Badge>
							<Badge
								variant="outline"
								class="h-6 border-border/50 bg-secondary/30 px-2 text-[10px] font-medium"
							>
								Avoid busy roads when possible
							</Badge>
						</div>
					</div>
					</div>
					{/if}

					{#if routeRequestError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{routeRequestError}
						</div>
					{/if}

					{#if routeImportError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{routeImportError}
						</div>
					{/if}

					{#if currentLocationError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{currentLocationError}
						</div>
					{/if}

					{#if activeWarnings.length > 0 && primaryActiveWarning}
						<div
							class={`rounded-lg border px-3 py-2 text-sm ${getWarningContainerClass(primaryActiveWarning)}`}
							role="status"
						>
							<div class="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide opacity-75">
								<AlertTriangle class="size-3.5" />
								Route readiness
							</div>
							<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
								<span class="font-semibold">{primaryActiveWarning.title}</span>
								{#if primaryActiveWarning.metricLabel && primaryActiveWarning.metricValue}
									<span
										class={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${getWarningBadgeClass(primaryActiveWarning)}`}
									>
										{primaryActiveWarning.metricLabel}: {primaryActiveWarning.metricValue}
									</span>
								{/if}
							</div>
							<p class="mt-0.5 text-xs opacity-85">{primaryActiveWarning.message}</p>
						</div>
					{/if}

					<Button size="lg" type="submit" class="mt-1 w-full font-semibold shadow-sm">
						{getSubmitButtonText()}
					</Button>
				</form>
			</div>
		</div>

		<div class="pointer-events-auto relative w-full shrink-0">
			{#if selectedBasemap}
				<div
					class="absolute bottom-[calc(100%+0.5rem)] right-0 z-20 max-w-[23rem] rounded-md border border-white/10 bg-black/42 px-2 py-1 text-[10px] leading-none text-white/58 shadow-sm backdrop-blur-[6px] supports-[backdrop-filter]:bg-black/34 md:text-[11px]"
				>
					<span class="mr-1 uppercase tracking-wide text-white/42">Basemap</span>
					{@html selectedBasemap.attributionHtml}
				</div>
			{/if}

			<div
				class="rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-sm md:p-3.5"
			>
				<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
					{#if isRouting}
						{@render routeSummarySkeleton()}
					{:else if activeRoute}
						<div
							class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums sm:text-sm"
						>
							<span class="font-semibold text-foreground">
								<span class="font-heading text-base sm:text-lg">
									{formatDistanceValue(activeRoute.distanceMeters)}
								</span>
								{getDistanceUnitLabel()}
							</span>
							<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
							<span class="flex items-center gap-1">
								<MountainSnow class="size-3.5 shrink-0 text-emerald-500" />
								<span class="font-semibold text-foreground">
									<span class="font-heading text-base sm:text-lg">
										{Math.round(activeRoute.ascendMeters).toLocaleString()}
									</span>
									m
								</span>
							</span>
							<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
							<span class="flex items-center gap-1 text-sky-600 dark:text-sky-400">
								<TrendingDown class="size-3.5 shrink-0 opacity-80" />
								<span class="font-semibold">
									<span class="font-heading text-base sm:text-lg">
										{Math.round(activeRoute.descendMeters).toLocaleString()}
									</span>
									m
								</span>
							</span>
							<span class="hidden text-border md:inline" aria-hidden="true">·</span>
							<span class="font-semibold text-foreground">
								{activeRouteClimbs.length} climb{activeRouteClimbs.length === 1 ? "" : "s"}
								{#if activeCategorizedClimbs.length > 0}
									<span class="text-muted-foreground">
										({activeCategorizedClimbs.length} categorized)
									</span>
								{/if}
							</span>
							{#if activeRouteGradientMetrics && activeRouteGradientMetrics.averageGradientPercent !== null}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="font-semibold text-foreground">
									Avg {formatGrade(activeRouteGradientMetrics.averageGradientPercent)}
								</span>
							{/if}
							{#if activeRouteGradientMetrics && activeRouteGradientMetrics.maximumGradientPercent !== null}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="font-semibold text-foreground">
									Max {formatGrade(activeRouteGradientMetrics.maximumGradientPercent)}
								</span>
							{/if}
							{#if activeWindSummary}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="flex items-center gap-1 font-semibold text-foreground">
									<Wind class="size-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
									{#if activeWindSummary.averageHeadwindKmh < 0}
										Tailwind {formatWindSpeed(activeWindSummary.averageTailwindKmh)}
									{:else}
										Avg headwind {formatWindSpeed(activeWindSummary.averageHeadwindKmh)}
									{/if}
								</span>
							{/if}
							<span class="hidden text-border md:inline" aria-hidden="true">·</span>
							<span class="font-semibold text-foreground">{getRouteDurationText(activeRoute)}</span>
							{#if activeDirections.length > 0}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="font-semibold text-foreground">
									{activeTurnCount} turn{activeTurnCount === 1 ? "" : "s"}
								</span>
							{/if}
						</div>
					{:else}
						<div class="flex min-w-0 flex-col gap-1">
							<span class="text-sm font-semibold text-foreground">
								{isRoundCourseMode
										? "Generate a round course to see live distance, climbing, and elevation."
										: isOutAndBackMode
											? "Generate an out-and-back route to see live distance, climbing, and elevation."
										: "Generate a route to see live distance, climbing, and elevation."}
							</span>
							<span class="text-xs text-muted-foreground">
								{isRoundCourseMode
										? "The map overlay and summary will update once a loop route is found."
										: isOutAndBackMode
											? "The map overlay and summary will update once the outbound leg is mirrored."
										: "The map overlay and summary will update once a route is found."}
							</span>
						</div>
					{/if}

					<div class="flex shrink-0 flex-col items-end gap-1.5">
						<div class="flex flex-wrap items-center justify-end gap-2">
							<Button
								variant="outline"
								size="sm"
								class="gap-1.5 font-semibold"
								disabled={isImportingGpx}
								onclick={openGpxImportPicker}
							>
								{#if isImportingGpx}
									<Skeleton class="size-3 rounded-full" />
								{/if}
								{isImportingGpx ? "Importing GPX..." : "Import GPX"}
							</Button>
							{#if activeRoute}
								<div class="flex items-center gap-1">
									<Button
										variant="outline"
										size="icon"
										class="size-8"
										type="button"
										disabled={!canUndoRouteEdit}
										aria-label="Undo route edit"
										onclick={undoRouteEdit}
									>
										<Undo2 class="size-3.5" />
									</Button>
									<Button
										variant="outline"
										size="icon"
										class="size-8"
										type="button"
										disabled={!canRedoRouteEdit}
										aria-label="Redo route edit"
										onclick={redoRouteEdit}
									>
										<Redo2 class="size-3.5" />
									</Button>
								</div>
								<Button
									variant={isActiveRouteSaved ? "secondary" : "outline"}
									size="sm"
									class="gap-1 font-semibold"
									onclick={handleSaveDraft}
								>
									{#if isActiveRouteSaved}
										<Check class="size-3.5" />
										Saved
									{:else}
										Save Draft
									{/if}
								</Button>
								<Button size="sm" class="font-semibold" onclick={handleExportGpx}>
									Export GPX
								</Button>
								<Button
									size="sm"
									variant="outline"
									class="font-semibold"
									onclick={handleExportFit}
								>
									Export FIT
								</Button>
								<Button
									size="sm"
									variant="outline"
									class="gap-1 font-semibold"
									disabled={isSharingRoute}
									onclick={handleShareActiveRoute}
								>
									<Share2 class="size-3.5" />
									{isSharingRoute ? "Sharing..." : isActiveRouteShareCopied ? "Copied" : "Share"}
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="gap-1 font-semibold"
									onclick={() => (directionsOpen = !directionsOpen)}
									aria-expanded={directionsOpen}
									aria-controls="route-directions-panel"
								>
									Directions
									<Badge
										variant="secondary"
										class="h-5 px-1.5 text-[10px] font-semibold"
									>
										{activeTurnCount}
									</Badge>
									{#if directionsOpen}
										<ChevronUp class="size-3.5 opacity-70" />
									{:else}
										<ChevronDown class="size-3.5 opacity-70" />
									{/if}
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="gap-1 font-semibold"
									onclick={() => (routeAnalysisOpen = !routeAnalysisOpen)}
									aria-expanded={routeAnalysisOpen}
									aria-controls="route-analysis-panel"
								>
									{routeAnalysisOpen ? "Less" : "Analysis"}
									{#if routeAnalysisOpen}
										<ChevronUp class="size-3.5 opacity-70" />
									{:else}
										<ChevronDown class="size-3.5 opacity-70" />
									{/if}
								</Button>
							{/if}
						</div>
					</div>
				</div>

				{#if activeRoute && routeExportError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{routeExportError}
					</div>
				{/if}

				{#if activeRoute && activeRouteShareError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{activeRouteShareError}
						{#if activeRouteShareUrl}
							<input
								class="mt-2 w-full rounded-md border border-destructive/20 bg-background px-2 py-1 font-mono text-xs text-foreground"
								readonly
								value={activeRouteShareUrl}
								aria-label="Share link"
								onfocus={(event) => event.currentTarget.select()}
							/>
						{/if}
					</div>
				{/if}

				{#if saveSyncError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{saveSyncError}
					</div>
				{/if}

				{#if activeRoute && activeImportedRouteSource}
					<div
						class="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/8 px-3 py-2 text-sm text-sky-900 dark:text-sky-100"
						role="status"
					>
						<div class="font-semibold">Imported GPX</div>
						<div>{activeImportedRouteSource.filename}</div>
						<div>{getImportedRouteStopSummary(activeRoute)}</div>
						<div>Edit stops, then Generate Route to recalculate.</div>
					</div>
				{/if}

				{#if activeRoute && avoidedRoads.length > 0}
					<div class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
						<div class="mb-2 flex items-center justify-between gap-3">
							<div class="text-xs font-semibold uppercase tracking-wide text-destructive">
								{avoidedRoads.length} avoided
							</div>
						</div>
						<div class="flex flex-wrap gap-2">
							{#each avoidedRoads as avoidance, index (`avoidance-${index}`)}
								<div class="flex items-center gap-1 rounded-md border border-destructive/20 bg-background/80 px-2 py-1 text-xs font-medium text-foreground">
									<span>{avoidance.label}</span>
									<Button
										variant="ghost"
										size="icon"
										class="size-6 text-muted-foreground hover:text-destructive"
										type="button"
										disabled={isRouting}
										aria-label={`Remove ${avoidance.label}`}
										onclick={() => removeAvoidedRoad(index)}
									>
										<X class="size-3.5" />
									</Button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if activeRoute && routeAlternatives.length > 1}
					<div class="mt-3 rounded-lg border border-border/50 bg-secondary/10 p-3">
						<div class="mb-2 flex items-center justify-between gap-3">
							<div class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
								Alternatives
							</div>
							<div class="text-xs text-muted-foreground">
								Select the route you want to inspect, save, or export.
							</div>
						</div>
						<div class="grid gap-2 md:grid-cols-3">
							{#each routeAlternatives as route, index (`alternative-${index}`)}
								<button
									type="button"
									class={`rounded-lg border p-3 text-left transition-colors ${
										index === selectedRouteIndex
											? "border-primary/40 bg-background shadow-sm"
											: "border-border/50 bg-background/70 hover:border-border hover:bg-background"
									}`}
									aria-pressed={index === selectedRouteIndex}
									onclick={() => selectRouteAlternative(index)}
								>
									<div class="mb-2 flex items-center justify-between gap-2">
										<div class="text-sm font-semibold text-foreground">
											Route {index + 1}
										</div>
										<div class="flex flex-wrap justify-end gap-1">
											{#if index === 0}
												<Badge
													variant="secondary"
													class="h-5 border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
												>
													Recommended
												</Badge>
											{/if}
											{#if index === selectedRouteIndex}
												<Badge
													variant="secondary"
													class="h-5 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary"
												>
													Selected
												</Badge>
											{/if}
											{#if route.mode === "round_course"}
												<Badge
													variant="outline"
													class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
												>
													Round course
												</Badge>
											{/if}
											{#if route.mode === "out_and_back"}
												<Badge
													variant="outline"
													class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
												>
													Out and back
												</Badge>
											{/if}
										</div>
									</div>
									<div class="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
										<div>
											<div class="font-semibold text-foreground">
												{formatDistance(route.distanceMeters)}
											</div>
											<div>Distance</div>
										</div>
										<div>
											<div class="font-semibold text-foreground">
												{getRouteDurationText(route)}
											</div>
											<div>Duration</div>
										</div>
										<div>
											<div class="font-semibold text-foreground">
												{Math.round(route.ascendMeters).toLocaleString()} m
											</div>
											<div>Climb</div>
										</div>
									</div>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if activeRoute && alternativeInfoMessage}
					<div
						class="mt-3 rounded-lg border border-border/50 bg-secondary/10 px-3 py-2 text-sm text-muted-foreground"
						role="status"
					>
						{alternativeInfoMessage}
					</div>
				{/if}

				{#if activeRoute}
				<div class="mt-2.5 min-w-0 rounded-md border border-border/40 bg-secondary/10">
					{#if activeRoute}
						<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 px-3 py-2">
							<div class="flex min-w-0 flex-wrap items-center gap-2">
								<span class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
									{activeRoute.startLabel}
								</span>
								{#if activeRoute.mode === "round_course"}
									<Badge
										variant="secondary"
										class="h-5 border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
									>
										Round course
									</Badge>
									<span class="text-xs text-muted-foreground">Returns to start</span>
								{:else if activeRoute.mode === "out_and_back"}
									<Badge
										variant="secondary"
										class="h-5 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary"
									>
										Out and back
									</Badge>
									<span class="text-xs text-muted-foreground">
										to {activeRoute.destinationLabel} and back
									</span>
								{:else}
									<span class="text-xs text-muted-foreground">
										to {activeRoute.destinationLabel}
									</span>
								{/if}
								{#if activeRoute.spatialConstraint}
									<Badge
										variant="outline"
										class="h-5 border-sky-500/25 bg-sky-500/8 px-2 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200"
									>
										{formatSpatialConstraintSummary(activeRoute)}
									</Badge>
									<Badge
										variant="outline"
										class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
									>
										{formatSpatialConstraintEnforcement(
											activeRoute.spatialConstraint.enforcement,
										)}
									</Badge>
								{/if}
							</div>
							{#if activeRoute.mode === "round_course" && activeRoundCourseTarget}
								<span class="text-xs text-muted-foreground">
									Target {formatRoundCourseTarget(activeRoundCourseTarget)}
								</span>
							{/if}
						</div>
					{/if}
					<div
						class="flex items-center justify-between gap-2 border-b border-border/30 px-3 py-1.5"
					>
						<div
							class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/75"
						>
							<TrendingUp class="size-3 shrink-0" />
							Elevation
						</div>
						{#if elevationSamples.length > 0}
							<div
								class="flex min-w-0 flex-nowrap items-center justify-end gap-x-2 overflow-x-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground"
							>
								{#if activeProfilePoint}
									<span class="font-semibold text-foreground">
										At {formatExactDistance(activeProfilePoint.distanceMeters)}
									</span>
									<span class="font-semibold text-foreground">
										{formatElevation(activeProfilePoint.elevationMeters)}
									</span>
									<span class="text-border">|</span>
								{/if}
								<span>min {formatElevation(elevMin)}</span>
								<span class="text-border">|</span>
								<span>max {formatElevation(elevMax)}</span>
								<span class="text-border">|</span>
								<span>delta {formatElevation(elevMax - elevMin)}</span>
								{#if activeRouteGradientMetrics && activeRouteGradientMetrics.averageGradientPercent !== null}
									<span class="text-border">|</span>
									<span>avg {formatGrade(activeRouteGradientMetrics.averageGradientPercent)}</span>
								{/if}
								{#if activeRouteGradientMetrics && activeRouteGradientMetrics.maximumGradientPercent !== null}
									<span class="text-border">|</span>
									<span>max {formatGrade(activeRouteGradientMetrics.maximumGradientPercent)}</span>
								{/if}
							</div>
						{:else}
							<span class="text-xs text-muted-foreground">No route profile yet</span>
						{/if}
					</div>
					<div class="px-2 pb-1.5 pt-1">
						{#if elevationSamples.length > 0}
							<svg
								class="block w-full touch-none"
								height={chartH}
								viewBox="0 0 {chartW} {chartH}"
								preserveAspectRatio="none"
								role="img"
								aria-label="Elevation along route"
								onpointerdown={handleChartPointerDown}
								onpointermove={handleChartPointerMove}
								onpointerleave={handleChartPointerLeave}
								onpointerup={releaseChartScrub}
								onpointercancel={releaseChartScrub}
								onlostpointercapture={handleChartLostPointerCapture}
							>
								<defs>
									<linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color="rgb(16 185 129)" stop-opacity="0.35" />
										<stop offset="100%" stop-color="rgb(16 185 129)" stop-opacity="0.02" />
									</linearGradient>
								</defs>
								{#each [0.25, 0.5, 0.75] as gridLine}
									<line
										x1="0"
										y1={gridLine * chartH}
										x2={chartW}
										y2={gridLine * chartH}
										stroke="currentColor"
										class="text-border/40"
										stroke-width="1"
										vector-effect="non-scaling-stroke"
									/>
								{/each}
								{#each activeRouteClimbs as climb}
									<rect
										x={(climb.startDistanceMeters / Math.max(sampledProfileDistanceTotal ?? 1, 1)) * chartW}
										y="0"
										width={Math.max(
											1.5,
											((climb.endDistanceMeters - climb.startDistanceMeters) /
												Math.max(sampledProfileDistanceTotal ?? 1, 1)) *
												chartW,
										)}
										height={chartH}
										fill={getClimbColor(climb)}
										opacity={climb.isKeyClimb ? "0.24" : "0.13"}
									/>
								{/each}
								<path d={areaD} fill="url(#elevFill)" class="text-emerald-500" />
								{#if activeProfilePoint}
									<line
										x1={activeProfilePoint.x}
										y1="0"
										x2={activeProfilePoint.x}
										y2={chartH}
										stroke="rgb(16 185 129 / 0.45)"
										stroke-width="1.5"
										stroke-dasharray="3 4"
										vector-effect="non-scaling-stroke"
									/>
								{/if}
								<polyline
									fill="none"
									stroke="rgb(16 185 129)"
									stroke-width="2.5"
									stroke-linejoin="round"
									stroke-linecap="round"
									points={linePoints}
									vector-effect="non-scaling-stroke"
								/>
								{#if activeProfilePoint}
									<circle
										cx={activeProfilePoint.x}
										cy={activeProfilePoint.y}
										r="5.75"
										fill="rgba(16, 185, 129, 0.22)"
									/>
									<circle
										cx={activeProfilePoint.x}
										cy={activeProfilePoint.y}
										r="3.5"
										fill="rgb(16 185 129)"
										stroke="rgba(255, 255, 255, 0.96)"
										stroke-width="2"
									/>
								{/if}
								<rect
									x="0"
									y="0"
									width={chartW}
									height={chartH}
									fill="transparent"
									pointer-events="all"
								/>
							</svg>
							<div
								class="flex justify-between px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
							>
								<span>Start</span>
								<span class="hidden min-[480px]:inline">{distanceTickLabels[0]}</span>
								<span class="hidden min-[640px]:inline">{distanceTickLabels[1]}</span>
								<span class="hidden min-[900px]:inline">{distanceTickLabels[2]}</span>
								<span>{distanceTickLabels[3]}</span>
							</div>
						{:else}
							<div class="flex min-h-24 items-center justify-center text-center text-sm text-muted-foreground">
								Elevation and route profile will appear here after a route is generated.
							</div>
						{/if}
					</div>
					{#if activeRoute && elevationSamples.length > 0}
						<div class="border-t border-border/30 px-3 py-2">
							{#if activeRouteClimbs.length > 0}
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
									<span class="font-semibold text-foreground">
										{activeRouteClimbs.length} detected climb{activeRouteClimbs.length === 1 ? "" : "s"}
									</span>
									<span>{activeCategorizedClimbs.length} categorized</span>
									<span>{activeKeyClimbs.length} key highlighted</span>
									{#if hardestClimb}
										<span class="font-semibold text-foreground">
											Hardest: {hardestClimb.category}, {formatElevation(hardestClimb.elevationGainMeters)} over {formatDistance(hardestClimb.distanceMeters)} at {formatGrade(hardestClimb.averageGradePercent)}
										</span>
									{/if}
								</div>
							{:else}
								<p class="text-xs text-muted-foreground">
									No climbs meet the 500 m, 30 m gain, and 3% average grade threshold.
								</p>
							{/if}
						</div>
					{:else if activeRoute}
						<div class="border-t border-border/30 px-3 py-2 text-xs text-muted-foreground">
							No climb data available because this route has no elevation samples.
						</div>
					{/if}
				</div>
				{/if}

				{#if directionsOpen && activeRoute}
					<div
						id="route-directions-panel"
						class="mt-3 max-h-[min(38vh,22rem)] overflow-y-auto rounded-lg border border-border/40 bg-secondary/5 p-2"
					>
						<div class="flex items-center justify-between gap-2 px-1 pb-2">
							<div class="flex min-w-0 items-center gap-2">
								<Navigation class="size-3.5 shrink-0 text-primary" />
								<span class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
									Directions
								</span>
							</div>
							<span class="text-xs text-muted-foreground">
								{activeDirections.length} cue{activeDirections.length === 1 ? "" : "s"}
							</span>
						</div>

						{#if activeDirections.length > 0}
							<div class="space-y-1">
								{#each activeDirections as cue, index (`cue-${index}-${cue.coordinateIndex}-${cue.sign}`)}
									<button
										type="button"
										class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
											selectedCueIndex === index
												? "border-primary/35 bg-primary/10 text-foreground"
												: "border-transparent bg-background/60 text-foreground hover:border-border/70 hover:bg-background"
										}`}
										aria-pressed={selectedCueIndex === index}
										onclick={() => selectCue(index)}
									>
										<span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
											{#if cue.type === "left" || cue.type === "slight_left" || cue.type === "sharp_left" || cue.type === "keep_left"}
												<CornerDownLeft class="size-4" />
											{:else if cue.type === "right" || cue.type === "slight_right" || cue.type === "sharp_right" || cue.type === "keep_right"}
												<CornerDownRight class="size-4" />
											{:else if cue.type === "u_turn"}
												<Shuffle class="size-4" />
											{:else if cue.type === "roundabout" || cue.type === "leave_roundabout"}
												<CircleDot class="size-4" />
											{:else if cue.type === "finish"}
												<Flag class="size-4" />
											{:else if cue.sign < 0}
												<ArrowLeft class="size-4" />
											{:else if cue.sign > 0}
												<ArrowRight class="size-4" />
											{:else}
												<ArrowUp class="size-4" />
											{/if}
										</span>
										<span class="min-w-0">
											<span class="block text-xs font-semibold text-muted-foreground">
												{formatExactDistance(cue.distanceFromStartMeters)}
											</span>
											<span class="block truncate text-sm font-semibold">
												{cue.text}
											</span>
										</span>
										<span class="text-right text-xs tabular-nums text-muted-foreground">
											<span class="block">{formatDistance(cue.segmentDistanceMeters)}</span>
											<span class="block">{formatCueSegmentTime(cue.segmentTimeMs)}</span>
										</span>
									</button>
								{/each}
							</div>
						{:else}
							<div class="flex min-h-20 items-center justify-center rounded-md border border-dashed border-border/60 bg-background/50 px-3 text-center text-sm text-muted-foreground">
								No directions available for this route
							</div>
						{/if}
					</div>
				{/if}

				{#if routeAnalysisOpen && activeRoute}
					<div
						id="route-analysis-panel"
						class="mt-3 max-h-[min(38vh,22rem)] overflow-y-auto rounded-lg border border-border/40 bg-secondary/5 p-3 md:max-h-[min(42vh,26rem)] md:p-3.5"
					>
						<div class="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
							<div class="flex flex-col gap-3">
								<div class="flex items-start justify-between gap-2">
									<div class="flex min-w-0 items-center gap-2">
										<ShieldCheck
											class="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
										/>
										<span
											class="text-xs font-semibold uppercase tracking-wide text-foreground/75"
										>
											Ride quality
										</span>
									</div>
									<Badge
										variant="secondary"
										class="h-5 shrink-0 px-2 text-[10px] font-semibold"
									>
										{getRoutingBadgeLabel(activeRoute)}
									</Badge>
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<AlertTriangle class="size-3" /> Readiness
										</span>
									</div>
									{#if activeReadinessWarnings.length > 0}
										<div class="grid gap-1.5">
											{#each activeReadinessWarnings as warning}
												<div
													class={`rounded-md border px-2.5 py-2 text-xs ${getWarningContainerClass(warning)}`}
												>
													<div class="mb-1 flex items-center justify-between gap-2">
														<span class="font-semibold">{warning.title}</span>
														{#if warning.metricLabel && warning.metricValue}
															<span
																class={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${getWarningBadgeClass(warning)}`}
															>
																{warning.metricLabel}: {warning.metricValue}
															</span>
														{/if}
													</div>
													<div class="opacity-85">{warning.message}</div>
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											No readiness warnings from available route data.
										</p>
									{/if}
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<Route class="size-3" /> Surface mix
										</span>
									</div>
									{#if surfaceMix.length > 0}
										<div class="flex h-2 overflow-hidden rounded-full bg-secondary">
											{#each surfaceMix as surface}
												<div
													class="{surface.className} opacity-90"
													style="width: {surface.pct}%"
													title="{surface.label}: {surface.pct}%"
												></div>
											{/each}
										</div>
										<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
											{#each surfaceMix as surface}
												<span class="flex items-center gap-1">
													<span class="size-1.5 rounded-full {surface.className}"></span>
													{surface.label} ({surface.pct}%)
												</span>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											{isImportedRoute(activeRoute)
												? "Surface analysis becomes available after re-routing this imported track."
												: "Surface details were not available for this route."}
										</p>
									{/if}
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<Wind class="size-3" /> Wind
										</span>
										{#if activeWindSummary}
											<span>{activeWindSummary.forecastTime}</span>
										{/if}
									</div>
									{#if activeWindSummary}
										<div class="grid gap-1.5 text-xs">
											<div class="grid grid-cols-2 gap-1.5">
												<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
													<div class="text-muted-foreground">Average</div>
													<div class="font-semibold text-foreground">
														{activeWindSummary.averageHeadwindKmh < 0
															? `${formatWindSpeed(activeWindSummary.averageTailwindKmh)} tailwind`
															: `${formatWindSpeed(activeWindSummary.averageHeadwindKmh)} headwind`}
													</div>
												</div>
												<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
													<div class="text-muted-foreground">Max crosswind</div>
													<div class="font-semibold text-foreground">
														{formatWindSpeed(activeWindSummary.maxCrosswindKmh)}
													</div>
												</div>
											</div>
											<div class="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
												<span>Headwind {formatDistance(activeWindSummary.headwindDistanceMeters)}</span>
												<span>Crosswind {formatDistance(activeWindSummary.crosswindDistanceMeters)}</span>
												<span>Tailwind {formatDistance(activeWindSummary.tailwindDistanceMeters)}</span>
												<span>Max headwind {formatWindSpeed(activeWindSummary.maxHeadwindKmh)}</span>
											</div>
											{#if strongestWindSegments.length > 0}
												<div class="grid gap-1.5">
													{#each strongestWindSegments as segment}
														<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
															<div class="mb-1 flex items-center justify-between gap-2">
																<span class="font-semibold text-foreground">
																	{formatWindBucket(segment.bucket)}
																</span>
																<span class="text-muted-foreground">
																	{formatWindSpeed(segment.speedKmh)}
																</span>
															</div>
															<div class="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
																<span>{getWindSegmentDistanceRange(activeRoute, segment)}</span>
																<span>{formatWindComponent(segment.headwindComponentKmh)}</span>
																<span>{formatWindSpeed(Math.abs(segment.crosswindComponentKmh))} cross</span>
															</div>
														</div>
													{/each}
												</div>
											{/if}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											{isImportedRoute(activeRoute)
												? "Wind analysis becomes available after re-routing this imported track."
												: "Wind analysis was not available for this route."}
										</p>
									{/if}
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<MountainSnow class="size-3" /> Climbs
										</span>
									</div>
									{#if activeRouteClimbs.length > 0}
										<div class="grid gap-1.5">
											{#each activeRouteClimbs as climb, index}
												<div
													class={`rounded-md border px-2.5 py-2 text-xs ${
														climb.isKeyClimb
															? "border-amber-500/25 bg-amber-500/8"
															: "border-border/30 bg-background/60"
													}`}
												>
													<div class="mb-1 flex items-center justify-between gap-2">
														<div class="flex min-w-0 items-center gap-2 font-semibold text-foreground">
															<span
																class="size-2 shrink-0 rounded-full"
																style="background-color: {getClimbColor(climb)}"
															></span>
															<span>{getClimbLabel(climb, index)}</span>
														</div>
														{#if climb.isKeyClimb}
															<Badge
																variant="secondary"
																class="h-5 border-amber-500/20 bg-amber-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200"
															>
																Key
															</Badge>
														{/if}
													</div>
													<div class="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
														<span>{formatDistance(climb.distanceMeters)}</span>
														<span>{formatElevation(climb.elevationGainMeters)} gain</span>
														<span>{formatGrade(climb.averageGradePercent)} avg</span>
														<span>from {formatExactDistance(climb.startDistanceMeters)}</span>
													</div>
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											No detected climbs for this elevation profile.
										</p>
									{/if}
								</div>
							</div>

							<div class="grid grid-cols-1 gap-2.5 text-xs">
								<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
									<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
										Resolved start
									</div>
									<div class="font-medium text-foreground">{activeRoute.startLabel}</div>
								</div>
								{#if activeRoute.waypoints.length > 0 && activeRoute.mode !== "out_and_back"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved waypoints
										</div>
										<div class="space-y-1">
											{#each activeRoute.waypoints as waypoint, index}
												<div class="font-medium text-foreground">
													{index + 1}. {waypoint.label}
												</div>
											{/each}
										</div>
									</div>
								{/if}
								{#if activeRoute.mode === "round_course"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Loop finish
										</div>
										<div class="font-medium text-foreground">Returns to {activeRoute.startLabel}</div>
									</div>
									{#if activeRoundCourseTarget}
										<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
											<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
												Requested target
											</div>
											<div class="font-medium text-foreground">
												{formatRoundCourseTarget(activeRoundCourseTarget)}
											</div>
										</div>
									{/if}
								{:else if activeRoute.mode === "out_and_back"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved turnaround
										</div>
										<div class="font-medium text-foreground">{activeRoute.destinationLabel}</div>
									</div>
								{:else}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved destination
										</div>
										<div class="font-medium text-foreground">{activeRoute.destinationLabel}</div>
									</div>
								{/if}
								{#if activeRoute.spatialConstraint}
									<div class="rounded-md border border-sky-500/20 bg-sky-500/8 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-sky-900/70 dark:text-sky-100/70">
											Route bounds
										</div>
										<div class="font-medium text-foreground">
											{formatSpatialConstraintSummary(activeRoute)}
										</div>
										<div class="text-muted-foreground">
											{formatSpatialConstraintEnforcement(
												activeRoute.spatialConstraint.enforcement,
											)}
										</div>
									</div>
								{/if}
								<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
									<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
										Routing profile
									</div>
									<div class="font-medium text-foreground">
										{getRoutingProfileLabel(activeRoute)}
									</div>
								</div>
								{#if activeProviderWarnings.length > 0}
									<div class="rounded-md border border-amber-500/20 bg-amber-500/8 px-2.5 py-2 text-amber-900 dark:text-amber-100">
										<div class="mb-1 font-semibold uppercase tracking-wide text-amber-900/70 dark:text-amber-100/70">
											Routing fallback
										</div>
										<div class="space-y-1 font-medium">
											{#each activeProviderWarnings as warning}
												<div>{warning.message}</div>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
