<script lang="ts">
	import { onDestroy, onMount } from "svelte";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Separator } from "$lib/components/ui/separator/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { useSidebar } from "$lib/components/ui/sidebar/index.js";
	import MapView from "$lib/components/map-view.svelte";
	import { getBasemapById } from "$lib/map/basemaps";
	import {
		parseRouteGpx,
		RouteGpxImportError,
	} from "$lib/route-gpx-import";
	import { downloadRouteGpx } from "$lib/route-export";
	import { mapStylePreference } from "$lib/map-style-settings.svelte";
	import {
		addSavedRoute,
		deleteSavedRoute,
		getSavedRouteById,
		initSavedRoutes,
		isPlannedRoute,
		savedRoutesState,
	} from "$lib/saved-routes.svelte";
	import {
		buildRouteGeoJson,
		buildLockedSegmentGeoJson,
		buildSpatialConstraintGeoJson,
		getRouteLegIndexForCoordinateSegment,
		getRouteSegmentCount,
		getRouteStopInputs,
		getSurfaceMix,
		getWaypointInsertionIndex,
		isImportedRoute,
		isRouteStopLocked,
		mergeRouteBounds,
		sampleElevationProfile,
		sanitizeLockedSegmentIndexes,
		type ManualRouteEditingState,
		type PlannedRoute,
		type RoundCourseTarget,
		type RouteApiError,
		type RouteApiSuccess,
		type RouteMapOverlay,
		type RouteMode,
		type RouteRequestPayload,
		type RouteSpatialConstraintInput,
		type RouteStopInput,
		type RouteSuggestion,
		type RouteSuggestionsApiSuccess,
		type SpatialConstraintEnforcement,
	} from "$lib/route-planning";
	import {
		ArrowDown,
		ArrowUp,
		Check,
		ChevronDown,
		ChevronUp,
		LocateFixed,
		Lock,
		MapPin,
		MountainSnow,
		Navigation,
		Plus,
		Route,
		ShieldCheck,
		TrendingDown,
		TrendingUp,
		Unlock,
		Wind,
		X,
	} from "lucide-svelte";

	type StopSource = "typed" | "suggestion" | "map" | "currentLocation";
	type PlannerStop = RouteStopInput & {
		source: StopSource;
	};
	type CurrentLocation = {
		point: [number, number];
		accuracyMeters?: number;
	};
	type RouteField = "startQuery" | "destinationQuery";
	type PlannerMode = RouteMode;
	type RoundCourseTargetKind = RoundCourseTarget["kind"];
	type CompletionTarget =
		| { kind: "startQuery" }
		| { kind: "destinationQuery" }
		| { kind: "constraintCenter" }
		| { kind: "waypoint"; index: number };
	type SpatialConstraintKind = "none" | "area" | "corridor";
	type SelectedMapStop =
		| {
				kind: "start" | "destination";
				label?: string;
		  }
		| {
				kind: "waypoint";
				label?: string;
				index: number;
		  };
	type MapClickSelection = {
		point: [number, number];
		screenPoint: {
			x: number;
			y: number;
		};
		selectedStop?: SelectedMapStop;
		selectedSegment?: {
			coordinateSegmentIndex: number;
			segmentIndex: number;
		};
	};
	type RouteStopDragEnd = {
		point: [number, number];
		screenPoint: {
			x: number;
			y: number;
		};
		selectedStop: SelectedMapStop;
		stopIndex: number;
	};
	type RouteSegmentDragEnd = {
		point: [number, number];
		screenPoint: {
			x: number;
			y: number;
		};
		coordinateSegmentIndex: number;
		segmentIndex: number;
	};
	type ReverseGeocodeApiSuccess = {
		label: string;
		point: [number, number];
	};

	const chartW = 800;
	const padY = 5;
	const maxRoutePoints = 5;
	const maxWaypoints = maxRoutePoints - 2;
	const minCompletionQueryLength = 3;
	const completionDebounceMs = 250;
	const desiredAlternativeRoutes = 3;
	const gpxFileAccept = ".gpx,application/gpx+xml,application/xml,text/xml";
	const defaultAreaRadiusKm = "30";
	const defaultCorridorWidthKm = "10";
	const defaultSpatialConstraintEnforcement: SpatialConstraintEnforcement =
		"strict";
	const sidebar = useSidebar();
	const startCompletionTarget: CompletionTarget = { kind: "startQuery" };
	const destinationCompletionTarget: CompletionTarget = {
		kind: "destinationQuery",
	};
	const constraintCenterCompletionTarget: CompletionTarget = {
		kind: "constraintCenter",
	};
	const plannerModeOptions: Array<{
		mode: PlannerMode;
		label: string;
		description: string;
	}> = [
		{
			mode: "point_to_point",
			label: "Point to point",
			description: "Start, optional waypoints, and a destination.",
		},
		{
			mode: "round_course",
			label: "Round course",
			description: "Loop from one start point with a target ride distance.",
		},
		{
			mode: "out_and_back",
			label: "Out and back",
			description: "Start, turnaround, then return on the same road.",
		},
	];

	function createPlannerStop(
		label = "",
		point?: [number, number],
		source: StopSource = "typed",
	): PlannerStop {
		return {
			label,
			point,
			source,
		};
	}

	let routeAnalysisOpen = $state(false);
	let plannerMode = $state<PlannerMode>("point_to_point");
	let startStop = $state<PlannerStop>(createPlannerStop());
	let waypointStops = $state<PlannerStop[]>([]);
	let destinationStop = $state<PlannerStop>(createPlannerStop());
	let roundCourseTargetKind = $state<RoundCourseTargetKind>("distance");
	let roundCourseDistanceKm = $state("");
	let roundCourseDurationInput = $state("");
	let roundCourseAscendMeters = $state("");
	let spatialConstraintKind = $state<SpatialConstraintKind>("none");
	let spatialConstraintEnforcement =
		$state<SpatialConstraintEnforcement>(defaultSpatialConstraintEnforcement);
	let constraintCenterStop = $state<PlannerStop>(createPlannerStop());
	let areaRadiusKm = $state(defaultAreaRadiusKm);
	let corridorWidthKm = $state(defaultCorridorWidthKm);
	let routeRequestError = $state<string | null>(null);
	let routeImportError = $state<string | null>(null);
	let fieldErrors = $state<NonNullable<RouteApiError["fieldErrors"]>>({});
	let isRouting = $state(false);
	let isImportingGpx = $state(false);
	let routeAlternatives = $state<PlannedRoute[]>([]);
	let selectedRouteIndex = $state<number | null>(null);
	let lockedSegmentIndexes = $state<number[]>([]);
	let lastGeneratedRouteCount = $state<number | null>(null);
	let routeExportError = $state<string | null>(null);
	let saveSyncError = $state<string | null>(null);
	let activeSavedRouteId = $state<string | null>(null);
	let isActiveRouteSaved = $state(false);
	let pendingSavedRouteId = $state<string | null>(null);
	let clientFetch = $state<typeof window.fetch | null>(null);
	let activeProfileIndex = $state<number | null>(null);
	let chartScrubPointerId = $state<number | null>(null);
	let activeCompletionTarget = $state<CompletionTarget | null>(null);
	let completionSuggestions = $state<RouteSuggestion[]>([]);
	let isCompletionLoading = $state(false);
	let isCompletionEmpty = $state(false);
	let completionHighlightedIndex = $state(-1);
	let mapClickSelection = $state<MapClickSelection | null>(null);
	let isResolvingMapSelection = $state(false);
	let currentLocation = $state<CurrentLocation | null>(null);
	let currentLocationFocusKey = $state(0);
	let isLocating = $state(false);
	let currentLocationError = $state<string | null>(null);
	let gpxImportInput = $state<HTMLInputElement | null>(null);

	let completionAbortController: AbortController | null = null;
	let completionBlurTimer: ReturnType<typeof setTimeout> | null = null;
	let completionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let completionRequestId = 0;

	const selectedBasemap = $derived(
		mapStylePreference.selectedBasemapId
			? getBasemapById(mapStylePreference.selectedBasemapId)
			: null,
	);
	const isRoundCourseMode = $derived(plannerMode === "round_course");
	const isOutAndBackMode = $derived(plannerMode === "out_and_back");
	const activeRoute = $derived(
		selectedRouteIndex === null ? null : routeAlternatives[selectedRouteIndex] ?? null,
	);
	const activeRoundCourseTarget = $derived(getRoundCourseTarget(activeRoute));
	const routeOverlays = $derived<RouteMapOverlay[]>(
		routeAlternatives.map((route, index) => ({
			id: `route-${index}`,
			geoJson: buildRouteGeoJson(route),
			bounds: route.bounds,
			isSelected: index === selectedRouteIndex,
		})),
	);
	const constraintOverlay = $derived(
		activeRoute?.spatialConstraint
			? buildSpatialConstraintGeoJson(activeRoute.spatialConstraint)
			: null,
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
	const activeRoutingWarnings = $derived(activeRoute?.routingWarnings ?? []);
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
	const chartProfilePoints = $derived(
		elevationSamples.map((point) => {
			const x =
				elevationSamples.length > 1
					? (point.distanceMeters / (elevationSamples[elevationSamples.length - 1]?.distanceMeters || 1)) *
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
		activeProfileIndex === null ? null : chartProfilePoints[activeProfileIndex] ?? null,
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

	$effect(() => {
		if (!activeRoute && routeAnalysisOpen) {
			routeAnalysisOpen = false;
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

	onMount(() => {
		clientFetch = window.fetch.bind(window);
		initSavedRoutes();
		restoreSavedRouteFromLocation();
	});

	onDestroy(() => {
		cancelCompletionBlur();
		cancelCompletionDebounce();
		cancelCompletionRequest();
	});

	function formatCoordinateLabel(point: [number, number]) {
		return `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
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

	function getRouteStopInput(stop: PlannerStop): RouteStopInput {
		return {
			label: stop.label.trim(),
			point: stop.point,
		};
	}

	function getRoundCourseTarget(
		route: PlannedRoute | null | undefined,
	): RoundCourseTarget | null {
		if (!route || route.mode !== "round_course") {
			return null;
		}

		if (route.roundCourseTarget) {
			return route.roundCourseTarget;
		}

		if (
			typeof route.requestedDistanceMeters === "number" &&
			Number.isFinite(route.requestedDistanceMeters)
		) {
			return {
				kind: "distance",
				distanceMeters: route.requestedDistanceMeters,
			};
		}

		return null;
	}

	function getDestinationFieldLabel() {
		return isOutAndBackMode ? "Turnaround" : "Destination";
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

	function formatDistanceInput(distanceMeters: number | undefined): string {
		if (!distanceMeters || !Number.isFinite(distanceMeters)) {
			return "";
		}

		return Number((distanceMeters / 1000).toFixed(1)).toString();
	}

	function parseRoundCourseDurationInput(value: string): number | null {
		const trimmedValue = value.trim();

		if (!trimmedValue) {
			return null;
		}

		if (trimmedValue.includes(":")) {
			const [hoursPart, minutesPart, ...rest] = trimmedValue.split(":");
			const hours = Number(hoursPart);
			const minutes = Number(minutesPart);

			if (
				rest.length > 0 ||
				!Number.isInteger(hours) ||
				!Number.isInteger(minutes) ||
				minutes < 0 ||
				minutes >= 60
			) {
				return null;
			}

			return (hours * 60 + minutes) * 60 * 1000;
		}

		const decimalHours = Number(trimmedValue.replace(",", "."));

		if (!Number.isFinite(decimalHours) || decimalHours < 0) {
			return null;
		}

		return Math.round(decimalHours * 60 * 60 * 1000);
	}

	function formatRoundCourseDurationInput(durationMs: number | undefined): string {
		if (!durationMs || !Number.isFinite(durationMs)) {
			return "";
		}

		const totalMinutes = Math.round(durationMs / 60000);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;

		return `${hours}:${minutes.toString().padStart(2, "0")}`;
	}

	function formatRoundCourseTarget(target: RoundCourseTarget | null | undefined): string {
		if (!target) {
			return "";
		}

		if (target.kind === "distance") {
			return formatDistance(target.distanceMeters);
		}

		if (target.kind === "duration") {
			return `${formatRoundCourseDurationInput(target.durationMs)} h`;
		}

		return `${Math.round(target.ascendMeters).toLocaleString()} m up`;
	}

	function formatSpatialConstraintSummary(route: PlannedRoute): string | null {
		if (!route.spatialConstraint) {
			return null;
		}

		if (route.spatialConstraint.kind === "area") {
			return `Area: ${route.spatialConstraint.label}, ${formatDistance(route.spatialConstraint.radiusMeters)}`;
		}

		return `Corridor: ${formatDistance(route.spatialConstraint.widthMeters)}`;
	}

	function formatSpatialConstraintEnforcement(
		enforcement: SpatialConstraintEnforcement,
	): string {
		return enforcement === "strict" ? "Keep inside" : "Prefer inside";
	}

	function buildRoundCourseTargetRequest(): RoundCourseTarget {
		if (roundCourseTargetKind === "duration") {
			return {
				kind: "duration",
				durationMs: parseRoundCourseDurationInput(roundCourseDurationInput) ?? Number.NaN,
			};
		}

		if (roundCourseTargetKind === "ascend") {
			return {
				kind: "ascend",
				ascendMeters: Number(roundCourseAscendMeters.replace(",", ".")),
			};
		}

		return {
			kind: "distance",
			distanceMeters: Number(roundCourseDistanceKm.replace(",", ".")) * 1000,
		};
	}

	function buildSpatialConstraintRequest():
		| RouteSpatialConstraintInput
		| undefined {
		if (spatialConstraintKind === "area") {
			return {
				kind: "area",
				center: getRouteStopInput(constraintCenterStop),
				radiusMeters: Number(areaRadiusKm.replace(",", ".")) * 1000,
				enforcement: spatialConstraintEnforcement,
			};
		}

		if (spatialConstraintKind === "corridor" && !isRoundCourseMode) {
			return {
				kind: "corridor",
				widthMeters: Number(corridorWidthKm.replace(",", ".")) * 1000,
				enforcement: spatialConstraintEnforcement,
			};
		}

		return undefined;
	}

	function resetSpatialConstraintDefaults() {
		spatialConstraintKind = "none";
		spatialConstraintEnforcement = defaultSpatialConstraintEnforcement;
		constraintCenterStop = createPlannerStop();
		areaRadiusKm = defaultAreaRadiusKm;
		corridorWidthKm = defaultCorridorWidthKm;
	}

	function syncStopsFromRoute(route: PlannedRoute) {
		plannerMode = route.mode;
		const roundCourseTarget = getRoundCourseTarget(route);
		roundCourseTargetKind = roundCourseTarget?.kind ?? "distance";
		roundCourseDistanceKm =
			roundCourseTarget?.kind === "distance"
				? formatDistanceInput(roundCourseTarget.distanceMeters)
				: "";
		roundCourseDurationInput =
			roundCourseTarget?.kind === "duration"
				? formatRoundCourseDurationInput(roundCourseTarget.durationMs)
				: "";
		roundCourseAscendMeters =
			roundCourseTarget?.kind === "ascend"
				? Math.round(roundCourseTarget.ascendMeters).toString()
				: "";
		const routeStops = getRouteStopInputs(route);
		const [start] = routeStops;
		const routeWaypointStops =
			route.mode === "point_to_point"
				? routeStops.slice(1, -1)
				: route.mode === "out_and_back"
					? routeStops.slice(1, -1)
					: routeStops.slice(1);
		const destination =
			route.mode === "round_course"
				? null
				: (routeStops[routeStops.length - 1] ?? null);

		startStop = createPlannerStop(
			start?.label ?? "",
			start?.point,
			start?.point ? "suggestion" : "typed",
		);
		waypointStops =
			routeWaypointStops.map((waypoint) =>
				createPlannerStop(
					waypoint.label,
					waypoint.point,
					waypoint.point ? "suggestion" : "typed",
				),
			);
		destinationStop = createPlannerStop(
			destination?.label ?? "",
			destination?.point,
			destination?.point ? "suggestion" : "typed",
		);

		if (!route.spatialConstraint) {
			resetSpatialConstraintDefaults();
			return;
		}

		spatialConstraintKind = route.spatialConstraint.kind;
		spatialConstraintEnforcement = route.spatialConstraint.enforcement;

		if (route.spatialConstraint.kind === "area") {
			constraintCenterStop = createPlannerStop(
				route.spatialConstraint.label,
				route.spatialConstraint.center,
				"suggestion",
			);
			areaRadiusKm = formatDistanceInput(route.spatialConstraint.radiusMeters);
			corridorWidthKm = defaultCorridorWidthKm;
		} else {
			constraintCenterStop = createPlannerStop();
			areaRadiusKm = defaultAreaRadiusKm;
			corridorWidthKm = formatDistanceInput(route.spatialConstraint.widthMeters);
		}
	}

	function withManualEditingState(
		route: PlannedRoute,
		indexes: number[],
	): PlannedRoute {
		const lockedSegmentIndexesForRoute = sanitizeLockedSegmentIndexes(
			indexes,
			getRouteSegmentCount(route),
		);
		const { manualEditing: _manualEditing, ...routeWithoutManualEditing } =
			route;

		return lockedSegmentIndexesForRoute.length > 0
			? {
					...routeWithoutManualEditing,
					manualEditing: {
						lockedSegmentIndexes: lockedSegmentIndexesForRoute,
					},
				}
			: routeWithoutManualEditing;
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
		routeAlternatives = routes.map((route, index) =>
			index === nextIndex ? withManualEditingState(route, nextLockedSegmentIndexes) : route,
		);
		selectedRouteIndex = nextIndex;
		lockedSegmentIndexes = nextLockedSegmentIndexes;
	}

	function setSingleRouteState(route: PlannedRoute) {
		lockedSegmentIndexes = sanitizeLockedSegmentIndexes(
			route.manualEditing?.lockedSegmentIndexes ?? [],
			getRouteSegmentCount(route),
		);
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
		routeAlternatives = routeAlternatives.map((route, routeIndex) =>
			routeIndex === index
				? withManualEditingState(route, nextLockedSegmentIndexes)
				: route,
		);
		activeProfileIndex = null;
		chartScrubPointerId = null;
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
			activeCompletionTarget &&
			activeCompletionTarget.kind !== "startQuery"
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
		isActiveRouteSaved = true;
		routeRequestError = null;
		fieldErrors = {};
		activeProfileIndex = null;
		chartScrubPointerId = null;
	}

	function elevY(meters: number, height: number, pad: number): number {
		const normalized = (meters - elevMin) / elevRange;
		return pad + (1 - normalized) * (height - pad * 2);
	}

	function formatDistance(meters: number): string {
		return `${(meters / 1000).toFixed(1)} km`;
	}

	function formatExactDistance(meters: number): string {
		return `${(meters / 1000).toFixed(2)} km`;
	}

	function formatElevation(meters: number): string {
		return `${Math.round(meters).toLocaleString()} m`;
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

	function updateRoundCourseDistanceKm(value: string) {
		roundCourseDistanceKm = value;
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
		scheduleCompletionLookup(constraintCenterCompletionTarget, value);
	}

	function updateAreaRadiusKm(value: string) {
		areaRadiusKm = value;
		clearSpatialConstraintError();
		markPlannerEdited();
	}

	function updateCorridorWidthKm(value: string) {
		corridorWidthKm = value;
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

	function formatDuration(durationMs: number): string {
		const totalMinutes = Math.round(durationMs / 60000);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;

		if (hours === 0) {
			return `${minutes} min`;
		}

		return `${hours}:${minutes.toString().padStart(2, "0")} h`;
	}

	function getRoutingProfileLabel(route: PlannedRoute | null): string {
		if (!route) {
			return "Road-bike planner";
		}

		if (isImportedRoute(route)) {
			return "Imported GPX track";
		}

		if (route.routingStrategy) {
			return route.routingStrategy;
		}

		if (route.routingProfile === "racingbike") {
			return "GraphHopper racingbike profile.";
		}

		return "GraphHopper bike profile.";
	}

	function getRoutingBadgeLabel(route: PlannedRoute | null): string {
		if (!route) {
			return "Road-bike";
		}

		if (isImportedRoute(route)) {
			return "Imported GPX";
		}

		return route.routingProfile === "racingbike"
			? "Racingbike profile"
			: "Bike fallback";
	}

	function getRouteDurationText(route: PlannedRoute | null): string {
		if (!route) {
			return "";
		}

		if (isImportedRoute(route) && !route.source.hasDuration) {
			return "Time unavailable";
		}

		return formatDuration(route.durationMs);
	}

	function getImportedRouteStopSummary(route: PlannedRoute | null): string | null {
		if (!route || !isImportedRoute(route)) {
			return null;
		}

		if (route.source.stopDerivation === "rtept") {
			return "Stops loaded from GPX route points.";
		}

		if (route.source.stopDerivation === "wpt") {
			return "Stops loaded from GPX waypoints.";
		}

		return "Stops inferred from track.";
	}

	function getWaypointCompletionTarget(index: number): CompletionTarget {
		return {
			kind: "waypoint",
			index,
		};
	}

	function isSameCompletionTarget(
		left: CompletionTarget | null,
		right: CompletionTarget | null,
	): boolean {
		if (!left || !right || left.kind !== right.kind) {
			return false;
		}

		if (left.kind !== "waypoint" || right.kind !== "waypoint") {
			return true;
		}

		return left.index === right.index;
	}

	function getCompletionTargetKey(target: CompletionTarget): string {
		return target.kind === "waypoint" ? `waypoint-${target.index}` : target.kind;
	}

	function getCompletionListId(target: CompletionTarget): string {
		return `route-completions-${getCompletionTargetKey(target)}`;
	}

	function getCompletionOptionId(target: CompletionTarget, index: number): string {
		return `${getCompletionListId(target)}-option-${index}`;
	}

	function getValueForCompletionTarget(target: CompletionTarget): string {
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
	}

	function isCompletionMenuVisible(target: CompletionTarget): boolean {
		return (
			isSameCompletionTarget(activeCompletionTarget, target) &&
			(isCompletionLoading || isCompletionEmpty || completionSuggestions.length > 0)
		);
	}

	function getCompletionActiveDescendant(target: CompletionTarget): string | undefined {
		if (
			!isSameCompletionTarget(activeCompletionTarget, target) ||
			completionHighlightedIndex < 0 ||
			completionHighlightedIndex >= completionSuggestions.length
		) {
			return undefined;
		}

		return getCompletionOptionId(target, completionHighlightedIndex);
	}

	function clearCompletionResults() {
		completionSuggestions = [];
		completionHighlightedIndex = -1;
		isCompletionLoading = false;
		isCompletionEmpty = false;
	}

	function cancelCompletionDebounce() {
		if (completionDebounceTimer === null) {
			return;
		}

		clearTimeout(completionDebounceTimer);
		completionDebounceTimer = null;
	}

	function cancelCompletionBlur() {
		if (completionBlurTimer === null) {
			return;
		}

		clearTimeout(completionBlurTimer);
		completionBlurTimer = null;
	}

	function cancelCompletionRequest() {
		completionAbortController?.abort();
		completionAbortController = null;
	}

	function closeCompletionMenu() {
		cancelCompletionBlur();
		cancelCompletionDebounce();
		cancelCompletionRequest();
		clearCompletionResults();
		activeCompletionTarget = null;
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

	function selectCompletion(target: CompletionTarget, suggestion: RouteSuggestion) {
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

		closeCompletionMenu();
	}

	function handleCompletionSelection(
		event: PointerEvent,
		target: CompletionTarget,
		suggestion: RouteSuggestion,
	) {
		event.preventDefault();
		cancelCompletionBlur();
		selectCompletion(target, suggestion);
	}

	function scheduleCompletionLookup(target: CompletionTarget, value: string) {
		activeCompletionTarget = target;
		cancelCompletionDebounce();
		cancelCompletionRequest();
		completionSuggestions = [];
		completionHighlightedIndex = -1;
		isCompletionEmpty = false;

		const trimmedValue = value.trim();
		const fetchFn = clientFetch;

		if (!fetchFn || trimmedValue.length < minCompletionQueryLength) {
			isCompletionLoading = false;
			return;
		}

		isCompletionLoading = true;
		const requestId = ++completionRequestId;

		completionDebounceTimer = setTimeout(async () => {
			completionDebounceTimer = null;
			const abortController = new AbortController();
			completionAbortController = abortController;

			try {
				const response = await fetchFn(
					`/api/route/suggest?q=${encodeURIComponent(trimmedValue)}`,
					{
						signal: abortController.signal,
					},
				);

				if (!response.ok) {
					throw new Error(`Suggestions failed with status ${response.status}`);
				}

				const payload = (await response.json()) as Partial<RouteSuggestionsApiSuccess>;
				const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];

				if (!isSameCompletionTarget(activeCompletionTarget, target) || requestId !== completionRequestId) {
					return;
				}

				completionSuggestions = suggestions;
				completionHighlightedIndex = suggestions.length > 0 ? 0 : -1;
				isCompletionEmpty = suggestions.length === 0;
			} catch (error) {
				if (abortController.signal.aborted) {
					return;
				}

				console.error("Failed to load route suggestions", error);

				if (!isSameCompletionTarget(activeCompletionTarget, target) || requestId !== completionRequestId) {
					return;
				}

				completionSuggestions = [];
				completionHighlightedIndex = -1;
				isCompletionEmpty = false;
			} finally {
				if (
					isSameCompletionTarget(activeCompletionTarget, target) &&
					requestId === completionRequestId
				) {
					isCompletionLoading = false;

					if (completionAbortController === abortController) {
						completionAbortController = null;
					}
				}
			}
		}, completionDebounceMs);
	}

	function handleCompletionFocus(target: CompletionTarget) {
		cancelCompletionBlur();
		activeCompletionTarget = target;
		const value = getValueForCompletionTarget(target);

		if (value.trim().length >= minCompletionQueryLength) {
			scheduleCompletionLookup(target, value);
			return;
		}

		cancelCompletionDebounce();
		cancelCompletionRequest();
		clearCompletionResults();
	}

	function handleCompletionBlur(target: CompletionTarget) {
		if (!isSameCompletionTarget(activeCompletionTarget, target)) {
			return;
		}

		cancelCompletionBlur();
		completionBlurTimer = setTimeout(() => {
			if (isSameCompletionTarget(activeCompletionTarget, target)) {
				closeCompletionMenu();
			}
		}, 120);
	}

	function handleCompletionKeydown(event: KeyboardEvent, target: CompletionTarget) {
		if (!isSameCompletionTarget(activeCompletionTarget, target)) {
			return;
		}

		if (event.key === "Escape" && isCompletionMenuVisible(target)) {
			event.preventDefault();
			closeCompletionMenu();
			return;
		}

		if (completionSuggestions.length === 0) {
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			completionHighlightedIndex = (completionHighlightedIndex + 1) % completionSuggestions.length;
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			completionHighlightedIndex =
				(completionHighlightedIndex - 1 + completionSuggestions.length) %
				completionSuggestions.length;
			return;
		}

		if (event.key === "Enter" && completionHighlightedIndex >= 0) {
			event.preventDefault();
			const suggestion = completionSuggestions[completionHighlightedIndex];

			if (suggestion) {
				selectCompletion(target, suggestion);
			}
		}
	}

	function handleFieldInput(field: RouteField, value: string) {
		updateField(field, value);
		scheduleCompletionLookup(
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
		scheduleCompletionLookup(getWaypointCompletionTarget(index), value);
	}

	function addWaypoint(stop = createPlannerStop(), index = waypointStops.length) {
		if (waypointStops.length >= maxWaypoints) {
			return;
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

		if (activeCompletionTarget?.kind === "waypoint" && activeCompletionTarget.index >= nextIndex) {
			activeCompletionTarget = getWaypointCompletionTarget(activeCompletionTarget.index + 1);
		}

		markPlannerEdited();
	}

	function removeWaypoint(index: number) {
		if (isLockedStopIndex(index + 1)) {
			return;
		}

		if (activeCompletionTarget?.kind === "waypoint") {
			if (activeCompletionTarget.index === index) {
				closeCompletionMenu();
			} else if (activeCompletionTarget.index > index) {
				activeCompletionTarget = getWaypointCompletionTarget(activeCompletionTarget.index - 1);
			}
		}

		waypointStops = waypointStops.filter((_, waypointIndex) => waypointIndex !== index);
		fieldErrors = {
			...fieldErrors,
			waypointQueries: (fieldErrors.waypointQueries ?? []).filter(
				(_, waypointIndex) => waypointIndex !== index,
			),
		};

		markPlannerEdited();
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

	function moveWaypoint(index: number, direction: -1 | 1) {
		const nextIndex = index + direction;

		if (!canMoveWaypoint(index, direction)) {
			return;
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

		if (activeCompletionTarget?.kind === "waypoint") {
			if (activeCompletionTarget.index === index) {
				activeCompletionTarget = getWaypointCompletionTarget(nextIndex);
			} else if (activeCompletionTarget.index === nextIndex) {
				activeCompletionTarget = getWaypointCompletionTarget(index);
			}
		}

		markPlannerEdited();
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

	function removeSelectedMapStop(selectedStop: SelectedMapStop) {
		const selectedStopIndex = (() => {
			if (selectedStop.kind === "start") {
				return 0;
			}

			return selectedStop.kind === "waypoint"
				? selectedStop.index + 1
				: waypointStops.length + 1;
		})();

		if (isLockedStopIndex(selectedStopIndex)) {
			return;
		}

		if (selectedStop.kind === "start") {
			setFieldStop("startQuery", createPlannerStop());
			closeMapClickMenu();
			return;
		}

		if (selectedStop.kind === "destination") {
			setFieldStop("destinationQuery", createPlannerStop());
			closeMapClickMenu();
			return;
		}

		if (selectedStop.kind === "waypoint") {
			if (isOutAndBackMode) {
				setFieldStop("destinationQuery", createPlannerStop());
				closeMapClickMenu();
				return;
			}

			removeWaypoint(selectedStop.index);
			closeMapClickMenu();
		}
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

	function toggleMapSelectionSegmentLock(selection: MapClickSelection) {
		const segmentIndex = getSelectedSegmentIndex(selection);

		if (segmentIndex === null) {
			return;
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
	) {
		const selection = mapClickSelection;

		if (!selection) {
			return;
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
				return;
			}

			addWaypoint(fallbackStop, getMapWaypointInsertionSegmentIndex(selection));
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
			return;
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
			return;
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
	}

	function getManualEditingRequest(): ManualRouteEditingState | undefined {
		return sanitizedLockedSegmentIndexes.length > 0
			? {
					lockedSegmentIndexes: sanitizedLockedSegmentIndexes,
				}
			: undefined;
	}

	function buildCurrentRouteRequest(
		manualEditing = getManualEditingRequest(),
	): RouteRequestPayload & { manualEditing?: ManualRouteEditingState } {
		const spatialConstraint = buildSpatialConstraintRequest();
		const baseRequest: RouteRequestPayload =
			plannerMode === "round_course"
				? {
						mode: "round_course",
						start: getRouteStopInput(startStop),
						waypoints: waypointStops.map((waypoint) =>
							getRouteStopInput(waypoint),
						),
						target: buildRoundCourseTargetRequest(),
						...(spatialConstraint ? { spatialConstraint } : {}),
					}
				: plannerMode === "out_and_back"
					? {
							mode: "out_and_back",
							start: getRouteStopInput(startStop),
							waypoints: waypointStops.map((waypoint) =>
								getRouteStopInput(waypoint),
							),
							turnaround: getRouteStopInput(destinationStop),
							...(spatialConstraint ? { spatialConstraint } : {}),
						}
					: {
							mode: "point_to_point",
							start: getRouteStopInput(startStop),
							waypoints: waypointStops.map((waypoint) =>
								getRouteStopInput(waypoint),
							),
							destination: getRouteStopInput(destinationStop),
							...(spatialConstraint ? { spatialConstraint } : {}),
						};

		return {
			...baseRequest,
			...(manualEditing ? { manualEditing } : {}),
		};
	}

	function applyManualEditingToRoutes(routes: PlannedRoute[]) {
		const manualEditing = getManualEditingRequest();

		return routes.map((route) => ({
			...route,
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

	async function rerouteAfterManualEdit() {
		if (isRouting) {
			return;
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
			const payload = await requestRouteCalculation(buildCurrentRouteRequest());

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
			activeProfileIndex = null;
			chartScrubPointerId = null;
		} catch (error) {
			console.error("Failed to reroute manual edit", error);
			routeRequestError = "The manual route edit could not be recalculated.";
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
		const label = await resolveMapStopLabel(detail.point);
		updateDraggedStop(detail.selectedStop, detail.point, label);
		await rerouteAfterManualEdit();
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
		const existingWaypointIndex = getManualSegmentWaypointIndex(routeLegIndex);
		const label = await resolveMapStopLabel(detail.point);
		const stop = createPlannerStop(label, detail.point, "map");

		if (existingWaypointIndex !== null) {
			setWaypointStop(existingWaypointIndex, stop);
		} else {
			if (waypointStops.length >= maxWaypoints) {
				routeRequestError = `You can add up to ${maxWaypoints} waypoints per route.`;
				return;
			}

			addWaypoint(stop, Math.max(0, Math.min(routeLegIndex, waypointStops.length)));
		}

		await rerouteAfterManualEdit();
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
		isRouting = true;
		pendingSavedRouteId = null;
		activeSavedRouteId = null;
		isActiveRouteSaved = false;
		routeRequestError = null;
		fieldErrors = {};

		try {
			const payload = await requestRouteCalculation(buildCurrentRouteRequest());

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
			deleteSavedRoute(activeSavedRouteId);
			activeSavedRouteId = null;
			isActiveRouteSaved = false;
			return;
		}

		const manualEditing = getManualEditingRequest();
		const savedRoute = addSavedRoute({
			...activeRoute,
			...(manualEditing ? { manualEditing } : {}),
		});
		activeSavedRouteId = savedRoute.id;
		isActiveRouteSaved = true;
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

	function openGpxImportPicker() {
		routeImportError = null;
		gpxImportInput?.click();
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
		fitBounds={combinedRouteBounds}
		hoveredRouteCoordinate={activeProfilePoint?.coordinate ?? null}
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
				class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground"
				aria-label="Wind and conditions"
			>
				<Wind class="size-4" />
			</Button>
		</div>
		{#if mapClickSelection}
			<div
				class="pointer-events-auto absolute z-30 w-52 -translate-x-1/2 -translate-y-[calc(100%+0.85rem)] rounded-xl border border-border/70 bg-background/95 p-2 shadow-xl backdrop-blur-sm"
				style={`left: ${mapClickSelection.screenPoint.x}px; top: ${mapClickSelection.screenPoint.y}px;`}
				role="menu"
				aria-label="Set clicked map point"
			>
				<div class="px-2 pb-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
					{getMapClickMenuTitle(mapClickSelection)}
				</div>
				<div class="px-2 pb-2 text-xs text-muted-foreground">
					{getMapClickMenuSubtitle(mapClickSelection)}
				</div>
				<div class="flex flex-col gap-1">
					<Button
						variant="ghost"
						size="sm"
						class="justify-start"
						type="button"
						disabled={isResolvingMapSelection}
						onclick={() => applyMapPointAsStop({ kind: "startQuery" })}
					>
						Set as start
					</Button>
					{#if plannerMode === "point_to_point"}
						<Button
							variant="ghost"
							size="sm"
							class="justify-start"
							type="button"
							disabled={
								isResolvingMapSelection ||
								waypointStops.length >= maxWaypoints ||
								isMapWaypointInsertionLocked(mapClickSelection)
							}
							onclick={() => applyMapPointAsStop({ kind: "waypoint" })}
						>
							Add waypoint here
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class="justify-start"
							type="button"
							disabled={isResolvingMapSelection}
							onclick={() => applyMapPointAsStop({ kind: "destinationQuery" })}
						>
							Set as destination
						</Button>
					{:else if isOutAndBackMode}
						<Button
							variant="ghost"
							size="sm"
							class="justify-start"
							type="button"
							disabled={isResolvingMapSelection}
							onclick={() => applyMapPointAsStop({ kind: "destinationQuery" })}
						>
							Set as turnaround
						</Button>
					{/if}
					{#if mapClickSelection.selectedSegment}
						<Button
							variant="ghost"
							size="sm"
							class="justify-start gap-2"
							type="button"
							onclick={() =>
								mapClickSelection &&
								toggleMapSelectionSegmentLock(mapClickSelection)}
						>
							{#if isMapSelectionSegmentLocked(mapClickSelection)}
								<Unlock class="size-3.5" />
								Unlock segment
							{:else}
								<Lock class="size-3.5" />
								Lock segment
							{/if}
						</Button>
					{/if}
					{#if mapClickSelection.selectedStop}
						<Button
							variant="ghost"
							size="sm"
							class="justify-start text-destructive hover:text-destructive"
							type="button"
							disabled={isResolvingMapSelection}
							onclick={() =>
								mapClickSelection?.selectedStop &&
								removeSelectedMapStop(mapClickSelection.selectedStop)}
						>
							{getRemoveActionLabel(mapClickSelection.selectedStop)}
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						class="justify-start text-muted-foreground"
						type="button"
						disabled={isResolvingMapSelection}
						onclick={closeMapClickMenu}
					>
						Cancel
					</Button>
				</div>
			</div>
		{/if}
	</div>

	<div
		class="pointer-events-none relative z-10 flex h-full min-h-0 w-full flex-col gap-3 p-4 md:p-5"
	>
		<div class="flex min-h-0 min-w-0 flex-1 gap-5 md:gap-6">
			<div
				class="pointer-events-auto flex w-full max-w-[340px] flex-col gap-3 max-md:ml-11 max-md:mt-10 md:ml-0 md:mt-4"
			>
				<form
					class="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-lg"
					onsubmit={handleGenerateRoute}
				>
					<div class="flex items-center justify-between gap-3">
						<div class="space-y-1">
							<h2 class="text-base font-semibold tracking-tight md:text-lg">Route Builder</h2>
							<p class="text-xs text-muted-foreground">
								{isRoundCourseMode
									? "Plan a loop ride from one start point and let GraphHopper bring it back home."
									: isOutAndBackMode
										? "Pick a turnaround point and return on the same road."
									: "Build an asphalt-first road-bike route with optional intermediate stops."}
							</p>
						</div>
						<Badge
							variant="secondary"
							class="h-5 shrink-0 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold text-primary"
						>
							Asphalt first
						</Badge>
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
						<div class="space-y-2">
							<label
								for="start-point"
								class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
							>
								Start
							</label>
							<div class="relative">
								<MapPin
									class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									id="start-point"
									value={startStop.label}
									placeholder="Enter starting point..."
									class="border-none bg-secondary/20 pl-9 pr-10 focus-visible:ring-1 focus-visible:ring-primary/50"
									autocomplete="off"
									aria-autocomplete="list"
									aria-controls={getCompletionListId(startCompletionTarget)}
									aria-expanded={isCompletionMenuVisible(startCompletionTarget)}
									aria-activedescendant={getCompletionActiveDescendant(startCompletionTarget)}
									aria-invalid={fieldErrors.startQuery ? "true" : undefined}
									onfocus={() => handleCompletionFocus(startCompletionTarget)}
									onblur={() => handleCompletionBlur(startCompletionTarget)}
									onkeydown={(event) => handleCompletionKeydown(event, startCompletionTarget)}
									oninput={(event) =>
										handleFieldInput(
											"startQuery",
											(event.currentTarget as HTMLInputElement).value,
										)}
								/>
								<Button
									variant="ghost"
									size="icon-xs"
									type="button"
									class="absolute right-1.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
									disabled={isLocating}
									aria-label="Use current location as start"
									onclick={() => useCurrentLocationAsStop("startQuery")}
								>
									<LocateFixed class="size-3.5" />
								</Button>
								{#if isCompletionMenuVisible(startCompletionTarget)}
									<div
										class="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-30 overflow-hidden rounded-lg border border-border/70 bg-background/96 shadow-xl backdrop-blur-sm"
									>
										<div
											id={getCompletionListId(startCompletionTarget)}
											role="listbox"
											aria-label="Start suggestions"
											class="max-h-64 overflow-y-auto py-1"
										>
											{#if isCompletionLoading}
												<div class="px-3 py-2 text-xs font-medium text-muted-foreground">
													Searching places...
												</div>
											{:else if completionSuggestions.length > 0}
												{#each completionSuggestions as suggestion, index (`start-${suggestion.label}-${index}`)}
													<button
														id={getCompletionOptionId(startCompletionTarget, index)}
														type="button"
														role="option"
														class={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
															completionHighlightedIndex === index
																? "bg-primary/10 text-foreground"
																: "text-foreground/90 hover:bg-secondary/65"
														}`}
														aria-selected={completionHighlightedIndex === index}
														onpointerdown={(event) =>
															handleCompletionSelection(event, startCompletionTarget, suggestion)}
													>
														<span class="min-w-0 truncate">{suggestion.label}</span>
														<MapPin class="size-3.5 shrink-0 text-muted-foreground" />
													</button>
												{/each}
											{:else if isCompletionEmpty}
												<div class="px-3 py-2 text-xs font-medium text-muted-foreground">
													No matches found.
												</div>
											{/if}
										</div>
									</div>
								{/if}
							</div>
							{#if fieldErrors.startQuery}
								<p class="text-xs font-medium text-destructive">{fieldErrors.startQuery}</p>
							{/if}
						</div>

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
								{#if roundCourseTargetKind === "distance"}
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
												value={roundCourseDistanceKm}
												placeholder="e.g. 60"
												class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
												aria-invalid={fieldErrors.roundCourseTarget ? "true" : undefined}
												oninput={(event) =>
													updateRoundCourseDistanceKm(
														(event.currentTarget as HTMLInputElement).value,
													)}
											/>
											<span
												class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
											>
												km
											</span>
										</div>
									</div>
								{:else if roundCourseTargetKind === "duration"}
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
								{:else}
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
									GraphHopper will generate a loop that starts and ends at the same place.
								</p>
								{#if fieldErrors.roundCourseTarget}
									<p class="text-xs font-medium text-destructive">
										{fieldErrors.roundCourseTarget}
									</p>
								{/if}
							</div>
						{:else}
							{#if !isRoundCourseMode}
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
														<div class="relative">
															<MapPin
																class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-amber-600 dark:text-amber-300"
															/>
															<Input
																id={`waypoint-${index}`}
																value={waypointStop.label}
																placeholder="Add a stop..."
																class="border-none bg-secondary/20 pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
																autocomplete="off"
																aria-autocomplete="list"
																aria-controls={getCompletionListId(getWaypointCompletionTarget(index))}
																aria-expanded={isCompletionMenuVisible(getWaypointCompletionTarget(index))}
																aria-activedescendant={getCompletionActiveDescendant(
																	getWaypointCompletionTarget(index),
																)}
																aria-invalid={getWaypointError(index) ? "true" : undefined}
																onfocus={() =>
																	handleCompletionFocus(getWaypointCompletionTarget(index))}
																onblur={() => handleCompletionBlur(getWaypointCompletionTarget(index))}
																onkeydown={(event) =>
																	handleCompletionKeydown(event, getWaypointCompletionTarget(index))}
																oninput={(event) =>
																	handleWaypointInput(
																		index,
																		(event.currentTarget as HTMLInputElement).value,
																	)}
															/>
															{#if isCompletionMenuVisible(getWaypointCompletionTarget(index))}
																<div
																	class="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-30 overflow-hidden rounded-lg border border-border/70 bg-background/96 shadow-xl backdrop-blur-sm"
																>
																	<div
																		id={getCompletionListId(getWaypointCompletionTarget(index))}
																		role="listbox"
																		aria-label={`Waypoint ${index + 1} suggestions`}
																		class="max-h-64 overflow-y-auto py-1"
																	>
																		{#if isCompletionLoading}
																			<div class="px-3 py-2 text-xs font-medium text-muted-foreground">
																				Searching places...
																			</div>
																		{:else if completionSuggestions.length > 0}
																			{#each completionSuggestions as suggestion, suggestionIndex (`waypoint-${index}-${suggestion.label}-${suggestionIndex}`)}
																				<button
																					id={getCompletionOptionId(
																						getWaypointCompletionTarget(index),
																						suggestionIndex,
																					)}
																					type="button"
																					role="option"
																					class={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
																						completionHighlightedIndex === suggestionIndex
																							? "bg-primary/10 text-foreground"
																							: "text-foreground/90 hover:bg-secondary/65"
																					}`}
																					aria-selected={completionHighlightedIndex === suggestionIndex}
																					onpointerdown={(event) =>
																						handleCompletionSelection(
																							event,
																							getWaypointCompletionTarget(index),
																							suggestion,
																						)}
																				>
																					<span class="min-w-0 truncate">{suggestion.label}</span>
																					<MapPin class="size-3.5 shrink-0 text-muted-foreground" />
																				</button>
																			{/each}
																		{:else if isCompletionEmpty}
																			<div class="px-3 py-2 text-xs font-medium text-muted-foreground">
																				No matches found.
																			</div>
																		{/if}
																	</div>
																</div>
															{/if}
														</div>
														{#if getWaypointError(index)}
															<p class="text-xs font-medium text-destructive">
																{getWaypointError(index)}
															</p>
														{/if}
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

							<div class="space-y-2">
								<label
									for="destination"
									class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
								>
									{getDestinationFieldLabel()}
								</label>
								<div class="relative">
									<Navigation
										class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary"
									/>
									<Input
										id="destination"
										value={destinationStop.label}
										placeholder={getDestinationPlaceholder()}
										class="border-none bg-secondary/20 pl-9 pr-10 focus-visible:ring-1 focus-visible:ring-primary/50"
										autocomplete="off"
										aria-autocomplete="list"
										aria-controls={getCompletionListId(destinationCompletionTarget)}
										aria-expanded={isCompletionMenuVisible(destinationCompletionTarget)}
										aria-activedescendant={getCompletionActiveDescendant(destinationCompletionTarget)}
										aria-invalid={fieldErrors.destinationQuery ? "true" : undefined}
										onfocus={() => handleCompletionFocus(destinationCompletionTarget)}
										onblur={() => handleCompletionBlur(destinationCompletionTarget)}
										onkeydown={(event) =>
											handleCompletionKeydown(event, destinationCompletionTarget)}
										oninput={(event) =>
											handleFieldInput(
												"destinationQuery",
												(event.currentTarget as HTMLInputElement).value,
											)}
									/>
									<Button
										variant="ghost"
										size="icon-xs"
										type="button"
										class="absolute right-1.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
										disabled={isLocating}
										aria-label={getCurrentLocationDestinationLabel()}
										onclick={() => useCurrentLocationAsStop("destinationQuery")}
									>
										<LocateFixed class="size-3.5" />
									</Button>
									{#if isCompletionMenuVisible(destinationCompletionTarget)}
										<div
											class="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-30 overflow-hidden rounded-lg border border-border/70 bg-background/96 shadow-xl backdrop-blur-sm"
										>
											<div
												id={getCompletionListId(destinationCompletionTarget)}
												role="listbox"
												aria-label={`${getDestinationFieldLabel()} suggestions`}
												class="max-h-64 overflow-y-auto py-1"
											>
												{#if isCompletionLoading}
													<div class="px-3 py-2 text-xs font-medium text-muted-foreground">
														Searching places...
													</div>
												{:else if completionSuggestions.length > 0}
													{#each completionSuggestions as suggestion, index (`destination-${suggestion.label}-${index}`)}
														<button
															id={getCompletionOptionId(destinationCompletionTarget, index)}
															type="button"
															role="option"
															class={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
																completionHighlightedIndex === index
																	? "bg-primary/10 text-foreground"
																	: "text-foreground/90 hover:bg-secondary/65"
															}`}
															aria-selected={completionHighlightedIndex === index}
															onpointerdown={(event) =>
																handleCompletionSelection(
																	event,
																	destinationCompletionTarget,
																	suggestion,
																)}
														>
															<span class="min-w-0 truncate">{suggestion.label}</span>
															<Navigation class="size-3.5 shrink-0 text-muted-foreground" />
														</button>
													{/each}
												{:else if isCompletionEmpty}
													<div class="px-3 py-2 text-xs font-medium text-muted-foreground">
														No matches found.
													</div>
												{/if}
											</div>
										</div>
									{/if}
								</div>
								{#if fieldErrors.destinationQuery}
									<p class="text-xs font-medium text-destructive">
										{fieldErrors.destinationQuery}
									</p>
								{/if}
							</div>
						{/if}
					</div>

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
								<label
									for="constraint-center"
									class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
								>
									Area center
								</label>
								<div class="relative">
									<MapPin
										class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sky-600 dark:text-sky-300"
									/>
									<Input
										id="constraint-center"
										value={constraintCenterStop.label}
										placeholder="Enter area center..."
										class="border-none bg-background pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
										autocomplete="off"
										aria-autocomplete="list"
										aria-controls={getCompletionListId(constraintCenterCompletionTarget)}
										aria-expanded={isCompletionMenuVisible(
											constraintCenterCompletionTarget,
										)}
										aria-activedescendant={getCompletionActiveDescendant(
											constraintCenterCompletionTarget,
										)}
										aria-invalid={fieldErrors.spatialConstraint ? "true" : undefined}
										onfocus={() => handleCompletionFocus(constraintCenterCompletionTarget)}
										onblur={() => handleCompletionBlur(constraintCenterCompletionTarget)}
										onkeydown={(event) =>
											handleCompletionKeydown(event, constraintCenterCompletionTarget)}
										oninput={(event) =>
											updateConstraintCenterInput(
												(event.currentTarget as HTMLInputElement).value,
											)}
									/>
									{#if isCompletionMenuVisible(constraintCenterCompletionTarget)}
										<div
											class="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-30 overflow-hidden rounded-lg border border-border/70 bg-background/96 shadow-xl backdrop-blur-sm"
										>
											<div
												id={getCompletionListId(constraintCenterCompletionTarget)}
												role="listbox"
												aria-label="Area center suggestions"
												class="max-h-64 overflow-y-auto py-1"
											>
												{#if isCompletionLoading}
													<div class="px-3 py-2 text-xs font-medium text-muted-foreground">
														Searching places...
													</div>
												{:else if completionSuggestions.length > 0}
													{#each completionSuggestions as suggestion, index (`constraint-${suggestion.label}-${index}`)}
														<button
															id={getCompletionOptionId(
																constraintCenterCompletionTarget,
																index,
															)}
															type="button"
															role="option"
															class={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
																completionHighlightedIndex === index
																	? "bg-primary/10 text-foreground"
																	: "text-foreground/90 hover:bg-secondary/65"
															}`}
															aria-selected={completionHighlightedIndex === index}
															onpointerdown={(event) =>
																handleCompletionSelection(
																	event,
																	constraintCenterCompletionTarget,
																	suggestion,
																)}
														>
															<span class="min-w-0 truncate">{suggestion.label}</span>
															<MapPin class="size-3.5 shrink-0 text-muted-foreground" />
														</button>
													{/each}
												{:else if isCompletionEmpty}
													<div class="px-3 py-2 text-xs font-medium text-muted-foreground">
														No matches found.
													</div>
												{/if}
											</div>
										</div>
									{/if}
								</div>
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
										min="1"
										max="250"
										step="1"
										inputmode="decimal"
										value={areaRadiusKm}
										class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
										aria-invalid={fieldErrors.spatialConstraint ? "true" : undefined}
										oninput={(event) =>
											updateAreaRadiusKm(
												(event.currentTarget as HTMLInputElement).value,
											)}
									/>
									<span
										class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
									>
										km
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
										min="2"
										max="80"
										step="1"
										inputmode="decimal"
										value={corridorWidthKm}
										class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
										aria-invalid={fieldErrors.spatialConstraint ? "true" : undefined}
										oninput={(event) =>
											updateCorridorWidthKm(
												(event.currentTarget as HTMLInputElement).value,
											)}
									/>
									<span
										class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
									>
										km
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

					{#if activeRoutingWarnings.length > 0}
						<div
							class="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
							role="status"
						>
							{activeRoutingWarnings[0]}
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
					{#if activeRoute}
						<div
							class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums sm:text-sm"
						>
							<span class="font-semibold text-foreground">
								<span class="font-heading text-base sm:text-lg">
									{formatDistance(activeRoute.distanceMeters).replace(" km", "")}
								</span>
								km
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
							<span class="font-semibold text-foreground">{getRouteDurationText(activeRoute)}</span>
						</div>
					{:else}
						<div class="flex min-w-0 flex-col gap-1">
							<span class="text-sm font-semibold text-foreground">
								{isRouting
									? isRoundCourseMode
										? "Calculating the round course..."
										: isOutAndBackMode
											? "Calculating the out-and-back route..."
										: "Calculating the road-bike route..."
									: isRoundCourseMode
										? "Generate a round course to see live distance, climbing, and elevation."
										: isOutAndBackMode
											? "Generate an out-and-back route to see live distance, climbing, and elevation."
										: "Generate a route to see live distance, climbing, and elevation."}
							</span>
							<span class="text-xs text-muted-foreground">
								{isRouting
									? isRoundCourseMode
										? "GraphHopper is resolving the start point and building a loop ride."
										: isOutAndBackMode
											? "GraphHopper is resolving the stops and mirroring the return leg."
										: "GraphHopper is resolving locations and building the route."
									: isRoundCourseMode
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
								class="font-semibold"
								disabled={isImportingGpx}
								onclick={openGpxImportPicker}
							>
								{isImportingGpx ? "Importing GPX..." : "Import GPX"}
							</Button>
							<Button
								variant={isActiveRouteSaved ? "secondary" : "outline"}
								size="sm"
								class="gap-1 font-semibold"
								disabled={!activeRoute}
								onclick={handleSaveDraft}
							>
								{#if isActiveRouteSaved}
									<Check class="size-3.5" />
									Saved
								{:else}
									Save Draft
								{/if}
							</Button>
							<Button
								size="sm"
								class="font-semibold"
								disabled={!activeRoute}
								onclick={handleExportGpx}
							>
								Export GPX
							</Button>
							<Button
								variant="outline"
								size="sm"
								class="gap-1 font-semibold"
								disabled={!activeRoute}
								onclick={() => (routeAnalysisOpen = !routeAnalysisOpen)}
								aria-expanded={activeRoute ? routeAnalysisOpen : false}
								aria-controls="route-analysis-panel"
							>
								{routeAnalysisOpen ? "Less" : "Analysis"}
								{#if routeAnalysisOpen}
									<ChevronUp class="size-3.5 opacity-70" />
								{:else}
									<ChevronDown class="size-3.5 opacity-70" />
								{/if}
							</Button>
						</div>
					</div>
				</div>

				{#if routeExportError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{routeExportError}
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

				{#if activeImportedRouteSource}
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

				{#if routeAlternatives.length > 1}
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

				{#if alternativeInfoMessage}
					<div
						class="mt-3 rounded-lg border border-border/50 bg-secondary/10 px-3 py-2 text-sm text-muted-foreground"
						role="status"
					>
						{alternativeInfoMessage}
					</div>
				{/if}

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
								class="flex flex-wrap items-center justify-end gap-x-2 gap-y-0 text-xs tabular-nums text-muted-foreground"
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
							</div>
						{:else}
							<span class="text-xs text-muted-foreground">No route profile yet</span>
						{/if}
					</div>
					<div class="px-2 pb-1.5 pt-1">
						{#if elevationSamples.length > 0}
							<svg
								class="block w-full touch-none"
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
				</div>

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
								{#if activeRoutingWarnings.length > 0}
									<div class="rounded-md border border-amber-500/20 bg-amber-500/8 px-2.5 py-2 text-amber-900 dark:text-amber-100">
										<div class="mb-1 font-semibold uppercase tracking-wide text-amber-900/70 dark:text-amber-100/70">
											Routing fallback
										</div>
										<div class="font-medium">
											{activeRoutingWarnings[0]}
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
