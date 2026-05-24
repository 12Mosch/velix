import type { Map as MapLibreMap } from "maplibre-gl";

import type {
	PlannedRoute,
	RouteCoordinate,
	RouteMapOverlay,
	RouteMode,
} from "$lib/route-planning";
import { getRouteLegIndexForCoordinateSegment } from "$lib/route-planning";
import {
	getRouteDestinationLayerId,
	getRouteStartLayerId,
	getRouteWaypointLayerId,
} from "$lib/map/map-view-renderer";

const routeSegmentSelectionThresholdPx = 18;
const routeSegmentNearHitThresholdPx = 1;
const cameraEvents = ["move", "zoom", "rotate", "pitch", "resize"] as const;

export type SelectedRouteStop =
	| {
			kind: "start" | "destination";
			label?: string;
	  }
	| {
			kind: "waypoint";
			label?: string;
			index: number;
	  };

export type RouteDragDetail = {
	point: [number, number];
	screenPoint: {
		x: number;
		y: number;
	};
};

export type RouteStopDragEndDetail = RouteDragDetail & {
	selectedStop: SelectedRouteStop;
	stopIndex: number;
};

export type RouteSegmentDetail = RouteDragDetail & {
	coordinateSegmentIndex: number;
	segmentIndex: number;
};

type MapEvent = {
	lngLat?: { lng?: number; lat?: number };
	point?: { x?: number; y?: number };
	preventDefault?: () => void;
};

type RouteProjectionCache = {
	coordinates: RouteCoordinate[];
	points: Array<{ x: number; y: number } | null>;
};

type ScreenPoint = { x: number; y: number };

type DragPanControl = {
	isEnabled?: () => boolean;
	disable?: () => void;
	enable?: () => void;
};

type RenderedRouteStopProperties =
	| {
			kind: "start" | "destination";
			label?: string;
	  }
	| {
			kind: "waypoint";
			label?: string;
			order: number;
	  };

export type RouteEditInteractionsOptions = {
	map: MapLibreMap;
	getRouteOverlays: () => RouteMapOverlay[] | null;
	getPlannedRoute: () => PlannedRoute | null;
	getRouteMode: () => RouteMode | null;
	getManualEditingEnabled: () => boolean;
	getLockedSegmentIndexes: () => number[];
	setCursor: (cursor: string) => void;
	onMapClick?:
		| ((
				detail: RouteDragDetail & {
					selectedStop?: SelectedRouteStop;
					selectedSegment?: {
						coordinateSegmentIndex: number;
						segmentIndex: number;
					};
				},
		  ) => void)
		| null;
	onRouteStopDragEnd?: ((detail: RouteStopDragEndDetail) => void) | null;
	onRouteSegmentDragEnd?: ((detail: RouteSegmentDetail) => void) | null;
	onRouteSegmentSelection?: ((detail: RouteSegmentDetail) => void) | null;
};

export function getMapEventDetail(event: MapEvent): RouteDragDetail | null {
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
		point: [longitude, latitude],
		screenPoint: { x: clickX, y: clickY },
	};
}

export function getPointToScreenSegmentDistance(
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

export function createRouteEditInteractions(
	options: RouteEditInteractionsOptions,
) {
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
	let routeProjectionCache: RouteProjectionCache | null = null;
	let latestHoverScreenPoint: ScreenPoint | null = null;
	let pendingHoverFrameId: number | null = null;

	function getSelectedOverlay() {
		const routeOverlays = options.getRouteOverlays();
		if (!routeOverlays || routeOverlays.length === 0) return null;
		return (
			routeOverlays.find((overlay) => overlay.isSelected) ?? routeOverlays[0]
		);
	}

	function getSelectedStopAtPoint(screenPoint: {
		x: number;
		y: number;
	}): SelectedRouteStop | undefined {
		if (typeof options.map.queryRenderedFeatures !== "function")
			return undefined;

		const selectedOverlay = getSelectedOverlay();
		if (!selectedOverlay) return undefined;

		const matchingFeature = options.map
			.queryRenderedFeatures([screenPoint.x, screenPoint.y], {
				layers: [
					getRouteStartLayerId(selectedOverlay.id),
					getRouteWaypointLayerId(selectedOverlay.id),
					getRouteDestinationLayerId(selectedOverlay.id),
				],
			})
			.find((feature) => {
				const properties = feature.properties as
					| Partial<RenderedRouteStopProperties>
					| undefined;
				const kind = properties?.kind;
				return (
					kind === "start" || kind === "waypoint" || kind === "destination"
				);
			});

		if (!matchingFeature) return undefined;

		const properties = matchingFeature.properties as
			| Partial<RenderedRouteStopProperties>
			| undefined;
		const kind = properties?.kind;
		if (kind === "start" || kind === "destination") {
			return {
				kind,
				label:
					typeof properties?.label === "string" ? properties.label : undefined,
			};
		}

		if (kind === "waypoint") {
			const order = Number(properties?.order);
			if (!Number.isFinite(order) || order < 1) return undefined;
			return {
				kind: "waypoint",
				label:
					typeof properties?.label === "string" ? properties.label : undefined,
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
		return routeFeature?.geometry.type === "LineString"
			? (routeFeature.geometry.coordinates as RouteCoordinate[])
			: [];
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
		if (options.getRouteMode() === "round_course") {
			return Math.max(1, waypointCount + 1);
		}
		return getSelectedRouteHasDestination() ? waypointCount + 1 : waypointCount;
	}

	function getStopIndex(selectedStop: SelectedRouteStop): number {
		if (selectedStop.kind === "start") return 0;
		if (selectedStop.kind === "waypoint") return selectedStop.index + 1;
		return getSelectedRouteWaypointCount() + 1;
	}

	function isSegmentLocked(segmentIndex: number) {
		return options.getLockedSegmentIndexes().includes(segmentIndex);
	}

	function isStopLocked(stopIndex: number) {
		const segmentCount = getSelectedRouteSegmentCount();
		const lockedSegmentIndexes = options.getLockedSegmentIndexes();

		if (segmentCount <= 0) return false;
		if (
			lockedSegmentIndexes.includes(stopIndex) ||
			lockedSegmentIndexes.includes(stopIndex - 1)
		) {
			return true;
		}

		return (
			options.getRouteMode() === "round_course" &&
			stopIndex === 0 &&
			lockedSegmentIndexes.includes(segmentCount - 1)
		);
	}

	function getProjectedPoint(coordinate: RouteCoordinate) {
		const projected = (
			options.map as MapLibreMap & {
				project?: (
					coordinate: [number, number],
				) => { x: number; y: number } | null;
			}
		).project?.([coordinate[0], coordinate[1]]);

		return projected ? { x: projected.x, y: projected.y } : null;
	}

	function getSelectedRouteProjectionCache() {
		const coordinates = getSelectedRouteCoordinates();
		if (routeProjectionCache?.coordinates === coordinates) {
			return routeProjectionCache;
		}

		routeProjectionCache = {
			coordinates,
			points: coordinates.map((coordinate) => getProjectedPoint(coordinate)),
		};
		return routeProjectionCache;
	}

	function clearProjectionCache() {
		routeProjectionCache = null;
	}

	function getEditableSegmentIndexForCoordinateSegment(
		coordinateSegmentIndex: number,
	) {
		const coordinates = getSelectedRouteCoordinates();
		const segmentCount = getSelectedRouteSegmentCount();
		const plannedRoute = options.getPlannedRoute();
		const plannedRouteLegIndex = plannedRoute
			? getRouteLegIndexForCoordinateSegment(
					plannedRoute,
					coordinateSegmentIndex,
				)
			: null;

		if (plannedRouteLegIndex !== null) return plannedRouteLegIndex;
		if (segmentCount <= 1 || coordinates.length < 2) return 0;

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

	function getSelectedSegmentAtPoint(screenPoint: { x: number; y: number }) {
		const coordinates = getSelectedRouteCoordinates();
		if (coordinates.length < 2) return undefined;

		const projectionCache = getSelectedRouteProjectionCache();
		let bestCoordinateSegmentIndex = -1;
		let bestDistance = Number.POSITIVE_INFINITY;

		for (let index = 0; index < coordinates.length - 1; index += 1) {
			const from = coordinates[index];
			const to = coordinates[index + 1];
			if (!from || !to) continue;

			const fromPoint =
				projectionCache?.points[index] ?? getProjectedPoint(from);
			const toPoint =
				projectionCache?.points[index + 1] ?? getProjectedPoint(to);
			if (!fromPoint || !toPoint) continue;

			const distance = getPointToScreenSegmentDistance(
				screenPoint,
				fromPoint,
				toPoint,
			);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestCoordinateSegmentIndex = index;
			}
			if (distance < routeSegmentNearHitThresholdPx) break;
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

	function disableMapDragPan() {
		const dragPan = (options.map as MapLibreMap & { dragPan?: DragPanControl })
			.dragPan;
		dragPanWasEnabled = dragPan?.isEnabled?.() ?? false;
		dragPan?.disable?.();
	}

	function restoreMapDragPan() {
		const dragPan = (options.map as MapLibreMap & { dragPan?: DragPanControl })
			.dragPan;
		if (dragPanWasEnabled) dragPan?.enable?.();
		dragPanWasEnabled = false;
	}

	function finishRouteDrag(event: MapEvent) {
		if (!activeRouteDrag) return;

		const drag = activeRouteDrag;
		const detail = getMapEventDetail(event);
		activeRouteDrag = null;
		routeProjectionCache = null;
		restoreMapDragPan();
		options.setCursor("");

		if (!detail) return;

		suppressNextMapClick =
			drag.startPoint[0] !== detail.point[0] ||
			drag.startPoint[1] !== detail.point[1];
		if (!suppressNextMapClick) return;

		if (drag.kind === "stop") {
			options.onRouteStopDragEnd?.({
				...detail,
				selectedStop: drag.selectedStop,
				stopIndex: drag.stopIndex,
			});
			return;
		}

		options.onRouteSegmentDragEnd?.({
			...detail,
			coordinateSegmentIndex: drag.coordinateSegmentIndex,
			segmentIndex: drag.segmentIndex,
		});
	}

	function clearStaleClickSuppression() {
		suppressNextMapClick = false;
	}

	function getScreenPoint(event: MapEvent): ScreenPoint | null {
		const x = event.point?.x;
		const y = event.point?.y;
		return typeof x === "number" && typeof y === "number" ? { x, y } : null;
	}

	function getAnimationFrameApi() {
		const requestFrame =
			globalThis.requestAnimationFrame ??
			(typeof window !== "undefined"
				? window.requestAnimationFrame
				: undefined);
		const cancelFrame =
			globalThis.cancelAnimationFrame ??
			(typeof window !== "undefined" ? window.cancelAnimationFrame : undefined);

		return { requestFrame, cancelFrame };
	}

	function cancelPendingHoverHitTest() {
		latestHoverScreenPoint = null;
		if (pendingHoverFrameId === null) return;

		const { cancelFrame } = getAnimationFrameApi();
		cancelFrame?.(pendingHoverFrameId);
		pendingHoverFrameId = null;
	}

	function runHoverHitTest() {
		pendingHoverFrameId = null;
		const screenPoint = latestHoverScreenPoint;
		latestHoverScreenPoint = null;

		if (!screenPoint || !options.getManualEditingEnabled()) {
			options.setCursor("");
			return;
		}

		const selectedStop = getSelectedStopAtPoint(screenPoint);
		if (selectedStop && !isStopLocked(getStopIndex(selectedStop))) {
			options.setCursor("grab");
			return;
		}

		const selectedSegment = getSelectedSegmentAtPoint(screenPoint);
		options.setCursor(
			selectedSegment && !isSegmentLocked(selectedSegment.segmentIndex)
				? "crosshair"
				: "",
		);
	}

	function scheduleHoverHitTest(screenPoint: ScreenPoint) {
		latestHoverScreenPoint = screenPoint;
		if (pendingHoverFrameId !== null) return;

		const { requestFrame } = getAnimationFrameApi();
		if (typeof requestFrame !== "function") {
			runHoverHitTest();
			return;
		}

		pendingHoverFrameId = requestFrame(() => {
			runHoverHitTest();
		});
	}

	function handleCameraChange() {
		cancelPendingHoverHitTest();
		clearProjectionCache();
	}

	function handleMapClick(event: MapEvent) {
		cancelPendingHoverHitTest();
		if (suppressNextMapClick) {
			suppressNextMapClick = false;
			return;
		}

		const detail = getMapEventDetail(event);
		if (!detail) return;

		const selectedStop = getSelectedStopAtPoint(detail.screenPoint);
		const selectedSegment = selectedStop
			? undefined
			: getSelectedSegmentAtPoint(detail.screenPoint);

		options.onMapClick?.({ ...detail, selectedStop, selectedSegment });
		if (selectedSegment) {
			options.onRouteSegmentSelection?.({ ...detail, ...selectedSegment });
		}
	}

	function handleRouteDragStart(event: MapEvent) {
		clearStaleClickSuppression();
		if (!options.getManualEditingEnabled()) return;

		const detail = getMapEventDetail(event);
		if (!detail) return;

		const selectedStop = getSelectedStopAtPoint(detail.screenPoint);
		if (selectedStop) {
			const stopIndex = getStopIndex(selectedStop);
			if (isStopLocked(stopIndex)) return;

			cancelPendingHoverHitTest();
			activeRouteDrag = {
				kind: "stop",
				selectedStop,
				stopIndex,
				startPoint: detail.point,
			};
			event.preventDefault?.();
			disableMapDragPan();
			options.setCursor("grabbing");
			return;
		}

		const selectedSegment = getSelectedSegmentAtPoint(detail.screenPoint);
		if (!selectedSegment || isSegmentLocked(selectedSegment.segmentIndex))
			return;

		cancelPendingHoverHitTest();
		activeRouteDrag = {
			kind: "segment",
			...selectedSegment,
			startPoint: detail.point,
		};
		event.preventDefault?.();
		disableMapDragPan();
		options.setCursor("crosshair");
	}

	function handleRouteDragMove(event: MapEvent) {
		if (activeRouteDrag) {
			cancelPendingHoverHitTest();
			options.setCursor(
				activeRouteDrag.kind === "stop" ? "grabbing" : "crosshair",
			);
			return;
		}

		if (!options.getManualEditingEnabled()) {
			cancelPendingHoverHitTest();
			options.setCursor("");
			return;
		}

		const screenPoint = getScreenPoint(event);
		if (!screenPoint) {
			cancelPendingHoverHitTest();
			options.setCursor("");
			return;
		}

		scheduleHoverHitTest(screenPoint);
	}

	function handleRouteDragEnd(event: MapEvent) {
		finishRouteDrag(event);
	}

	return {
		attach() {
			options.map.on("click", handleMapClick);
			options.map.on("mousedown", handleRouteDragStart);
			options.map.on("pointerdown", clearStaleClickSuppression);
			options.map.on("mouseenter", clearStaleClickSuppression);
			options.map.on("mousemove", handleRouteDragMove);
			options.map.on("mouseup", handleRouteDragEnd);
			options.map.on("mouseleave", handleRouteDragEnd);
			for (const event of cameraEvents) {
				options.map.on(event, handleCameraChange);
			}
		},
		detach() {
			cancelPendingHoverHitTest();
			options.map.off("click", handleMapClick);
			options.map.off("mousedown", handleRouteDragStart);
			options.map.off("pointerdown", clearStaleClickSuppression);
			options.map.off("mouseenter", clearStaleClickSuppression);
			options.map.off("mousemove", handleRouteDragMove);
			options.map.off("mouseup", handleRouteDragEnd);
			options.map.off("mouseleave", handleRouteDragEnd);
			for (const event of cameraEvents) {
				options.map.off(event, handleCameraChange);
			}
		},
		clearProjectionCache,
	};
}
