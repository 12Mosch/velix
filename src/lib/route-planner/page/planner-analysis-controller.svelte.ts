import { Option } from "effect";
import {
	analyzeRouteClimbs,
	getProviderWarnings,
	getReadinessWarnings,
	getRouteElevationAnalysisPoints,
	getRouteWarnings,
	getSurfaceMix as getRouteSurfaceMix,
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
import { createMemoizedSelector } from "$lib/route-planner/page/planner-selector-memo";

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

	function getActiveRoute() {
		return dependencies.getActiveRoute();
	}

	function getRouteAlternatives() {
		return dependencies.getRouteAlternatives();
	}

	function getActiveDirections() {
		return getActiveRoute()?.instructions ?? [];
	}

	function getSelectedCue() {
		return selectedCueIndex === null
			? null
			: (getActiveDirections()[selectedCueIndex] ?? null);
	}

	const selectActiveRouteClimbs = createMemoizedSelector(
		(activeRoute: PlannedRoute | null): RouteClimb[] =>
			activeRoute
				? analyzeRouteClimbs(
						getRouteElevationAnalysisPoints(activeRoute.coordinates),
					)
				: [],
	);

	function getActiveRouteClimbs() {
		return selectActiveRouteClimbs(getActiveRoute());
	}

	const selectActiveRouteGradientMetrics = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute ? cache.getCachedRouteGradientMetrics(activeRoute) : null,
	);

	function getActiveRouteGradientMetrics() {
		return selectActiveRouteGradientMetrics(getActiveRoute());
	}

	const selectActiveRouteGradientSections = createMemoizedSelector(
		(activeRoute: PlannedRoute | null): RouteGradientSection[] =>
			activeRoute ? cache.getCachedRouteGradientSections(activeRoute) : [],
	);

	function getActiveRouteGradientSections() {
		return selectActiveRouteGradientSections(getActiveRoute());
	}

	const selectNotableGradientSections = createMemoizedSelector(
		(
			activeRouteGradientSections: RouteGradientSection[],
		): RouteGradientSection[] =>
			[...activeRouteGradientSections]
				.filter((section) => section.bucket !== "flat")
				.sort(
					(a, b) =>
						Math.abs(b.averageGradePercent) - Math.abs(a.averageGradePercent),
				)
				.slice(0, 5),
	);

	function getNotableGradientSections() {
		return selectNotableGradientSections(getActiveRouteGradientSections());
	}

	const selectActiveRouteQuality = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute ? cache.getCachedRouteQuality(activeRoute) : null,
	);

	function getActiveRouteQuality() {
		return selectActiveRouteQuality(getActiveRoute());
	}

	const selectActiveTrainingSuitability = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute ? cache.getCachedRouteTrainingSuitability(activeRoute) : null,
	);

	function getActiveTrainingSuitability() {
		return selectActiveTrainingSuitability(getActiveRoute());
	}

	const selectRouteAlternativeQualities = createMemoizedSelector(
		(routeAlternatives: PlannedRoute[]) =>
			routeAlternatives.map((route) => cache.getCachedRouteQuality(route)),
	);

	function getRouteAlternativeQualities() {
		return selectRouteAlternativeQualities(getRouteAlternatives());
	}

	const selectActiveWindSummary = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute
				? Option.getOrElse(getWindSummary(activeRoute), () => null)
				: null,
	);

	function getActiveWindSummary() {
		return selectActiveWindSummary(getActiveRoute());
	}

	const selectStrongestWindSegments = createMemoizedSelector(
		(activeRoute: PlannedRoute | null): RouteWindSegment[] =>
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

	function getStrongestWindSegments() {
		return selectStrongestWindSegments(getActiveRoute());
	}

	const selectActiveCategorizedClimbs = createMemoizedSelector(
		(activeRouteClimbs: RouteClimb[]) =>
			activeRouteClimbs.filter((climb) => climb.category !== "Uncategorized"),
	);

	function getActiveCategorizedClimbs() {
		return selectActiveCategorizedClimbs(getActiveRouteClimbs());
	}

	const selectActiveKeyClimbs = createMemoizedSelector(
		(activeRouteClimbs: RouteClimb[]) =>
			activeRouteClimbs.filter((climb) => climb.isKeyClimb),
	);

	function getActiveKeyClimbs() {
		return selectActiveKeyClimbs(getActiveRouteClimbs());
	}

	const selectHardestClimb = createMemoizedSelector(
		(activeRouteClimbs: RouteClimb[]) =>
			activeRouteClimbs.reduce<RouteClimb | null>(
				(hardest, climb) =>
					!hardest || climb.score > hardest.score ? climb : hardest,
				null,
			),
	);

	function getHardestClimb() {
		return selectHardestClimb(getActiveRouteClimbs());
	}

	const selectSurfaceMix = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute ? getRouteSurfaceMix(activeRoute) : [],
	);

	function getSurfaceMix() {
		return selectSurfaceMix(getActiveRoute());
	}

	const selectActiveWarnings = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute ? getRouteWarnings(activeRoute) : [],
	);

	function getActiveWarnings() {
		return selectActiveWarnings(getActiveRoute());
	}

	const selectActiveReadinessWarnings = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute ? getReadinessWarnings(activeRoute) : [],
	);

	function getActiveReadinessWarnings() {
		return selectActiveReadinessWarnings(getActiveRoute());
	}

	const selectActiveProviderWarnings = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute ? getProviderWarnings(activeRoute) : [],
	);

	function getActiveProviderWarnings() {
		return selectActiveProviderWarnings(getActiveRoute());
	}

	function getPrimaryActiveWarning() {
		return (
			getActiveReadinessWarnings()[0] ?? getActiveProviderWarnings()[0] ?? null
		);
	}

	const selectElevationSamples = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute ? sampleElevationProfile(activeRoute.coordinates) : [],
	);

	function getElevationSamples() {
		return selectElevationSamples(getActiveRoute());
	}

	function getChartH() {
		return routeAnalysisOpen ? 72 : 44;
	}

	function getElevMin() {
		const elevationSamples = getElevationSamples();
		return elevationSamples.length > 0
			? Math.min(...elevationSamples.map((point) => point.elevationMeters))
			: 0;
	}

	function getElevMax() {
		const elevationSamples = getElevationSamples();
		return elevationSamples.length > 0
			? Math.max(...elevationSamples.map((point) => point.elevationMeters))
			: 0;
	}

	function getElevRange() {
		return Math.max(getElevMax() - getElevMin(), 1);
	}

	function getSampledProfileDistanceTotal() {
		const elevationSamples = getElevationSamples();
		return (
			elevationSamples[elevationSamples.length - 1]?.distanceMeters ?? null
		);
	}

	const selectChartProfilePoints = createMemoizedSelector(
		(
			elevationSamples: ReturnType<typeof sampleElevationProfile>,
			sampledProfileDistanceTotal: number | null,
			elevMin: number,
			elevRange: number,
			chartH: number,
		) =>
			elevationSamples.map((point) => {
				const x =
					elevationSamples.length > 1
						? (point.distanceMeters /
								Math.max(sampledProfileDistanceTotal ?? 1, 1)) *
							chartW
						: chartW / 2;
				const y = elevY(
					point.elevationMeters,
					chartH,
					padY,
					elevMin,
					elevRange,
				);

				return {
					...point,
					x,
					y,
				};
			}),
	);

	function getChartProfilePoints() {
		return selectChartProfilePoints(
			getElevationSamples(),
			getSampledProfileDistanceTotal(),
			getElevMin(),
			getElevRange(),
			getChartH(),
		);
	}

	function getActiveProfilePoint() {
		return activeProfileIndex === null
			? null
			: (getChartProfilePoints()[activeProfileIndex] ?? null);
	}

	const selectLinePoints = createMemoizedSelector(
		(chartProfilePoints: ReturnType<typeof getChartProfilePoints>) =>
			chartProfilePoints.map((point) => `${point.x},${point.y}`).join(" "),
	);

	function getLinePoints() {
		return selectLinePoints(getChartProfilePoints());
	}

	const selectAreaD = createMemoizedSelector(
		(
			linePoints: string,
			chartProfilePoints: ReturnType<typeof getChartProfilePoints>,
			chartH: number,
		) =>
			linePoints
				? `M ${chartProfilePoints[0]?.x ?? 0},${chartH} L ${linePoints.replaceAll(" ", " L ")} L ${chartProfilePoints[chartProfilePoints.length - 1]?.x ?? chartW},${chartH} Z`
				: "",
	);

	function getAreaD() {
		return selectAreaD(getLinePoints(), getChartProfilePoints(), getChartH());
	}

	const selectDistanceTickLabels = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute
				? [
						formatDistance(activeRoute.distanceMeters * 0.25),
						formatDistance(activeRoute.distanceMeters * 0.5),
						formatDistance(activeRoute.distanceMeters * 0.75),
						formatDistance(activeRoute.distanceMeters),
					]
				: [],
	);

	function getDistanceTickLabels() {
		return selectDistanceTickLabels(getActiveRoute());
	}

	const selectHighlightedRouteCoordinate = createMemoizedSelector(
		(
			selectedCue: ReturnType<typeof getSelectedCue>,
			activeProfilePoint: ReturnType<typeof getActiveProfilePoint>,
		) => selectedCue?.coordinate ?? activeProfilePoint?.coordinate ?? null,
	);

	function getHighlightedRouteCoordinate() {
		return selectHighlightedRouteCoordinate(
			getSelectedCue(),
			getActiveProfilePoint(),
		);
	}

	$effect(() => {
		if (!getActiveRoute() && routeAnalysisOpen) {
			routeAnalysisOpen = false;
		}
	});

	$effect(() => {
		const activeRoute = getActiveRoute();
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
		const chartProfilePoints = getChartProfilePoints();
		if (!getActiveRoute() || chartProfilePoints.length === 0) {
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

	function elevY(
		meters: number,
		height: number,
		pad: number,
		elevMin: number,
		elevRange: number,
	): number {
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
		const chartProfilePoints = getChartProfilePoints();
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
			return getSelectedCue();
		},
		get activeProfileIndex() {
			return activeProfileIndex;
		},
		get chartScrubPointerId() {
			return chartScrubPointerId;
		},
		get activeRouteClimbs() {
			return getActiveRouteClimbs();
		},
		get activeRouteGradientMetrics() {
			return getActiveRouteGradientMetrics();
		},
		get activeRouteGradientSections() {
			return getActiveRouteGradientSections();
		},
		get notableGradientSections() {
			return getNotableGradientSections();
		},
		get activeRouteQuality() {
			return getActiveRouteQuality();
		},
		get activeTrainingSuitability() {
			return getActiveTrainingSuitability();
		},
		get routeAlternativeQualities() {
			return getRouteAlternativeQualities();
		},
		get activeWindSummary() {
			return getActiveWindSummary();
		},
		get strongestWindSegments() {
			return getStrongestWindSegments();
		},
		get activeCategorizedClimbs() {
			return getActiveCategorizedClimbs();
		},
		get activeKeyClimbs() {
			return getActiveKeyClimbs();
		},
		get hardestClimb() {
			return getHardestClimb();
		},
		get surfaceMix() {
			return getSurfaceMix();
		},
		get activeWarnings() {
			return getActiveWarnings();
		},
		get activeReadinessWarnings() {
			return getActiveReadinessWarnings();
		},
		get activeProviderWarnings() {
			return getActiveProviderWarnings();
		},
		get primaryActiveWarning() {
			return getPrimaryActiveWarning();
		},
		get elevationSamples() {
			return getElevationSamples();
		},
		get chartH() {
			return getChartH();
		},
		get elevMin() {
			return getElevMin();
		},
		get elevMax() {
			return getElevMax();
		},
		get elevRange() {
			return getElevRange();
		},
		get sampledProfileDistanceTotal() {
			return getSampledProfileDistanceTotal();
		},
		get chartProfilePoints() {
			return getChartProfilePoints();
		},
		get activeProfilePoint() {
			return getActiveProfilePoint();
		},
		get highlightedRouteCoordinate() {
			return getHighlightedRouteCoordinate();
		},
		get linePoints() {
			return getLinePoints();
		},
		get areaD() {
			return getAreaD();
		},
		get distanceTickLabels() {
			return getDistanceTickLabels();
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
