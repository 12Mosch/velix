import type { Map as MapLibreMap } from "maplibre-gl";
import { Option } from "effect";

import type {
	PlannedRoute,
	RouteCoordinate,
	RouteMapOverlay,
	RouteMode,
} from "$lib/route-planning";
import {
	getCoordinateSegmentForRouteLeg,
	getRouteSegmentCount,
} from "$lib/route-planning/editing";
import {
	getRouteDestinationLayerId,
	getRouteStartLayerId,
	getRouteWaypointLayerId,
} from "$lib/map/map-view-renderer";

const routeSegmentSelectionThresholdPx = 18;
const routeSegmentNearHitThresholdPx = 1;
const routeSegmentHitTestGridCellSizePx = 64;
const routeHitTestIndexBuildBudgetMs = 6;
const cameraEvents = ["move", "zoom", "rotate", "pitch", "resize"] as const;
const cameraSettledEvents = [
	"moveend",
	"zoomend",
	"rotateend",
	"pitchend",
] as const;

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

type ScreenPoint = { x: number; y: number };

type IndexedRouteSegment = {
	coordinateSegmentIndex: number;
	segmentIndex: number;
	fromPoint: ScreenPoint;
	toPoint: ScreenPoint;
};

type RouteHitTestIndex = {
	overlayId: string;
	coordinates: RouteCoordinate[];
	plannedRoute: PlannedRoute | null;
	routeMode: RouteMode | null;
	segmentCount: number;
	segments: IndexedRouteSegment[];
	cells: Map<string, number[]>;
};

type RouteLegCoordinateRange = {
	legIndex: number;
	fromIndex: number;
	toIndex: number;
};

type FrameOrIdleHandle =
	| { kind: "frame"; id: number }
	| { kind: "idle"; id: number };

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
	let routeHitTestIndex: RouteHitTestIndex | null = null;
	let pendingHitTestIndexWarmup: FrameOrIdleHandle | null = null;
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

	function getSelectedRouteFeature() {
		const selectedOverlay = getSelectedOverlay();
		const routeFeature = selectedOverlay?.geoJson.features.find(
			(feature) => feature.properties?.kind === "route",
		);

		if (!selectedOverlay || routeFeature?.geometry.type !== "LineString") {
			return null;
		}

		return {
			overlay: selectedOverlay,
			coordinates: routeFeature.geometry.coordinates as RouteCoordinate[],
		};
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

	function getRouteLegCoordinateRanges(
		plannedRoute: PlannedRoute | null,
	): RouteLegCoordinateRange[] {
		if (!plannedRoute) return [];

		const ranges: RouteLegCoordinateRange[] = [];
		const plannedRouteSegmentCount = getRouteSegmentCount(plannedRoute);
		for (let legIndex = 0; legIndex < plannedRouteSegmentCount; legIndex += 1) {
			const segment = getCoordinateSegmentForRouteLeg(plannedRoute, legIndex);
			if (Option.isSome(segment)) {
				ranges.push({
					legIndex,
					fromIndex: segment.value.fromIndex,
					toIndex: segment.value.toIndex,
				});
			}
		}

		return ranges;
	}

	function getEditableSegmentIndexForCoordinateSegmentFromRanges(
		coordinateSegmentIndex: number,
		coordinatesLength: number,
		segmentCount: number,
		ranges: RouteLegCoordinateRange[],
	) {
		const matchingRange = ranges.find(
			(range) =>
				coordinateSegmentIndex >= range.fromIndex &&
				coordinateSegmentIndex < range.toIndex,
		);
		if (matchingRange) return matchingRange.legIndex;
		if (segmentCount <= 1 || coordinatesLength < 2) return 0;

		return Math.min(
			segmentCount - 1,
			Math.max(
				0,
				Math.floor(
					(coordinateSegmentIndex / Math.max(coordinatesLength - 1, 1)) *
						segmentCount,
				),
			),
		);
	}

	function getRouteHitTestGridCellCoordinate(value: number) {
		return Math.floor(value / routeSegmentHitTestGridCellSizePx);
	}

	function getRouteHitTestGridCellKey(cellX: number, cellY: number) {
		return `${cellX}:${cellY}`;
	}

	function addRouteSegmentToGridCells(
		cells: Map<string, number[]>,
		segmentIndex: number,
		fromPoint: ScreenPoint,
		toPoint: ScreenPoint,
	) {
		const minCellX = getRouteHitTestGridCellCoordinate(
			Math.min(fromPoint.x, toPoint.x) - routeSegmentSelectionThresholdPx,
		);
		const maxCellX = getRouteHitTestGridCellCoordinate(
			Math.max(fromPoint.x, toPoint.x) + routeSegmentSelectionThresholdPx,
		);
		const minCellY = getRouteHitTestGridCellCoordinate(
			Math.min(fromPoint.y, toPoint.y) - routeSegmentSelectionThresholdPx,
		);
		const maxCellY = getRouteHitTestGridCellCoordinate(
			Math.max(fromPoint.y, toPoint.y) + routeSegmentSelectionThresholdPx,
		);

		for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
			for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
				const cellKey = getRouteHitTestGridCellKey(cellX, cellY);
				const segmentIndexes = cells.get(cellKey);
				if (segmentIndexes) {
					segmentIndexes.push(segmentIndex);
				} else {
					cells.set(cellKey, [segmentIndex]);
				}
			}
		}
	}

	function buildSelectedRouteHitTestIndex(): RouteHitTestIndex | null {
		const selectedRouteFeature = getSelectedRouteFeature();
		if (!selectedRouteFeature || selectedRouteFeature.coordinates.length < 2) {
			clearHitTestIndex();
			return null;
		}

		const coordinates = selectedRouteFeature.coordinates;
		const plannedRoute = options.getPlannedRoute();
		const routeMode = options.getRouteMode();
		const segmentCount = getSelectedRouteSegmentCount();
		const routeLegRanges = getRouteLegCoordinateRanges(plannedRoute);
		const segments: IndexedRouteSegment[] = [];
		const cells = new Map<string, number[]>();
		let fromPoint = getProjectedPoint(coordinates[0]);

		for (let index = 0; index < coordinates.length - 1; index += 1) {
			const toPoint = getProjectedPoint(coordinates[index + 1]);
			if (!fromPoint || !toPoint) {
				fromPoint = toPoint;
				continue;
			}

			const indexedSegment: IndexedRouteSegment = {
				coordinateSegmentIndex: index,
				segmentIndex: getEditableSegmentIndexForCoordinateSegmentFromRanges(
					index,
					coordinates.length,
					segmentCount,
					routeLegRanges,
				),
				fromPoint,
				toPoint,
			};
			segments.push(indexedSegment);
			addRouteSegmentToGridCells(
				cells,
				segments.length - 1,
				fromPoint,
				toPoint,
			);
			fromPoint = toPoint;
		}

		routeHitTestIndex = {
			overlayId: selectedRouteFeature.overlay.id,
			coordinates,
			plannedRoute,
			routeMode,
			segmentCount,
			segments,
			cells,
		};

		return routeHitTestIndex;
	}

	function getSelectedRouteHitTestIndex() {
		const selectedRouteFeature = getSelectedRouteFeature();
		if (!selectedRouteFeature || selectedRouteFeature.coordinates.length < 2) {
			clearHitTestIndex();
			return null;
		}

		const plannedRoute = options.getPlannedRoute();
		const routeMode = options.getRouteMode();
		const segmentCount = getSelectedRouteSegmentCount();

		if (
			routeHitTestIndex &&
			routeHitTestIndex.overlayId === selectedRouteFeature.overlay.id &&
			routeHitTestIndex.coordinates === selectedRouteFeature.coordinates &&
			routeHitTestIndex.plannedRoute === plannedRoute &&
			routeHitTestIndex.routeMode === routeMode &&
			routeHitTestIndex.segmentCount === segmentCount
		) {
			return routeHitTestIndex;
		}

		return buildSelectedRouteHitTestIndex();
	}

	function cancelPendingHitTestIndexWarmup() {
		if (!pendingHitTestIndexWarmup) return;

		if (pendingHitTestIndexWarmup.kind === "idle") {
			const cancelIdle =
				globalThis.cancelIdleCallback ??
				(typeof window !== "undefined" ? window.cancelIdleCallback : undefined);
			cancelIdle?.(pendingHitTestIndexWarmup.id);
		} else {
			const { cancelFrame } = getAnimationFrameApi();
			cancelFrame?.(pendingHitTestIndexWarmup.id);
		}

		pendingHitTestIndexWarmup = null;
	}

	function clearHitTestIndex() {
		cancelPendingHitTestIndexWarmup();
		routeHitTestIndex = null;
	}

	function scheduleHitTestIndexWarmup() {
		if (!options.getManualEditingEnabled()) return;
		if (pendingHitTestIndexWarmup) return;

		const runWarmup = () => {
			pendingHitTestIndexWarmup = null;
			if (options.getManualEditingEnabled()) {
				getSelectedRouteHitTestIndex();
			}
		};

		const requestIdle =
			globalThis.requestIdleCallback ??
			(typeof window !== "undefined" ? window.requestIdleCallback : undefined);
		if (typeof requestIdle === "function") {
			pendingHitTestIndexWarmup = {
				kind: "idle",
				id: requestIdle(runWarmup, {
					timeout: routeHitTestIndexBuildBudgetMs,
				}),
			};
			return;
		}

		const { requestFrame } = getAnimationFrameApi();
		if (typeof requestFrame === "function") {
			pendingHitTestIndexWarmup = {
				kind: "frame",
				id: requestFrame(runWarmup),
			};
			return;
		}

		runWarmup();
	}

	function getSelectedSegmentAtPoint(screenPoint: { x: number; y: number }) {
		const hitTestIndex = getSelectedRouteHitTestIndex();
		if (!hitTestIndex) return undefined;

		let bestSegment: IndexedRouteSegment | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		const minCellX = getRouteHitTestGridCellCoordinate(
			screenPoint.x - routeSegmentSelectionThresholdPx,
		);
		const maxCellX = getRouteHitTestGridCellCoordinate(
			screenPoint.x + routeSegmentSelectionThresholdPx,
		);
		const minCellY = getRouteHitTestGridCellCoordinate(
			screenPoint.y - routeSegmentSelectionThresholdPx,
		);
		const maxCellY = getRouteHitTestGridCellCoordinate(
			screenPoint.y + routeSegmentSelectionThresholdPx,
		);
		const candidateSegmentIndexes = new Set<number>();

		for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
			for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
				const cellSegments = hitTestIndex.cells.get(
					getRouteHitTestGridCellKey(cellX, cellY),
				);
				if (!cellSegments) continue;

				for (const segmentIndex of cellSegments) {
					candidateSegmentIndexes.add(segmentIndex);
				}
			}
		}

		for (const segmentIndex of candidateSegmentIndexes) {
			const segment = hitTestIndex.segments[segmentIndex];
			if (!segment) continue;
			const distance = getPointToScreenSegmentDistance(
				screenPoint,
				segment.fromPoint,
				segment.toPoint,
			);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestSegment = segment;
			}
			if (distance < routeSegmentNearHitThresholdPx) break;
		}

		if (!bestSegment || bestDistance > routeSegmentSelectionThresholdPx) {
			return undefined;
		}

		return {
			coordinateSegmentIndex: bestSegment.coordinateSegmentIndex,
			segmentIndex: bestSegment.segmentIndex,
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
		clearHitTestIndex();
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
		clearHitTestIndex();
	}

	function handleCameraSettled() {
		scheduleHitTestIndexWarmup();
	}

	function handleMouseEnter() {
		clearStaleClickSuppression();
		scheduleHitTestIndexWarmup();
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
			options.map.on("mouseenter", handleMouseEnter);
			options.map.on("mousemove", handleRouteDragMove);
			options.map.on("mouseup", handleRouteDragEnd);
			options.map.on("mouseleave", handleRouteDragEnd);
			for (const event of cameraEvents) {
				options.map.on(event, handleCameraChange);
			}
			for (const event of cameraSettledEvents) {
				options.map.on(event, handleCameraSettled);
			}
			scheduleHitTestIndexWarmup();
		},
		detach() {
			cancelPendingHoverHitTest();
			cancelPendingHitTestIndexWarmup();
			options.map.off("click", handleMapClick);
			options.map.off("mousedown", handleRouteDragStart);
			options.map.off("pointerdown", clearStaleClickSuppression);
			options.map.off("mouseenter", handleMouseEnter);
			options.map.off("mousemove", handleRouteDragMove);
			options.map.off("mouseup", handleRouteDragEnd);
			options.map.off("mouseleave", handleRouteDragEnd);
			for (const event of cameraEvents) {
				options.map.off(event, handleCameraChange);
			}
			for (const event of cameraSettledEvents) {
				options.map.off(event, handleCameraSettled);
			}
		},
		clearProjectionCache: clearHitTestIndex,
		clearHitTestIndex,
	};
}
