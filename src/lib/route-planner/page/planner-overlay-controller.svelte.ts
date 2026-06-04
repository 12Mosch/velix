import { Option } from "effect";
import {
	buildLockedSegmentGeoJson,
	buildRouteAvoidanceGeoJson,
	buildSpatialConstraintGeoJson,
	getRouteSegmentCount,
	mergeRouteBounds,
	sanitizeLockedSegmentIndexes,
	type PlannedRoute,
	type ResolvedRouteAvoidance,
	type RouteClimb,
	type RouteMapOverlay,
} from "$lib/route-planning";
import { routeHasWindOverlayFeatures } from "$lib/route-planner/page/route-overlay-capabilities";
import {
	createPlannerOverlayCache,
	type PlannerOverlayCache,
} from "$lib/route-planner/page/planner-overlay-cache";

type PlannerOverlayControllerDependencies = {
	getActiveRoute: () => PlannedRoute | null;
	getRouteAlternatives: () => PlannedRoute[];
	getSelectedRouteIndex: () => number | null;
	getAvoidedRoads: () => ResolvedRouteAvoidance[];
	getLockedSegmentIndexes: () => number[];
	setLockedSegmentIndexes: (indexes: number[]) => void;
	syncActiveRouteManualEditing: (indexes: number[]) => void;
	getActiveRouteClimbs: () => RouteClimb[];
	getHighlightedRouteCoordinate: () =>
		| PlannedRoute["coordinates"][number]
		| null;
	cache?: PlannerOverlayCache;
};

export function createPlannerOverlayController(
	dependencies: PlannerOverlayControllerDependencies,
) {
	const cache = dependencies.cache ?? createPlannerOverlayCache();

	let gradientOverlayEnabled = $state(false);
	let windOverlayEnabled = $state(false);
	let trafficStressOverlayEnabled = $state(false);

	const activeRoute = $derived(dependencies.getActiveRoute());
	const routeAlternatives = $derived(dependencies.getRouteAlternatives());
	const selectedRouteIndex = $derived(dependencies.getSelectedRouteIndex());
	const activeRouteClimbs = $derived(dependencies.getActiveRouteClimbs());
	const avoidedRoads = $derived(dependencies.getAvoidedRoads());
	const lockedSegmentIndexes = $derived(dependencies.getLockedSegmentIndexes());

	const canShowGradientOverlay = $derived(
		activeRoute
			? cache.getCachedRouteGradientOverlayAvailable(activeRoute)
			: false,
	);
	const activeRouteGradientGeoJson = $derived(
		activeRoute && gradientOverlayEnabled && canShowGradientOverlay
			? cache.getCachedGradientRouteGeoJson(activeRoute)
			: null,
	);
	const canShowWindOverlay = $derived(
		activeRoute ? routeHasWindOverlayFeatures(activeRoute) : false,
	);
	const activeRouteWindGeoJson = $derived(
		activeRoute && windOverlayEnabled && canShowWindOverlay
			? cache.getCachedWindRouteGeoJson(activeRoute)
			: null,
	);
	const canShowTrafficStressOverlay = $derived(
		activeRoute
			? cache.getCachedRouteTrafficStressOverlayAvailable(activeRoute)
			: false,
	);
	const activeRouteTrafficStressGeoJson = $derived(
		activeRoute && trafficStressOverlayEnabled && canShowTrafficStressOverlay
			? cache.getCachedTrafficStressRouteGeoJson(activeRoute)
			: null,
	);
	const routeOverlays = $derived<RouteMapOverlay[]>(
		routeAlternatives.map((route, index) => {
			const isSelected = index === selectedRouteIndex;
			const baseGeoJson = cache.getCachedBaseRouteGeoJson(route);

			if (!isSelected) {
				return {
					id: `route-${index}`,
					geoJson: baseGeoJson,
					bounds: route.bounds,
					isSelected,
				};
			}

			const features = [...baseGeoJson.features];
			const surfaceGeoJson = cache.getCachedSurfaceRouteGeoJson(route);

			if (surfaceGeoJson.features.length > 0) {
				features.push(...surfaceGeoJson.features);
			}

			const climbGeoJson = cache.getCachedClimbRouteGeoJson(
				route,
				activeRouteClimbs,
			);

			if (climbGeoJson.features.length > 0) {
				features.push(...climbGeoJson.features);
			}

			if (gradientOverlayEnabled && activeRouteGradientGeoJson) {
				features.push(...activeRouteGradientGeoJson.features);
			}

			if (windOverlayEnabled && activeRouteWindGeoJson) {
				features.push(...activeRouteWindGeoJson.features);
			}

			if (trafficStressOverlayEnabled && activeRouteTrafficStressGeoJson) {
				features.push(...activeRouteTrafficStressGeoJson.features);
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
	const combinedRouteBounds = $derived(
		Option.getOrElse(mergeRouteBounds(routeAlternatives), () => null),
	);
	const highlightedRouteCoordinate = $derived(
		dependencies.getHighlightedRouteCoordinate(),
	);

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
		if (trafficStressOverlayEnabled && !canShowTrafficStressOverlay) {
			trafficStressOverlayEnabled = false;
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
			if (activeRoute) {
				dependencies.setLockedSegmentIndexes(nextLockedSegmentIndexes);
			}
		}

		dependencies.syncActiveRouteManualEditing(nextLockedSegmentIndexes);
	});

	return {
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
		get trafficStressOverlayEnabled() {
			return trafficStressOverlayEnabled;
		},
		set trafficStressOverlayEnabled(value) {
			trafficStressOverlayEnabled = value;
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
		get activeRouteTrafficStressGeoJson() {
			return activeRouteTrafficStressGeoJson;
		},
		get canShowTrafficStressOverlay() {
			return canShowTrafficStressOverlay;
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
		get highlightedRouteCoordinate() {
			return highlightedRouteCoordinate;
		},
	};
}

export type PlannerOverlayController = ReturnType<
	typeof createPlannerOverlayController
>;
