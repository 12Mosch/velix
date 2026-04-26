<script lang="ts">
	import { onMount } from "svelte";
	import type { FeatureCollection } from "geojson";
	import type {
		ControlPosition,
		GeoJSONSource,
		IControl,
		LngLatBoundsLike,
		Map as MapLibreMap,
		MapOptions,
		ScaleControlOptions,
	} from "maplibre-gl";

	import {
		initMapStylePreference,
		mapStylePreference,
		syncSelectedBasemap,
	} from "$lib/map-style-settings.svelte";
	import {
		getMapLibreScaleUnit,
		initUnitPreference,
		unitPreference,
	} from "$lib/unit-settings.svelte";
	import { getBasemapStyleUrl } from "$lib/map/basemaps";
	import type { SidebarLayoutState } from "$lib/components/ui/sidebar/context.svelte.js";
	import type {
		PlannedRoute,
		RouteBounds,
		RouteCoordinate,
		RouteMapOverlay,
		RouteMode,
	} from "$lib/route-planning";
	import { getRouteLegIndexForCoordinateSegment } from "$lib/route-planning";

	type SelectedRouteStop =
		| {
				kind: "start" | "destination";
				label?: string;
		  }
		| {
				kind: "waypoint";
				label?: string;
				index: number;
		  };
	type RouteDragDetail = {
		point: [number, number];
		screenPoint: {
			x: number;
			y: number;
		};
	};
	type RouteStopDragEndDetail = RouteDragDetail & {
		selectedStop: SelectedRouteStop;
		stopIndex: number;
	};
	type RouteSegmentDetail = RouteDragDetail & {
		coordinateSegmentIndex: number;
		segmentIndex: number;
	};

	type Props = {
		initialCenter?: [number, number];
		initialZoom?: number;
		ariaLabel?: string;
		routeOverlays?: RouteMapOverlay[] | null;
		plannedRoute?: PlannedRoute | null;
		routeMode?: RouteMode | null;
		manualEditingEnabled?: boolean;
		lockedSegmentOverlay?: FeatureCollection | null;
		lockedSegmentIndexes?: number[];
		constraintOverlay?: FeatureCollection | null;
		fitBounds?: RouteBounds | null;
		hoveredRouteCoordinate?: RouteCoordinate | null;
		currentLocation?: {
			point: [number, number];
			accuracyMeters?: number;
		} | null;
		currentLocationFocusKey?: number;
		layoutState?: SidebarLayoutState | null;
		onMapClick?: ((detail: {
			point: [number, number];
			screenPoint: {
				x: number;
				y: number;
			};
			selectedStop?: SelectedRouteStop;
			selectedSegment?: {
				coordinateSegmentIndex: number;
				segmentIndex: number;
			};
		}) => void) | null;
		onRouteStopDragEnd?: ((detail: RouteStopDragEndDetail) => void) | null;
		onRouteSegmentDragEnd?: ((detail: RouteSegmentDetail) => void) | null;
		onRouteSegmentSelection?: ((detail: RouteSegmentDetail) => void) | null;
	};

	const defaultCenter = [11.394, 47.268] as [number, number];
	const routeSourcePrefix = "planned-route";
	const routeSegmentSelectionThresholdPx = 18;
	const routeSegmentNearHitThresholdPx = 1;
	const constraintSourceId = "route-constraint";
	const constraintFillLayerId = "route-constraint-fill";
	const constraintLineLayerId = "route-constraint-line";
	const lockedSegmentSourceId = "route-locked-segments";
	const lockedSegmentCasingLayerId = "route-locked-segments-casing";
	const lockedSegmentLineLayerId = "route-locked-segments-line";
	const hoveredRouteSourceId = "planned-route-hover";
	const hoveredRouteLayerId = "planned-route-hover-point";
	const currentLocationSourceId = "current-location";
	const currentLocationAccuracyLayerId = "current-location-accuracy";
	const currentLocationPointLayerId = "current-location-point";
	const alternativeRoutePalette = [
		"rgba(15, 23, 42, 0.34)",
		"rgba(71, 85, 105, 0.34)",
		"rgba(100, 116, 139, 0.34)",
	] as const;
	// Matches the 200ms sidebar width transition plus a small buffer for interrupted toggles.
	const layoutTransitionBufferMs = 260;
	const scaleControlPosition: ControlPosition = "bottom-left";

	let {
		initialCenter = defaultCenter,
		initialZoom = 10,
		ariaLabel = "Route map",
		routeOverlays = null,
		plannedRoute = null,
		routeMode = null,
		manualEditingEnabled = false,
		lockedSegmentOverlay = null,
		lockedSegmentIndexes = [],
		constraintOverlay = null,
		fitBounds = null,
		hoveredRouteCoordinate = null,
		currentLocation = null,
		currentLocationFocusKey = 0,
		layoutState = null,
		onMapClick = null,
		onRouteStopDragEnd = null,
		onRouteSegmentDragEnd = null,
		onRouteSegmentSelection = null,
	}: Props = $props();

	let mapContainer = $state<HTMLDivElement | null>(null);
	let map = $state<MapLibreMap | null>(null);
	let maplibreglModule = $state<typeof import("maplibre-gl") | null>(null);
	let scaleControl = $state<IControl | null>(null);
	let currentScaleControlUnit: "metric" | "imperial" | null = null;
	let isLoaded = $state(false);
	let isStyleReady = $state(false);
	let loadError = $state<string | null>(null);
	let lastFittedBoundsKey: string | null = null;
	let currentStyleUrl: string | null = null;
	let detachStyleLoadListener = () => {};
	let detachMapClickListener = () => {};
	let detachRouteEditingListeners = () => {};
	let resizeAnimationFrameId: number | null = null;
	let resizeLoopUntil = 0;
	let renderedRouteOverlayIds: string[] = [];
	let lastFocusedCurrentLocationKey: number | null = null;
	let activeRouteDrag:
		| {
				kind: "stop";
				selectedStop: SelectedRouteStop;
				stopIndex: number;
				startPoint: [number, number];
		  }
		| {
				kind: "segment";
				coordinateSegmentIndex: number;
				segmentIndex: number;
				startPoint: [number, number];
		  }
		| null = null;
	let dragPanWasEnabled = false;
	let suppressNextMapClick = false;
	let routeProjectionCache:
		| {
				coordinates: RouteCoordinate[];
				points: Array<{ x: number; y: number } | null>;
		  }
		| null = null;

	function getMapEventDetail(event: {
		lngLat?: { lng?: number; lat?: number };
		point?: { x?: number; y?: number };
	}) {
		const longitude = event.lngLat?.lng;
		const latitude = event.lngLat?.lat;
		const clickX = event.point?.x;
		const clickY = event.point?.y;

		if (
			typeof longitude !== "number" ||
			typeof latitude !== "number" ||
			typeof clickX !== "number" ||
			typeof clickY !== "number"
		) {
			return null;
		}

		return {
			point: [longitude, latitude] as [number, number],
			screenPoint: {
				x: clickX,
				y: clickY,
			},
		};
	}

	function setMapCursor(cursor: string) {
		if (mapContainer) {
			mapContainer.style.cursor = cursor;
		}
	}

	function disableMapDragPan() {
		const dragPan = (
			map as
				| (MapLibreMap & {
						dragPan?: {
							isEnabled?: () => boolean;
							disable?: () => void;
							enable?: () => void;
						};
				  })
				| null
		)?.dragPan;

		dragPanWasEnabled = dragPan?.isEnabled?.() ?? false;
		dragPan?.disable?.();
	}

	function restoreMapDragPan() {
		const dragPan = (
			map as
				| (MapLibreMap & {
						dragPan?: {
							enable?: () => void;
						};
				  })
				| null
		)?.dragPan;

		if (dragPanWasEnabled) {
			dragPan?.enable?.();
		}

		dragPanWasEnabled = false;
	}

	function finishRouteDrag(
		event: {
			lngLat?: { lng?: number; lat?: number };
			point?: { x?: number; y?: number };
		},
	) {
		if (!activeRouteDrag) {
			return;
		}

		const drag = activeRouteDrag;
		const detail = getMapEventDetail(event);
		activeRouteDrag = null;
		routeProjectionCache = null;
		restoreMapDragPan();
		setMapCursor("");

		if (!detail) {
			return;
		}

		suppressNextMapClick =
			drag.startPoint[0] !== detail.point[0] ||
			drag.startPoint[1] !== detail.point[1];

		if (!suppressNextMapClick) {
			return;
		}

		if (drag.kind === "stop") {
			onRouteStopDragEnd?.({
				...detail,
				selectedStop: drag.selectedStop,
				stopIndex: drag.stopIndex,
			});
			return;
		}

		onRouteSegmentDragEnd?.({
			...detail,
			coordinateSegmentIndex: drag.coordinateSegmentIndex,
			segmentIndex: drag.segmentIndex,
		});
	}

	function clearStaleClickSuppression() {
		suppressNextMapClick = false;
	}

	function getRouteSourceId(overlayId: string) {
		return `${routeSourcePrefix}-${overlayId}`;
	}

	function getRouteLineLayerId(overlayId: string) {
		return `${getRouteSourceId(overlayId)}-line`;
	}

	function getRouteCasingLayerId(overlayId: string) {
		return `${getRouteSourceId(overlayId)}-casing`;
	}

	function getRouteStartLayerId(overlayId: string) {
		return `${getRouteSourceId(overlayId)}-start`;
	}

	function getRouteWaypointLayerId(overlayId: string) {
		return `${getRouteSourceId(overlayId)}-waypoint`;
	}

	function getRouteDestinationLayerId(overlayId: string) {
		return `${getRouteSourceId(overlayId)}-destination`;
	}

	function getSelectedOverlay() {
		if (!routeOverlays || routeOverlays.length === 0) {
			return null;
		}

		return routeOverlays.find((overlay) => overlay.isSelected) ?? routeOverlays[0];
	}

	function getSelectedStopAtPoint(screenPoint: { x: number; y: number }) {
		if (!map || typeof map.queryRenderedFeatures !== "function") {
			return undefined;
		}

		const selectedOverlay = getSelectedOverlay();

		if (!selectedOverlay) {
			return undefined;
		}

		const matchingFeature = map
			.queryRenderedFeatures([screenPoint.x, screenPoint.y], {
				layers: [
					getRouteStartLayerId(selectedOverlay.id),
					getRouteWaypointLayerId(selectedOverlay.id),
					getRouteDestinationLayerId(selectedOverlay.id),
				],
			})
			.find((feature) => {
				const kind = feature.properties?.kind;
				return (
					kind === "start" || kind === "waypoint" || kind === "destination"
				);
			});

		if (!matchingFeature) {
			return undefined;
		}

		const kind = matchingFeature?.properties?.kind;

		if (kind === "start" || kind === "destination") {
			return {
				kind,
				label:
					typeof matchingFeature.properties?.label === "string"
						? matchingFeature.properties.label
						: undefined,
			};
		}

		if (kind === "waypoint") {
			const order = Number(matchingFeature.properties?.order);

			if (!Number.isFinite(order) || order < 1) {
				return undefined;
			}

			return {
				kind,
				label:
					typeof matchingFeature.properties?.label === "string"
						? matchingFeature.properties.label
						: undefined,
				index: order - 1,
			};
		}

		return undefined;
	}

	function getSelectedRouteCoordinates(): RouteCoordinate[] {
		const selectedOverlay = getSelectedOverlay();
		const routeFeature = selectedOverlay?.geoJson.features.find(
			(feature) => feature.properties?.kind === "route",
		);

		if (routeFeature?.geometry.type !== "LineString") {
			return [];
		}

		return routeFeature.geometry.coordinates as RouteCoordinate[];
	}

	function getSelectedRouteWaypointCount() {
		const selectedOverlay = getSelectedOverlay();

		return (
			selectedOverlay?.geoJson.features.filter(
				(feature) => feature.properties?.kind === "waypoint",
			).length ?? 0
		);
	}

	function getSelectedRouteHasDestination() {
		const selectedOverlay = getSelectedOverlay();

		return !!selectedOverlay?.geoJson.features.some(
			(feature) => feature.properties?.kind === "destination",
		);
	}

	function getSelectedRouteSegmentCount() {
		const waypointCount = getSelectedRouteWaypointCount();

		if (routeMode === "round_course") {
			return Math.max(1, waypointCount + 1);
		}

		return getSelectedRouteHasDestination() ? waypointCount + 1 : waypointCount;
	}

	function getStopIndex(selectedStop: SelectedRouteStop): number {
		if (selectedStop.kind === "start") {
			return 0;
		}

		if (selectedStop.kind === "waypoint") {
			return selectedStop.index + 1;
		}

		return getSelectedRouteWaypointCount() + 1;
	}

	function isSegmentLocked(segmentIndex: number) {
		return lockedSegmentIndexes.includes(segmentIndex);
	}

	function isStopLocked(stopIndex: number) {
		const segmentCount = getSelectedRouteSegmentCount();

		if (segmentCount <= 0) {
			return false;
		}

		if (
			lockedSegmentIndexes.includes(stopIndex) ||
			lockedSegmentIndexes.includes(stopIndex - 1)
		) {
			return true;
		}

		return (
			routeMode === "round_course" &&
			stopIndex === 0 &&
			lockedSegmentIndexes.includes(segmentCount - 1)
		);
	}

	function getProjectedPoint(coordinate: RouteCoordinate) {
		const projected = (
			map as
				| (MapLibreMap & {
						project?: (
							coordinate: [number, number],
						) => { x: number; y: number } | null;
				  })
				| null
		)?.project?.([coordinate[0], coordinate[1]]);

		if (!projected) {
			return null;
		}

		return {
			x: projected.x,
			y: projected.y,
		};
	}

	function prepareSelectedRouteProjectionCache() {
		const coordinates = getSelectedRouteCoordinates();

		routeProjectionCache = {
			coordinates,
			points: coordinates.map((coordinate) => getProjectedPoint(coordinate)),
		};

		return routeProjectionCache;
	}

	function getPointToScreenSegmentDistance(
		point: { x: number; y: number },
		segmentStart: { x: number; y: number },
		segmentEnd: { x: number; y: number },
	) {
		const deltaX = segmentEnd.x - segmentStart.x;
		const deltaY = segmentEnd.y - segmentStart.y;
		const segmentLengthSquared = deltaX ** 2 + deltaY ** 2;

		if (segmentLengthSquared === 0) {
			return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y);
		}

		const projection =
			((point.x - segmentStart.x) * deltaX +
				(point.y - segmentStart.y) * deltaY) /
			segmentLengthSquared;
		const clampedProjection = Math.min(1, Math.max(0, projection));
		const closestX = segmentStart.x + deltaX * clampedProjection;
		const closestY = segmentStart.y + deltaY * clampedProjection;

		return Math.hypot(point.x - closestX, point.y - closestY);
	}

	function getSelectedSegmentAtPoint(screenPoint: { x: number; y: number }) {
		const coordinates = getSelectedRouteCoordinates();

		if (!map || coordinates.length < 2) {
			return undefined;
		}

		const projectionCache =
			routeProjectionCache?.coordinates === coordinates
				? routeProjectionCache
				: null;
		let bestCoordinateSegmentIndex = -1;
		let bestDistance = Number.POSITIVE_INFINITY;

		for (let index = 0; index < coordinates.length - 1; index += 1) {
			const from = coordinates[index];
			const to = coordinates[index + 1];

			if (!from || !to) {
				continue;
			}

			const cachedFromPoint = projectionCache?.points[index] ?? null;
			const cachedToPoint = projectionCache?.points[index + 1] ?? null;
			const fromPoint = cachedFromPoint ?? getProjectedPoint(from);
			const toPoint = cachedToPoint ?? getProjectedPoint(to);

			if (!fromPoint || !toPoint) {
				continue;
			}

			const distance = getPointToScreenSegmentDistance(
				screenPoint,
				fromPoint,
				toPoint,
			);

			if (distance < bestDistance) {
				bestDistance = distance;
				bestCoordinateSegmentIndex = index;
			}

			if (distance < routeSegmentNearHitThresholdPx) {
				break;
			}
		}

		if (
			bestCoordinateSegmentIndex < 0 ||
			bestDistance > routeSegmentSelectionThresholdPx
		) {
			return undefined;
		}

		return {
			coordinateSegmentIndex: bestCoordinateSegmentIndex,
			segmentIndex: getEditableSegmentIndexForCoordinateSegment(
				bestCoordinateSegmentIndex,
			),
		};
	}

	function getEditableSegmentIndexForCoordinateSegment(
		coordinateSegmentIndex: number,
	) {
		const coordinates = getSelectedRouteCoordinates();
		const segmentCount = getSelectedRouteSegmentCount();
		const plannedRouteLegIndex = plannedRoute
			? getRouteLegIndexForCoordinateSegment(
					plannedRoute,
					coordinateSegmentIndex,
				)
			: null;

		if (plannedRouteLegIndex !== null) {
			return plannedRouteLegIndex;
		}

		if (segmentCount <= 1 || coordinates.length < 2) {
			return 0;
		}

		return Math.min(
			segmentCount - 1,
			Math.max(
				0,
				Math.floor(
					(coordinateSegmentIndex / Math.max(coordinates.length - 1, 1)) *
						segmentCount,
				),
			),
		);
	}

	function cancelSmoothResize() {
		resizeLoopUntil = 0;

		if (resizeAnimationFrameId === null || typeof window === "undefined") {
			return;
		}

		window.cancelAnimationFrame(resizeAnimationFrameId);
		resizeAnimationFrameId = null;
	}

	function resizeMap() {
		map?.resize();
	}

	function repaintMap() {
		map?.triggerRepaint?.();
	}

	function removeScaleControl() {
		if (map && scaleControl) {
			map.removeControl(scaleControl);
		}

		scaleControl = null;
		currentScaleControlUnit = null;
	}

	function syncScaleControl() {
		if (!map || !maplibreglModule) {
			return;
		}

		const nextScaleControlUnit = getMapLibreScaleUnit();
		if (scaleControl && currentScaleControlUnit === nextScaleControlUnit) {
			return;
		}

		removeScaleControl();
		scaleControl = new maplibreglModule.ScaleControl({
			maxWidth: 96,
			unit: nextScaleControlUnit,
		} satisfies ScaleControlOptions);
		currentScaleControlUnit = nextScaleControlUnit;
		map.addControl(scaleControl, scaleControlPosition);
	}

	function syncMapFrame() {
		resizeMap();
		repaintMap();
	}

	function keepMapResized() {
		if (typeof window === "undefined") {
			return;
		}

		syncMapFrame();

		if (resizeLoopUntil <= window.performance.now()) {
			resizeLoopUntil = 0;
			resizeAnimationFrameId = null;
			return;
		}

		resizeAnimationFrameId = window.requestAnimationFrame(() => {
			keepMapResized();
		});
	}

	function scheduleSmoothResize(durationMs = layoutTransitionBufferMs) {
		if (!map || typeof window === "undefined") {
			return;
		}

		const nextDeadline = window.performance.now() + durationMs;

		if (nextDeadline <= resizeLoopUntil) {
			return;
		}

		resizeLoopUntil = nextDeadline;

		if (resizeAnimationFrameId !== null) {
			return;
		}

		keepMapResized();
	}

	function getHoveredRouteSource() {
		return map?.getSource(hoveredRouteSourceId) as GeoJSONSource | undefined;
	}

	function getCurrentLocationSource() {
		return map?.getSource(currentLocationSourceId) as GeoJSONSource | undefined;
	}

	function getConstraintSource() {
		return map?.getSource(constraintSourceId) as GeoJSONSource | undefined;
	}

	function getLockedSegmentSource() {
		return map?.getSource(lockedSegmentSourceId) as GeoJSONSource | undefined;
	}

	function removeRouteOverlayById(overlayId: string) {
		if (!map || !isStyleReady) {
			return;
		}

		for (const layerId of [
			getRouteDestinationLayerId(overlayId),
			getRouteWaypointLayerId(overlayId),
			getRouteStartLayerId(overlayId),
			getRouteLineLayerId(overlayId),
			getRouteCasingLayerId(overlayId),
		]) {
			if (map.getLayer(layerId)) {
				map.removeLayer(layerId);
			}
		}

		const sourceId = getRouteSourceId(overlayId);

		if (map.getSource(sourceId)) {
			map.removeSource(sourceId);
		}
	}

	function removeRouteOverlays() {
		for (const overlayId of renderedRouteOverlayIds) {
			removeRouteOverlayById(overlayId);
		}

		renderedRouteOverlayIds = [];
	}

	function removeConstraintOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		for (const layerId of [constraintLineLayerId, constraintFillLayerId]) {
			if (map.getLayer(layerId)) {
				map.removeLayer(layerId);
			}
		}

		if (map.getSource(constraintSourceId)) {
			map.removeSource(constraintSourceId);
		}
	}

	function removeLockedSegmentOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		for (const layerId of [
			lockedSegmentLineLayerId,
			lockedSegmentCasingLayerId,
		]) {
			if (map.getLayer(layerId)) {
				map.removeLayer(layerId);
			}
		}

		if (map.getSource(lockedSegmentSourceId)) {
			map.removeSource(lockedSegmentSourceId);
		}
	}

	function removeHoveredRouteOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		if (map.getLayer(hoveredRouteLayerId)) {
			map.removeLayer(hoveredRouteLayerId);
		}

		if (map.getSource(hoveredRouteSourceId)) {
			map.removeSource(hoveredRouteSourceId);
		}
	}

	function removeCurrentLocationOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		for (const layerId of [
			currentLocationPointLayerId,
			currentLocationAccuracyLayerId,
		]) {
			if (map.getLayer(layerId)) {
				map.removeLayer(layerId);
			}
		}

		if (map.getSource(currentLocationSourceId)) {
			map.removeSource(currentLocationSourceId);
		}
	}

	function ensureRouteOverlays() {
		if (!map || !isStyleReady) {
			return;
		}

		if (!routeOverlays || routeOverlays.length === 0) {
			removeRouteOverlays();
			return;
		}

		removeRouteOverlays();

		for (const [index, overlay] of routeOverlays.entries()) {
			const sourceId = getRouteSourceId(overlay.id);
			const casingLayerId = getRouteCasingLayerId(overlay.id);
			const lineLayerId = getRouteLineLayerId(overlay.id);
			const startLayerId = getRouteStartLayerId(overlay.id);
			const waypointLayerId = getRouteWaypointLayerId(overlay.id);
			const destinationLayerId = getRouteDestinationLayerId(overlay.id);
			const alternativeColor =
				alternativeRoutePalette[index % alternativeRoutePalette.length];

			map.addSource(sourceId, {
				type: "geojson",
				data: overlay.geoJson,
			});

			map.addLayer({
				id: casingLayerId,
				type: "line",
				source: sourceId,
				filter: ["==", ["get", "kind"], "route"],
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: overlay.isSelected
					? {
							"line-color": "rgba(255, 255, 255, 0.88)",
							"line-width": [
								"interpolate",
								["linear"],
								["zoom"],
								6,
								5,
								12,
								8,
								16,
								11,
							],
							"line-opacity": 0.95,
						}
					: {
							"line-color": "rgba(255, 255, 255, 0.32)",
							"line-width": [
								"interpolate",
								["linear"],
								["zoom"],
								6,
								2.5,
								12,
								4,
								16,
								5.5,
							],
							"line-opacity": 0.55,
						},
			});
			map.addLayer({
				id: lineLayerId,
				type: "line",
				source: sourceId,
				filter: ["==", ["get", "kind"], "route"],
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: overlay.isSelected
					? {
							"line-color": "rgb(37, 99, 235)",
							"line-width": [
								"interpolate",
								["linear"],
								["zoom"],
								6,
								3,
								12,
								5,
								16,
								7,
							],
						}
					: {
							"line-color": alternativeColor,
							"line-width": [
								"interpolate",
								["linear"],
								["zoom"],
								6,
								1.5,
								12,
								2.5,
								16,
								3.5,
							],
						},
			});

			if (!overlay.isSelected) {
				continue;
			}

			map.addLayer({
				id: startLayerId,
				type: "circle",
				source: sourceId,
				filter: ["==", ["get", "kind"], "start"],
				paint: {
					"circle-color": "rgb(15, 118, 110)",
					"circle-radius": 7,
					"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
					"circle-stroke-width": 3,
				},
			});
			map.addLayer({
				id: waypointLayerId,
				type: "circle",
				source: sourceId,
				filter: ["==", ["get", "kind"], "waypoint"],
				paint: {
					"circle-color": "rgb(245, 158, 11)",
					"circle-radius": 6,
					"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
					"circle-stroke-width": 2.5,
				},
			});
			map.addLayer({
				id: destinationLayerId,
				type: "circle",
				source: sourceId,
				filter: ["==", ["get", "kind"], "destination"],
				paint: {
					"circle-color": "rgb(37, 99, 235)",
					"circle-radius": 7,
					"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
					"circle-stroke-width": 3,
				},
			});
		}

		renderedRouteOverlayIds = routeOverlays.map((overlay) => overlay.id);
	}

	function ensureConstraintOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		if (!constraintOverlay) {
			removeConstraintOverlay();
			return;
		}

		const existingSource = getConstraintSource();

		if (existingSource) {
			existingSource.setData(constraintOverlay);
		} else {
			map.addSource(constraintSourceId, {
				type: "geojson",
				data: constraintOverlay,
			});
		}

		if (!map.getLayer(constraintFillLayerId)) {
			map.addLayer({
				id: constraintFillLayerId,
				type: "fill",
				source: constraintSourceId,
				paint: {
					"fill-color": "rgba(14, 165, 233, 0.16)",
					"fill-outline-color": "rgba(14, 116, 144, 0.28)",
				},
			});
		}

		if (!map.getLayer(constraintLineLayerId)) {
			map.addLayer({
				id: constraintLineLayerId,
				type: "line",
				source: constraintSourceId,
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: {
					"line-color": "rgba(8, 145, 178, 0.72)",
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						1.2,
						12,
						2,
						16,
						3,
					],
					"line-dasharray": [2, 1.5],
				},
			});
		}
	}

	function ensureLockedSegmentOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		if (!lockedSegmentOverlay || lockedSegmentOverlay.features.length === 0) {
			removeLockedSegmentOverlay();
			return;
		}

		const existingSource = getLockedSegmentSource();

		if (existingSource) {
			existingSource.setData(lockedSegmentOverlay);
		} else {
			map.addSource(lockedSegmentSourceId, {
				type: "geojson",
				data: lockedSegmentOverlay,
			});
		}

		if (!map.getLayer(lockedSegmentCasingLayerId)) {
			map.addLayer({
				id: lockedSegmentCasingLayerId,
				type: "line",
				source: lockedSegmentSourceId,
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: {
					"line-color": "rgba(255, 255, 255, 0.9)",
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						7,
						12,
						10,
						16,
						13,
					],
					"line-opacity": 0.82,
				},
			});
		}

		if (!map.getLayer(lockedSegmentLineLayerId)) {
			map.addLayer({
				id: lockedSegmentLineLayerId,
				type: "line",
				source: lockedSegmentSourceId,
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: {
					"line-color": "rgb(217, 119, 6)",
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						3,
						12,
						5,
						16,
						7,
					],
					"line-dasharray": [1.4, 1],
				},
			});
		}
	}

	function ensureHoveredRouteOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		if (!hoveredRouteCoordinate) {
			removeHoveredRouteOverlay();
			return;
		}

		const hoveredPointGeoJson: FeatureCollection = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					properties: {
						kind: "hovered-route-point",
					},
					geometry: {
						type: "Point",
						coordinates: hoveredRouteCoordinate,
					},
				},
			],
		};
		const existingSource = getHoveredRouteSource();

		if (existingSource) {
			existingSource.setData(hoveredPointGeoJson);
		} else {
			map.addSource(hoveredRouteSourceId, {
				type: "geojson",
				data: hoveredPointGeoJson,
			});
		}

		if (!map.getLayer(hoveredRouteLayerId)) {
			map.addLayer({
				id: hoveredRouteLayerId,
				type: "circle",
				source: hoveredRouteSourceId,
				paint: {
					"circle-color": "rgb(16, 185, 129)",
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						5,
						12,
						7,
						16,
						9,
					],
					"circle-stroke-color": "rgba(255, 255, 255, 0.96)",
					"circle-stroke-width": 3,
				},
			});
		}
	}

	function buildCurrentLocationGeoJson(): FeatureCollection {
		const accuracyMeters =
			currentLocation &&
			typeof currentLocation.accuracyMeters === "number" &&
			Number.isFinite(currentLocation.accuracyMeters) &&
			currentLocation.accuracyMeters > 0
				? currentLocation.accuracyMeters
				: null;

		return {
			type: "FeatureCollection",
			features: [
				...(currentLocation && accuracyMeters
					? [
							{
								type: "Feature" as const,
								properties: {
									kind: "accuracy",
									accuracyMeters,
								},
								geometry: {
									type: "Point" as const,
									coordinates: currentLocation.point,
								},
							},
						]
					: []),
				...(currentLocation
					? [
							{
								type: "Feature" as const,
								properties: {
									kind: "current-location",
								},
								geometry: {
									type: "Point" as const,
									coordinates: currentLocation.point,
								},
							},
						]
					: []),
			],
		};
	}

	function ensureCurrentLocationOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		if (!currentLocation) {
			removeCurrentLocationOverlay();
			return;
		}

		const locationGeoJson = buildCurrentLocationGeoJson();
		const existingSource = getCurrentLocationSource();

		if (existingSource) {
			existingSource.setData(locationGeoJson);
		} else {
			map.addSource(currentLocationSourceId, {
				type: "geojson",
				data: locationGeoJson,
			});
		}

		if (!map.getLayer(currentLocationAccuracyLayerId)) {
			map.addLayer({
				id: currentLocationAccuracyLayerId,
				type: "circle",
				source: currentLocationSourceId,
				filter: ["==", ["get", "kind"], "accuracy"],
				paint: {
					"circle-color": "rgba(14, 165, 233, 0.16)",
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						8,
						["max", 10, ["/", ["get", "accuracyMeters"], 18]],
						14,
						["max", 18, ["/", ["get", "accuracyMeters"], 3]],
						17,
						["max", 28, ["/", ["get", "accuracyMeters"], 0.85]],
					],
					"circle-stroke-color": "rgba(14, 165, 233, 0.35)",
					"circle-stroke-width": 1.5,
				},
			});
		}

		if (!map.getLayer(currentLocationPointLayerId)) {
			map.addLayer({
				id: currentLocationPointLayerId,
				type: "circle",
				source: currentLocationSourceId,
				filter: ["==", ["get", "kind"], "current-location"],
				paint: {
					"circle-color": "rgb(14, 165, 233)",
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						6,
						12,
						8,
						16,
						10,
					],
					"circle-stroke-color": "rgba(255, 255, 255, 0.98)",
					"circle-stroke-width": 3,
				},
			});
		}
	}

	function getFitPadding() {
		if (typeof window === "undefined") {
			return 48;
		}

		if (window.innerWidth >= 768) {
			return {
				top: 84,
				right: 48,
				bottom: 232,
				left: 420,
			};
		}

		return {
			top: 88,
			right: 24,
			bottom: 280,
			left: 24,
		};
	}

	function fitRouteBounds() {
		if (!map || !isStyleReady || !fitBounds) {
			return;
		}

		const nextBoundsKey = fitBounds.join(",");

		if (nextBoundsKey === lastFittedBoundsKey) {
			return;
		}

		map.fitBounds(fitBounds as LngLatBoundsLike, {
			padding: getFitPadding(),
			duration: 700,
			maxZoom: 14,
		});
		lastFittedBoundsKey = nextBoundsKey;
	}

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		ensureConstraintOverlay();
		ensureRouteOverlays();
		ensureLockedSegmentOverlay();

		if (fitBounds) {
			fitRouteBounds();
		} else {
			lastFittedBoundsKey = null;
		}
	});

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		ensureHoveredRouteOverlay();
	});

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		ensureCurrentLocationOverlay();
	});

	$effect(() => {
		if (!map || !isStyleReady || !currentLocation) {
			return;
		}

		if (lastFocusedCurrentLocationKey === currentLocationFocusKey) {
			return;
		}

		lastFocusedCurrentLocationKey = currentLocationFocusKey;
		map.easeTo?.({
			center: currentLocation.point,
			zoom: 14,
			duration: 600,
		});
	});

	$effect(() => {
		const nextLayoutState = layoutState;

		if (!nextLayoutState || !map || !isStyleReady) {
			return;
		}

		scheduleSmoothResize();
	});

	$effect(() => {
		const basemapId = mapStylePreference.selectedBasemapId;
		let cancelled = false;

		if (!map) {
			return;
		}

		const currentMap = map;
		const nextStyleUrl = basemapId ? getBasemapStyleUrl(basemapId) : null;

		if (!nextStyleUrl) {
			loadError = "No map styles configured";
			isLoaded = false;
			isStyleReady = false;
			return () => {
				cancelled = true;
			};
		}

		if (nextStyleUrl === currentStyleUrl) {
			return () => {
				cancelled = true;
			};
		}

		currentStyleUrl = nextStyleUrl;
		loadError = null;
		isLoaded = false;
		isStyleReady = false;
		const handleStyleLoad = () => {
			if (cancelled) {
				return;
			}

			loadError = null;
			isLoaded = true;
			isStyleReady = true;
			scheduleSmoothResize();
		};

		let detached = false;
		let detachCurrentStyleLoad = () => {
			if (detached) {
				return;
			}

			detached = true;
			detachStyleLoadListener = () => {};
		};

		if (typeof currentMap.on === "function" && typeof currentMap.off === "function") {
			currentMap.on("style.load", handleStyleLoad);
			detachCurrentStyleLoad = () => {
				if (detached) {
					return;
				}

				detached = true;
				detachStyleLoadListener = () => {};
				currentMap.off("style.load", handleStyleLoad);
			};
			detachStyleLoadListener = detachCurrentStyleLoad;
		} else {
			detachStyleLoadListener = detachCurrentStyleLoad;
			currentMap.once("style.load", handleStyleLoad);
		}

		currentMap.setStyle(nextStyleUrl);

		return () => {
			cancelled = true;
			detachCurrentStyleLoad();
		};
	});

	$effect(() => {
		unitPreference.selectedDistanceUnit;
		syncScaleControl();
	});

	onMount(() => {
		let cancelled = false;
		let resizeObserver: ResizeObserver | undefined;

		initMapStylePreference();
		initUnitPreference();

		async function setupMap() {
			if (!mapContainer) return;

			try {
				const initialBasemapId = syncSelectedBasemap();
				const initialStyleUrl = initialBasemapId
					? getBasemapStyleUrl(initialBasemapId)
					: null;

				if (!initialStyleUrl) {
					loadError = "No map styles configured";
					isLoaded = false;
					isStyleReady = false;
					return;
				}

				const maplibregl = await import("maplibre-gl");

				if (cancelled || !mapContainer) return;

				maplibreglModule = maplibregl;
				currentStyleUrl = initialStyleUrl;

				const options: MapOptions = {
					attributionControl: false,
					center: initialCenter,
					container: mapContainer,
					style: initialStyleUrl,
					zoom: initialZoom,
				};

				map = new maplibregl.Map(options);
				syncScaleControl();
				if (typeof map.on === "function" && typeof map.off === "function") {
					const handleMapClick = (event: {
						lngLat?: { lng?: number; lat?: number };
						point?: { x?: number; y?: number };
					}) => {
						if (suppressNextMapClick) {
							suppressNextMapClick = false;
							return;
						}

						const detail = getMapEventDetail(event);

						if (!detail) {
							return;
						}

						const selectedStop = getSelectedStopAtPoint(detail.screenPoint);
						const selectedSegment = selectedStop
							? undefined
							: getSelectedSegmentAtPoint(detail.screenPoint);

						onMapClick?.({
							...detail,
							selectedStop,
							selectedSegment,
						});

						if (selectedSegment) {
							onRouteSegmentSelection?.({
								...detail,
								...selectedSegment,
							});
						}
					};
					const handleRouteDragStart = (event: {
						lngLat?: { lng?: number; lat?: number };
						point?: { x?: number; y?: number };
						preventDefault?: () => void;
					}) => {
						clearStaleClickSuppression();

						if (!manualEditingEnabled) {
							return;
						}

						const detail = getMapEventDetail(event);

						if (!detail) {
							return;
						}

						const selectedStop = getSelectedStopAtPoint(detail.screenPoint);

						if (selectedStop) {
							const stopIndex = getStopIndex(selectedStop);

							if (isStopLocked(stopIndex)) {
								return;
							}

							activeRouteDrag = {
								kind: "stop",
								selectedStop,
								stopIndex,
								startPoint: detail.point,
							};
							event.preventDefault?.();
							disableMapDragPan();
							setMapCursor("grabbing");
							return;
						}

						const selectedSegment = getSelectedSegmentAtPoint(
							detail.screenPoint,
						);

						if (!selectedSegment || isSegmentLocked(selectedSegment.segmentIndex)) {
							return;
						}

						activeRouteDrag = {
							kind: "segment",
							...selectedSegment,
							startPoint: detail.point,
						};
						event.preventDefault?.();
						disableMapDragPan();
						setMapCursor("crosshair");
					};
					const handleRouteDragMove = (event: {
						point?: { x?: number; y?: number };
					}) => {
						prepareSelectedRouteProjectionCache();

						if (activeRouteDrag) {
							setMapCursor(
								activeRouteDrag.kind === "stop" ? "grabbing" : "crosshair",
							);
							return;
						}

						if (!manualEditingEnabled || !event.point) {
							setMapCursor("");
							return;
						}

						const selectedStop = getSelectedStopAtPoint({
							x: event.point.x ?? 0,
							y: event.point.y ?? 0,
						});

						if (selectedStop && !isStopLocked(getStopIndex(selectedStop))) {
							setMapCursor("grab");
							return;
						}

						const selectedSegment = getSelectedSegmentAtPoint({
							x: event.point.x ?? 0,
							y: event.point.y ?? 0,
						});

						setMapCursor(
							selectedSegment && !isSegmentLocked(selectedSegment.segmentIndex)
								? "crosshair"
								: "",
						);
					};
					const handleRouteDragEnd = (event: {
						lngLat?: { lng?: number; lat?: number };
						point?: { x?: number; y?: number };
					}) => {
						finishRouteDrag(event);
					};

					map.on("click", handleMapClick);
					map.on("mousedown", handleRouteDragStart);
					map.on("pointerdown", clearStaleClickSuppression);
					map.on("mouseenter", clearStaleClickSuppression);
					map.on("mousemove", handleRouteDragMove);
					map.on("mouseup", handleRouteDragEnd);
					map.on("mouseleave", handleRouteDragEnd);
					detachMapClickListener = () => {
						map?.off("click", handleMapClick);
						detachMapClickListener = () => {};
					};
					detachRouteEditingListeners = () => {
						map?.off("mousedown", handleRouteDragStart);
						map?.off("pointerdown", clearStaleClickSuppression);
						map?.off("mouseenter", clearStaleClickSuppression);
						map?.off("mousemove", handleRouteDragMove);
						map?.off("mouseup", handleRouteDragEnd);
						map?.off("mouseleave", handleRouteDragEnd);
						detachRouteEditingListeners = () => {};
					};
				}
				map.once("load", () => {
					if (cancelled) return;
					loadError = null;
					isLoaded = true;
					isStyleReady = true;
					scheduleSmoothResize();
				});

				resizeObserver = new ResizeObserver(() => {
					scheduleSmoothResize();
				});
				resizeObserver.observe(mapContainer);
			} catch (error) {
				if (cancelled) return;
				loadError = "Map failed to load";
				isLoaded = false;
				isStyleReady = false;
				console.error("Failed to initialize MapLibre map", error);
			}
		}

		void setupMap();

		return () => {
			cancelled = true;
			detachStyleLoadListener();
			detachMapClickListener();
			detachRouteEditingListeners();
			cancelSmoothResize();
			resizeObserver?.disconnect();
			removeRouteOverlays();
			removeConstraintOverlay();
			removeLockedSegmentOverlay();
			removeHoveredRouteOverlay();
			removeCurrentLocationOverlay();
			removeScaleControl();
			map?.remove();
			map = null;
			maplibreglModule = null;
			currentStyleUrl = null;
			isStyleReady = false;
		};
	});
</script>

<div class="absolute inset-0 overflow-hidden bg-slate-100" data-slot="map-view">
	<div
		bind:this={mapContainer}
		class="h-full w-full"
		role="region"
		aria-busy={!isLoaded && !loadError}
		aria-label={ariaLabel}
	></div>
	<div
		class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.22),transparent_36%),linear-gradient(to_bottom,rgba(255,255,255,0.08),transparent_24%)]"
	></div>
	{#if loadError}
		<div class="pointer-events-none absolute inset-0 flex items-start justify-center p-4">
			<div
				class="max-w-sm rounded-xl border border-border/70 bg-background/92 px-4 py-3 text-sm font-medium text-foreground shadow-lg backdrop-blur-sm"
				role="status"
			>
				{loadError}
			</div>
		</div>
	{/if}
</div>

<style>
	[data-slot="map-view"] :global(.maplibregl-ctrl-bottom-left) {
		bottom: calc(env(safe-area-inset-bottom, 0px) + 9rem);
		left: calc(env(safe-area-inset-left, 0px) + 1rem);
		position: fixed;
	}

	[data-slot="map-view"] :global(.maplibregl-ctrl-bottom-left .maplibregl-ctrl) {
		margin: 0;
	}

	[data-slot="map-view"] :global(.maplibregl-ctrl-scale) {
		min-width: 3rem;
		border: 1px solid rgba(15, 23, 42, 0.18);
		border-top: 0;
		background: rgba(255, 255, 255, 0.82);
		box-shadow: 0 8px 22px rgba(15, 23, 42, 0.14);
		color: rgb(15, 23, 42);
		font-size: 0.6875rem;
		font-weight: 650;
		line-height: 1;
		text-shadow: none;
		backdrop-filter: blur(12px) saturate(1.12);
	}

	@media (min-width: 768px) {
		[data-slot="map-view"] :global(.maplibregl-ctrl-bottom-left) {
			bottom: calc(env(safe-area-inset-bottom, 0px) + 7rem);
			left: calc(env(safe-area-inset-left, 0px) + 23rem);
		}
	}
</style>
