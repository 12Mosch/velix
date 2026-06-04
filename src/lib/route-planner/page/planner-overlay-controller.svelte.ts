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
import { createMemoizedSelector } from "$lib/route-planner/page/planner-selector-memo";

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

	function getActiveRoute() {
		return dependencies.getActiveRoute();
	}

	function getRouteAlternatives() {
		return dependencies.getRouteAlternatives();
	}

	function getSelectedRouteIndex() {
		return dependencies.getSelectedRouteIndex();
	}

	function getActiveRouteClimbs() {
		return dependencies.getActiveRouteClimbs();
	}

	function getAvoidedRoads() {
		return dependencies.getAvoidedRoads();
	}

	function getLockedSegmentIndexes() {
		return dependencies.getLockedSegmentIndexes();
	}

	function getCanShowGradientOverlay() {
		const activeRoute = getActiveRoute();
		return activeRoute
			? cache.getCachedRouteGradientOverlayAvailable(activeRoute)
			: false;
	}

	const selectActiveRouteGradientGeoJson = createMemoizedSelector(
		(
			activeRoute: PlannedRoute | null,
			enabled: boolean,
			canShowGradientOverlay: boolean,
		) =>
			activeRoute && enabled && canShowGradientOverlay
				? cache.getCachedGradientRouteGeoJson(activeRoute)
				: null,
	);

	function getActiveRouteGradientGeoJson() {
		return selectActiveRouteGradientGeoJson(
			getActiveRoute(),
			gradientOverlayEnabled,
			getCanShowGradientOverlay(),
		);
	}

	function getCanShowWindOverlay() {
		const activeRoute = getActiveRoute();
		return activeRoute ? routeHasWindOverlayFeatures(activeRoute) : false;
	}

	const selectActiveRouteWindGeoJson = createMemoizedSelector(
		(
			activeRoute: PlannedRoute | null,
			enabled: boolean,
			canShowWindOverlay: boolean,
		) =>
			activeRoute && enabled && canShowWindOverlay
				? cache.getCachedWindRouteGeoJson(activeRoute)
				: null,
	);

	function getActiveRouteWindGeoJson() {
		return selectActiveRouteWindGeoJson(
			getActiveRoute(),
			windOverlayEnabled,
			getCanShowWindOverlay(),
		);
	}

	function getCanShowTrafficStressOverlay() {
		const activeRoute = getActiveRoute();
		return activeRoute
			? cache.getCachedRouteTrafficStressOverlayAvailable(activeRoute)
			: false;
	}

	const selectActiveRouteTrafficStressGeoJson = createMemoizedSelector(
		(
			activeRoute: PlannedRoute | null,
			enabled: boolean,
			canShowTrafficStressOverlay: boolean,
		) =>
			activeRoute && enabled && canShowTrafficStressOverlay
				? cache.getCachedTrafficStressRouteGeoJson(activeRoute)
				: null,
	);

	function getActiveRouteTrafficStressGeoJson() {
		return selectActiveRouteTrafficStressGeoJson(
			getActiveRoute(),
			trafficStressOverlayEnabled,
			getCanShowTrafficStressOverlay(),
		);
	}

	const selectRouteOverlays = createMemoizedSelector(
		(
			routeAlternatives: PlannedRoute[],
			selectedRouteIndex: number | null,
			activeRouteClimbs: RouteClimb[],
			activeRouteGradientGeoJson: ReturnType<
				typeof getActiveRouteGradientGeoJson
			>,
			activeRouteWindGeoJson: ReturnType<typeof getActiveRouteWindGeoJson>,
			activeRouteTrafficStressGeoJson: ReturnType<
				typeof getActiveRouteTrafficStressGeoJson
			>,
		): RouteMapOverlay[] =>
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

				if (activeRouteGradientGeoJson) {
					features.push(...activeRouteGradientGeoJson.features);
				}

				if (activeRouteWindGeoJson) {
					features.push(...activeRouteWindGeoJson.features);
				}

				if (activeRouteTrafficStressGeoJson) {
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

	function getRouteOverlays() {
		return selectRouteOverlays(
			getRouteAlternatives(),
			getSelectedRouteIndex(),
			getActiveRouteClimbs(),
			getActiveRouteGradientGeoJson(),
			getActiveRouteWindGeoJson(),
			getActiveRouteTrafficStressGeoJson(),
		);
	}

	const selectConstraintOverlay = createMemoizedSelector(
		(activeRoute: PlannedRoute | null) =>
			activeRoute?.spatialConstraint
				? buildSpatialConstraintGeoJson(activeRoute.spatialConstraint)
				: null,
	);

	function getConstraintOverlay() {
		return selectConstraintOverlay(getActiveRoute());
	}

	const selectAvoidanceOverlay = createMemoizedSelector(
		(avoidedRoads: ResolvedRouteAvoidance[]) =>
			avoidedRoads.length > 0 ? buildRouteAvoidanceGeoJson(avoidedRoads) : null,
	);

	function getAvoidanceOverlay() {
		return selectAvoidanceOverlay(getAvoidedRoads());
	}

	function getActiveRouteSegmentCount() {
		const activeRoute = getActiveRoute();
		return activeRoute ? getRouteSegmentCount(activeRoute) : 0;
	}

	const selectSanitizedLockedSegmentIndexes = createMemoizedSelector(
		(lockedSegmentIndexes: number[], activeRouteSegmentCount: number) =>
			sanitizeLockedSegmentIndexes(
				lockedSegmentIndexes,
				activeRouteSegmentCount,
			),
	);

	function getSanitizedLockedSegmentIndexes() {
		return selectSanitizedLockedSegmentIndexes(
			getLockedSegmentIndexes(),
			getActiveRouteSegmentCount(),
		);
	}

	const selectLockedSegmentOverlay = createMemoizedSelector(
		(
			activeRoute: PlannedRoute | null,
			sanitizedLockedSegmentIndexes: number[],
		) =>
			activeRoute && sanitizedLockedSegmentIndexes.length > 0
				? buildLockedSegmentGeoJson(activeRoute, sanitizedLockedSegmentIndexes)
				: null,
	);

	function getLockedSegmentOverlay() {
		return selectLockedSegmentOverlay(
			getActiveRoute(),
			getSanitizedLockedSegmentIndexes(),
		);
	}

	const selectCombinedRouteBounds = createMemoizedSelector(
		(routeAlternatives: PlannedRoute[]) =>
			Option.getOrElse(mergeRouteBounds(routeAlternatives), () => null),
	);

	function getCombinedRouteBounds() {
		return selectCombinedRouteBounds(getRouteAlternatives());
	}

	function getHighlightedRouteCoordinate() {
		return dependencies.getHighlightedRouteCoordinate();
	}

	$effect(() => {
		if (gradientOverlayEnabled && !getCanShowGradientOverlay()) {
			gradientOverlayEnabled = false;
		}
	});

	$effect(() => {
		if (windOverlayEnabled && !getCanShowWindOverlay()) {
			windOverlayEnabled = false;
		}
	});

	$effect(() => {
		if (trafficStressOverlayEnabled && !getCanShowTrafficStressOverlay()) {
			trafficStressOverlayEnabled = false;
		}
	});

	$effect(() => {
		const nextLockedSegmentIndexes = getSanitizedLockedSegmentIndexes();
		const lockedSegmentIndexes = getLockedSegmentIndexes();

		if (
			nextLockedSegmentIndexes.length !== lockedSegmentIndexes.length ||
			nextLockedSegmentIndexes.some(
				(index, itemIndex) => index !== lockedSegmentIndexes[itemIndex],
			)
		) {
			if (getActiveRoute()) {
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
			return getActiveRouteGradientGeoJson();
		},
		get canShowGradientOverlay() {
			return getCanShowGradientOverlay();
		},
		get activeRouteWindGeoJson() {
			return getActiveRouteWindGeoJson();
		},
		get canShowWindOverlay() {
			return getCanShowWindOverlay();
		},
		get activeRouteTrafficStressGeoJson() {
			return getActiveRouteTrafficStressGeoJson();
		},
		get canShowTrafficStressOverlay() {
			return getCanShowTrafficStressOverlay();
		},
		get routeOverlays() {
			return getRouteOverlays();
		},
		get constraintOverlay() {
			return getConstraintOverlay();
		},
		get avoidanceOverlay() {
			return getAvoidanceOverlay();
		},
		get activeRouteSegmentCount() {
			return getActiveRouteSegmentCount();
		},
		get sanitizedLockedSegmentIndexes() {
			return getSanitizedLockedSegmentIndexes();
		},
		get lockedSegmentOverlay() {
			return getLockedSegmentOverlay();
		},
		get combinedRouteBounds() {
			return getCombinedRouteBounds();
		},
		get highlightedRouteCoordinate() {
			return getHighlightedRouteCoordinate();
		},
	};
}

export type PlannerOverlayController = ReturnType<
	typeof createPlannerOverlayController
>;
