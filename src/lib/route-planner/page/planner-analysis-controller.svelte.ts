import { Option } from "effect";
import {
	analyzeRouteClimbs,
	getProviderWarnings,
	getReadinessWarnings,
	getRouteElevationAnalysisPoints,
	getRouteWarnings,
	getSurfaceMix,
	getWindSummary,
	sampleElevationProfile,
	type PlannedRoute,
	type RouteClimb,
	type RouteGradientSection,
	type RouteWarning,
	type RouteWindSegment,
} from "$lib/route-planning";
import { chartW, padY } from "$lib/route-planner/constants";
import {
	formatDuration,
	formatExactDistance,
} from "$lib/route-planner/formatters";
import { formatDistance } from "$lib/unit-settings.svelte";
import {
	createPlannerOverlayCache,
	type PlannerOverlayCache,
} from "./planner-overlay-cache";
import { getRouteShareSignature } from "$lib/route-planner/page/planner-state";

type PlannerAnalysisControllerDependencies = {
	getActiveRoute: () => PlannedRoute | null;
	getRouteAlternatives: () => PlannedRoute[];
	cache?: PlannerOverlayCache;
};

export function createPlannerAnalysisController(
	dependencies: PlannerAnalysisControllerDependencies,
) {
	const cache = dependencies.cache ?? createPlannerOverlayCache();

	let directionsOpen = $state(false);
	let routeAnalysisOpen = $state(false);
	let selectedCueIndex = $state<number | null>(null);
	let selectedCueFocusKey = $state(0);
	let lastCueRouteKey = $state<string | null>(null);
	let activeProfileIndex = $state<number | null>(null);
	let chartScrubPointerId = $state<number | null>(null);

	const activeRoute = $derived(dependencies.getActiveRoute());
	const routeAlternatives = $derived(dependencies.getRouteAlternatives());
	const activeDirections = $derived(activeRoute?.instructions ?? []);
	const selectedCue = $derived(
		selectedCueIndex === null
			? null
			: (activeDirections[selectedCueIndex] ?? null),
	);
	const activeRouteClimbs = $derived<RouteClimb[]>(
		activeRoute
			? analyzeRouteClimbs(
					getRouteElevationAnalysisPoints(activeRoute.coordinates),
				)
			: [],
	);
	const activeRouteGradientMetrics = $derived(
		activeRoute ? cache.getCachedRouteGradientMetrics(activeRoute) : null,
	);
	const activeRouteGradientSections = $derived<RouteGradientSection[]>(
		activeRoute ? cache.getCachedRouteGradientSections(activeRoute) : [],
	);
	const notableGradientSections = $derived<RouteGradientSection[]>(
		[...activeRouteGradientSections]
			.filter((section) => section.bucket !== "flat")
			.sort(
				(a, b) =>
					Math.abs(b.averageGradePercent) - Math.abs(a.averageGradePercent),
			)
			.slice(0, 5),
	);
	const activeRouteQuality = $derived(
		activeRoute ? cache.getCachedRouteQuality(activeRoute) : null,
	);
	const activeTrainingSuitability = $derived(
		activeRoute ? cache.getCachedRouteTrainingSuitability(activeRoute) : null,
	);
	const routeAlternativeQualities = $derived(
		routeAlternatives.map((route) => cache.getCachedRouteQuality(route)),
	);
	const activeWindSummary = $derived(
		activeRoute
			? Option.getOrElse(getWindSummary(activeRoute), () => null)
			: null,
	);
	const strongestWindSegments = $derived<RouteWindSegment[]>(
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
	const highlightedRouteCoordinate = $derived(
		selectedCue?.coordinate ?? activeProfilePoint?.coordinate ?? null,
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
			activeProfileIndex = null;
			chartScrubPointerId = null;
			lastCueRouteKey = nextRouteKey;
		}
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

	function elevY(meters: number, height: number, pad: number): number {
		const normalized = (meters - elevMin) / elevRange;
		return pad + (1 - normalized) * (height - pad * 2);
	}

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

	function selectCue(index: number) {
		selectedCueIndex = selectedCueIndex === index ? null : index;
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
		return formatDuration(ms);
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

	function resetActiveProfile() {
		activeProfileIndex = null;
		chartScrubPointerId = null;
	}

	return {
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
		get selectedCueIndex() {
			return selectedCueIndex;
		},
		get selectedCueFocusKey() {
			return selectedCueFocusKey;
		},
		get lastCueRouteKey() {
			return lastCueRouteKey;
		},
		get selectedCue() {
			return selectedCue;
		},
		get activeProfileIndex() {
			return activeProfileIndex;
		},
		get chartScrubPointerId() {
			return chartScrubPointerId;
		},
		get activeRouteClimbs() {
			return activeRouteClimbs;
		},
		get activeRouteGradientMetrics() {
			return activeRouteGradientMetrics;
		},
		get activeRouteGradientSections() {
			return activeRouteGradientSections;
		},
		get notableGradientSections() {
			return notableGradientSections;
		},
		get activeRouteQuality() {
			return activeRouteQuality;
		},
		get activeTrainingSuitability() {
			return activeTrainingSuitability;
		},
		get routeAlternativeQualities() {
			return routeAlternativeQualities;
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
		getWarningContainerClass,
		getWarningBadgeClass,
		selectCue,
		getWindSegmentDistanceRange,
		formatCueSegmentTime,
		handleChartPointerDown,
		handleChartPointerMove,
		handleChartPointerLeave,
		get releaseChartScrub() {
			return releaseChartScrub;
		},
		handleChartLostPointerCapture,
		resetActiveProfile,
	};
}

export type PlannerAnalysisController = ReturnType<
	typeof createPlannerAnalysisController
>;
