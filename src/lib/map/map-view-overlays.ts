import type { FeatureCollection } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";

import type { RouteCoordinate, RouteMapOverlay } from "$lib/route-planning";
import {
	removeConstraintOverlay as removeRenderedConstraintOverlay,
	removeCurrentLocationOverlay as removeRenderedCurrentLocationOverlay,
	removeHoveredRouteOverlay as removeRenderedHoveredRouteOverlay,
	removeLockedSegmentOverlay as removeRenderedLockedSegmentOverlay,
	removeRouteAvoidanceOverlay as removeRenderedRouteAvoidanceOverlay,
	removeRouteOverlays as removeRenderedRouteOverlays,
	syncConstraintOverlay,
	syncCurrentLocationOverlay,
	syncHoveredRouteOverlay,
	syncLockedSegmentOverlay,
	syncRouteAvoidanceOverlay,
	syncRouteOverlays,
} from "$lib/map/map-view-renderer";

type CurrentLocationOverlay = {
	point: [number, number];
	accuracyMeters?: number;
} | null;

export function createMapViewOverlayController({
	getMap,
	getIsStyleReady,
	clearProjectionCache,
}: {
	getMap: () => MapLibreMap | null;
	getIsStyleReady: () => boolean;
	clearProjectionCache: () => void;
}) {
	let renderedRouteOverlayIds: string[] = [];
	const renderedRouteOverlayGeoJsonRefs = new Map<string, FeatureCollection>();

	function removeRouteOverlays() {
		const map = getMap();

		if (map && getIsStyleReady()) {
			removeRenderedRouteOverlays(map, renderedRouteOverlayIds);
		}

		renderedRouteOverlayIds = [];
		renderedRouteOverlayGeoJsonRefs.clear();
		clearProjectionCache();
	}

	function ensureRouteOverlays(routeOverlays: RouteMapOverlay[] | null) {
		const map = getMap();

		if (!map || !getIsStyleReady()) {
			return;
		}

		renderedRouteOverlayIds = syncRouteOverlays(
			map,
			routeOverlays,
			renderedRouteOverlayIds,
			renderedRouteOverlayGeoJsonRefs,
		);
		clearProjectionCache();
	}

	function removeConstraintOverlay() {
		const map = getMap();

		if (map && getIsStyleReady()) {
			removeRenderedConstraintOverlay(map);
		}
	}

	function ensureConstraintOverlay(
		constraintOverlay: FeatureCollection | null,
	) {
		const map = getMap();

		if (map && getIsStyleReady()) {
			syncConstraintOverlay(map, constraintOverlay);
		}
	}

	function removeRouteAvoidanceOverlay() {
		const map = getMap();

		if (map && getIsStyleReady()) {
			removeRenderedRouteAvoidanceOverlay(map);
		}
	}

	function ensureRouteAvoidanceOverlay(
		avoidanceOverlay: FeatureCollection | null,
	) {
		const map = getMap();

		if (map && getIsStyleReady()) {
			syncRouteAvoidanceOverlay(map, avoidanceOverlay);
		}
	}

	function removeLockedSegmentOverlay() {
		const map = getMap();

		if (map && getIsStyleReady()) {
			removeRenderedLockedSegmentOverlay(map);
		}
	}

	function ensureLockedSegmentOverlay(
		lockedSegmentOverlay: FeatureCollection | null,
	) {
		const map = getMap();

		if (map && getIsStyleReady()) {
			syncLockedSegmentOverlay(map, lockedSegmentOverlay);
		}
	}

	function removeHoveredRouteOverlay() {
		const map = getMap();

		if (map && getIsStyleReady()) {
			removeRenderedHoveredRouteOverlay(map);
		}
	}

	function ensureHoveredRouteOverlay(
		hoveredRouteCoordinate: RouteCoordinate | null,
	) {
		const map = getMap();

		if (map && getIsStyleReady()) {
			syncHoveredRouteOverlay(map, hoveredRouteCoordinate);
		}
	}

	function removeCurrentLocationOverlay() {
		const map = getMap();

		if (map && getIsStyleReady()) {
			removeRenderedCurrentLocationOverlay(map);
		}
	}

	function ensureCurrentLocationOverlay(
		currentLocation: CurrentLocationOverlay,
	) {
		const map = getMap();

		if (map && getIsStyleReady()) {
			syncCurrentLocationOverlay(map, currentLocation);
		}
	}

	return {
		ensureConstraintOverlay,
		ensureCurrentLocationOverlay,
		ensureHoveredRouteOverlay,
		ensureLockedSegmentOverlay,
		ensureRouteAvoidanceOverlay,
		ensureRouteOverlays,
		removeConstraintOverlay,
		removeCurrentLocationOverlay,
		removeHoveredRouteOverlay,
		removeLockedSegmentOverlay,
		removeRouteAvoidanceOverlay,
		removeRouteOverlays,
	};
}
