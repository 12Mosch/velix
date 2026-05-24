import type { FeatureCollection } from "geojson";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RouteMapOverlay } from "$lib/route-planning";
import {
	createRouteEditInteractions,
	getPointToScreenSegmentDistance,
} from "$lib/map/route-edit-interactions";

const routeGeoJson: FeatureCollection = {
	type: "FeatureCollection",
	features: [
		{
			type: "Feature",
			properties: { kind: "route" },
			geometry: {
				type: "LineString",
				coordinates: [
					[0, 0],
					[10, 0],
					[20, 0],
				],
			},
		},
		{
			type: "Feature",
			properties: { kind: "start", label: "Start" },
			geometry: { type: "Point", coordinates: [0, 0] },
		},
		{
			type: "Feature",
			properties: { kind: "destination", label: "End" },
			geometry: { type: "Point", coordinates: [20, 0] },
		},
	],
};

const routeOverlays: RouteMapOverlay[] = [
	{
		id: "route-0",
		geoJson: routeGeoJson,
		bounds: [0, 0, 20, 0],
		isSelected: true,
	},
];

function createMapMock() {
	const handlers = new Map<string, (event: unknown) => void>();
	const map = {
		on: vi.fn((event: string, handler: (event: unknown) => void) => {
			handlers.set(event, handler);
			return map;
		}),
		off: vi.fn((event: string, handler: (event: unknown) => void) => {
			if (handlers.get(event) === handler) {
				handlers.delete(event);
			}
			return map;
		}),
		project: vi.fn(([lng, lat]: [number, number]) => ({
			x: lng,
			y: lat,
		})),
		queryRenderedFeatures: vi.fn(() => []),
		dragPan: {
			isEnabled: vi.fn(() => true),
			disable: vi.fn(),
			enable: vi.fn(),
		},
	};

	return {
		map,
		handlers,
	};
}

function installAnimationFrameMock() {
	const callbacks = new Map<number, FrameRequestCallback>();
	let nextFrameId = 1;
	const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
		const frameId = nextFrameId;
		nextFrameId += 1;
		callbacks.set(frameId, callback);
		return frameId;
	});
	const cancelAnimationFrame = vi.fn((frameId: number) => {
		callbacks.delete(frameId);
	});

	vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
	vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

	return {
		requestAnimationFrame,
		cancelAnimationFrame,
		runFrame(frameId = 1) {
			const callback = callbacks.get(frameId);
			callbacks.delete(frameId);
			callback?.(performance.now());
		},
		getPendingFrameIds() {
			return [...callbacks.keys()];
		},
	};
}

describe("route edit interactions", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("computes point-to-segment screen distance", () => {
		expect(
			getPointToScreenSegmentDistance(
				{ x: 5, y: 3 },
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
			),
		).toBe(3);
		expect(
			getPointToScreenSegmentDistance(
				{ x: 13, y: 4 },
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
			),
		).toBe(5);
	});

	it("selects the nearest route segment on click", () => {
		const { map, handlers } = createMapMock();
		const onRouteSegmentSelection = vi.fn();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => routeOverlays,
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => false,
			getLockedSegmentIndexes: () => [],
			setCursor: vi.fn(),
			onRouteSegmentSelection,
		});

		interactions.attach();
		handlers.get("click")?.({
			lngLat: { lng: 14, lat: 1 },
			point: { x: 14, y: 1 },
		});

		expect(onRouteSegmentSelection).toHaveBeenCalledWith({
			point: [14, 1],
			screenPoint: { x: 14, y: 1 },
			coordinateSegmentIndex: 1,
			segmentIndex: 0,
		});
	});

	it("suppresses segment drags for locked segments", () => {
		const { map, handlers } = createMapMock();
		const onRouteSegmentDragEnd = vi.fn();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => routeOverlays,
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => true,
			getLockedSegmentIndexes: () => [0],
			setCursor: vi.fn(),
			onRouteSegmentDragEnd,
		});

		interactions.attach();
		handlers.get("mousedown")?.({
			lngLat: { lng: 4, lat: 0 },
			point: { x: 4, y: 0 },
			preventDefault: vi.fn(),
		});
		handlers.get("mouseup")?.({
			lngLat: { lng: 5, lat: 1 },
			point: { x: 5, y: 1 },
		});

		expect(onRouteSegmentDragEnd).not.toHaveBeenCalled();
		expect(map.dragPan.disable).not.toHaveBeenCalled();
	});

	it("does not project route coordinates on mousemove when manual editing is disabled", () => {
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => routeOverlays,
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => false,
			getLockedSegmentIndexes: () => [],
			setCursor: vi.fn(),
		});

		interactions.attach();
		handlers.get("mousemove")?.({
			point: { x: 14, y: 1 },
		});

		expect(animationFrame.requestAnimationFrame).not.toHaveBeenCalled();
		expect(map.project).not.toHaveBeenCalled();
	});

	it("throttles hover hit testing to one frame with the latest point", () => {
		const { map, handlers } = createMapMock();
		const setCursor = vi.fn();
		const animationFrame = installAnimationFrameMock();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => routeOverlays,
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => true,
			getLockedSegmentIndexes: () => [],
			setCursor,
		});

		interactions.attach();
		handlers.get("mousemove")?.({ point: { x: 1, y: 100 } });
		handlers.get("mousemove")?.({ point: { x: 14, y: 1 } });

		expect(animationFrame.requestAnimationFrame).toHaveBeenCalledTimes(1);
		expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
		expect(map.project).not.toHaveBeenCalled();

		animationFrame.runFrame();

		expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
		expect(map.queryRenderedFeatures).toHaveBeenCalledWith([14, 1], {
			layers: [
				"planned-route-route-0-start",
				"planned-route-route-0-waypoint",
				"planned-route-route-0-destination",
			],
		});
		expect(map.project).toHaveBeenCalledTimes(3);
		expect(setCursor).toHaveBeenLastCalledWith("crosshair");
	});

	it("reuses projected route coordinates across unchanged hover frames", () => {
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => routeOverlays,
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => true,
			getLockedSegmentIndexes: () => [],
			setCursor: vi.fn(),
		});

		interactions.attach();
		handlers.get("mousemove")?.({ point: { x: 14, y: 1 } });
		animationFrame.runFrame(1);
		expect(map.project).toHaveBeenCalledTimes(3);

		map.project.mockClear();
		handlers.get("mousemove")?.({ point: { x: 4, y: 1 } });
		animationFrame.runFrame(2);

		expect(map.project).not.toHaveBeenCalled();
	});

	it("invalidates projected route coordinates on camera changes", () => {
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => routeOverlays,
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => true,
			getLockedSegmentIndexes: () => [],
			setCursor: vi.fn(),
		});

		interactions.attach();
		handlers.get("mousemove")?.({ point: { x: 14, y: 1 } });
		animationFrame.runFrame(1);
		expect(map.project).toHaveBeenCalledTimes(3);

		map.project.mockClear();
		handlers.get("move")?.({});
		handlers.get("mousemove")?.({ point: { x: 14, y: 1 } });
		animationFrame.runFrame(2);

		expect(map.project).toHaveBeenCalledTimes(3);
	});

	it("cancels pending hover hit testing on camera changes", () => {
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => routeOverlays,
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => true,
			getLockedSegmentIndexes: () => [],
			setCursor: vi.fn(),
		});

		interactions.attach();
		handlers.get("mousemove")?.({ point: { x: 14, y: 1 } });
		expect(animationFrame.getPendingFrameIds()).toEqual([1]);

		handlers.get("move")?.({});
		animationFrame.runFrame(1);

		expect(animationFrame.cancelAnimationFrame).toHaveBeenCalledWith(1);
		expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
		expect(map.project).not.toHaveBeenCalled();
	});

	it("cancels pending hover hit testing when a route drag starts", () => {
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		const setCursor = vi.fn();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => routeOverlays,
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => true,
			getLockedSegmentIndexes: () => [],
			setCursor,
		});

		interactions.attach();
		handlers.get("mousemove")?.({ point: { x: 1, y: 100 } });
		handlers.get("mousedown")?.({
			lngLat: { lng: 14, lat: 0 },
			point: { x: 14, y: 0 },
			preventDefault: vi.fn(),
		});
		animationFrame.runFrame(1);

		expect(animationFrame.cancelAnimationFrame).toHaveBeenCalledWith(1);
		expect(setCursor).toHaveBeenLastCalledWith("crosshair");
	});

	it("cancels pending hover hit testing on map click", () => {
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		const setCursor = vi.fn();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => routeOverlays,
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => true,
			getLockedSegmentIndexes: () => [],
			setCursor,
		});

		interactions.attach();
		handlers.get("mousemove")?.({ point: { x: 14, y: 1 } });
		handlers.get("click")?.({
			lngLat: { lng: 14, lat: 1 },
			point: { x: 14, y: 1 },
		});
		animationFrame.runFrame(1);

		expect(animationFrame.cancelAnimationFrame).toHaveBeenCalledWith(1);
		expect(setCursor).not.toHaveBeenCalled();
	});

	it("cancels pending hover frames and removes camera invalidation listeners on detach", () => {
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => routeOverlays,
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => true,
			getLockedSegmentIndexes: () => [],
			setCursor: vi.fn(),
		});

		interactions.attach();
		handlers.get("mousemove")?.({ point: { x: 14, y: 1 } });
		expect(animationFrame.getPendingFrameIds()).toEqual([1]);

		interactions.detach();

		expect(animationFrame.cancelAnimationFrame).toHaveBeenCalledWith(1);
		expect(animationFrame.getPendingFrameIds()).toEqual([]);
		for (const event of ["move", "zoom", "rotate", "pitch", "resize"]) {
			expect(map.off).toHaveBeenCalledWith(event, expect.any(Function));
		}
	});
});
