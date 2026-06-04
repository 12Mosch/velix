import type { FeatureCollection } from "geojson";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlannedRoute, RouteMapOverlay } from "$lib/route-planning";
import {
	createRouteEditInteractions,
	getPointToScreenSegmentDistance,
} from "$lib/map/route-edit-interactions";

const globalStubs: Array<{
	name: keyof typeof globalThis;
	descriptor: PropertyDescriptor | undefined;
}> = [];

function stubGlobal<T extends keyof typeof globalThis>(
	name: T,
	value: (typeof globalThis)[T],
) {
	globalStubs.push({
		name,
		descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
	});
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});
}

function restoreGlobalStubs() {
	for (const stub of globalStubs.splice(0).reverse()) {
		if (stub.descriptor) {
			Object.defineProperty(globalThis, stub.name, stub.descriptor);
		} else {
			Reflect.deleteProperty(globalThis, stub.name);
		}
	}
}

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

function createRouteOverlay(
	coordinates: Array<[number, number]>,
	options: { waypointIndexes?: number[] } = {},
): RouteMapOverlay {
	const waypointIndexes = options.waypointIndexes ?? [];
	return {
		id: "route-0",
		geoJson: {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					properties: { kind: "route" },
					geometry: {
						type: "LineString",
						coordinates,
					},
				},
				{
					type: "Feature",
					properties: { kind: "start", label: "Start" },
					geometry: { type: "Point", coordinates: coordinates[0] },
				},
				...waypointIndexes.map((coordinateIndex, index) => ({
					type: "Feature" as const,
					properties: { kind: "waypoint", label: `Waypoint ${index + 1}` },
					geometry: {
						type: "Point" as const,
						coordinates: coordinates[coordinateIndex],
					},
				})),
				{
					type: "Feature",
					properties: { kind: "destination", label: "End" },
					geometry: {
						type: "Point",
						coordinates: coordinates[coordinates.length - 1],
					},
				},
			],
		},
		bounds: [
			coordinates[0]?.[0] ?? 0,
			coordinates[0]?.[1] ?? 0,
			coordinates[coordinates.length - 1]?.[0] ?? 0,
			coordinates[coordinates.length - 1]?.[1] ?? 0,
		],
		isSelected: true,
	};
}

function createPlannedRoute(
	coordinates: Array<[number, number]>,
	options: { waypointIndexes?: number[] } = {},
): PlannedRoute {
	const waypointIndexes = options.waypointIndexes ?? [];
	return {
		mode: "point_to_point",
		source: { kind: "graphhopper" },
		startLabel: "Start",
		destinationLabel: "End",
		waypoints: waypointIndexes.map((coordinateIndex, index) => ({
			label: `Waypoint ${index + 1}`,
			coordinate: [
				coordinates[coordinateIndex]?.[0] ?? 0,
				coordinates[coordinateIndex]?.[1] ?? 0,
			],
		})),
		bounds: [
			coordinates[0]?.[0] ?? 0,
			coordinates[0]?.[1] ?? 0,
			coordinates[coordinates.length - 1]?.[0] ?? 0,
			coordinates[coordinates.length - 1]?.[1] ?? 0,
		],
		distanceMeters: 0,
		durationMs: 0,
		ascendMeters: 0,
		descendMeters: 0,
		coordinates,
		instructions: [],
		surfaceDetails: [],
		smoothnessDetails: [],
	};
}

function createMapMock() {
	const handlerSets = new Map<string, Set<(event: unknown) => void>>();
	const handlers = new Map<string, (event: unknown) => void>();
	const syncHandler = (event: string) => {
		const eventHandlers = handlerSets.get(event);
		if (!eventHandlers || eventHandlers.size === 0) {
			handlers.delete(event);
			return;
		}

		handlers.set(event, (payload) => {
			for (const handler of eventHandlers) {
				handler(payload);
			}
		});
	};
	const map = {
		on: vi.fn((event: string, handler: (event: unknown) => void) => {
			const eventHandlers = handlerSets.get(event) ?? new Set();
			eventHandlers.add(handler);
			handlerSets.set(event, eventHandlers);
			syncHandler(event);
			return map;
		}),
		off: vi.fn((event: string, handler: (event: unknown) => void) => {
			handlerSets.get(event)?.delete(handler);
			syncHandler(event);
			return map;
		}),
		project: vi.fn(([lng, lat]: [number, number]) => ({
			x: lng,
			y: lat,
		})),
		queryRenderedFeatures: vi.fn(
			(): Array<{ properties?: Record<string, unknown> }> => [],
		),
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

	stubGlobal("requestAnimationFrame", requestAnimationFrame as never);
	stubGlobal("cancelAnimationFrame", cancelAnimationFrame as never);

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

function installIdleCallbackMock() {
	const callbacks = new Map<number, IdleRequestCallback>();
	let nextIdleId = 1;
	const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
		const idleId = nextIdleId;
		nextIdleId += 1;
		callbacks.set(idleId, callback);
		return idleId;
	});
	const cancelIdleCallback = vi.fn((idleId: number) => {
		callbacks.delete(idleId);
	});

	stubGlobal("requestIdleCallback", requestIdleCallback as never);
	stubGlobal("cancelIdleCallback", cancelIdleCallback as never);

	return {
		requestIdleCallback,
		cancelIdleCallback,
		runIdle(idleId = 1) {
			const callback = callbacks.get(idleId);
			callbacks.delete(idleId);
			callback?.({
				didTimeout: false,
				timeRemaining: () => 10,
			});
		},
		getPendingIdleIds() {
			return [...callbacks.keys()];
		},
	};
}

describe("route edit interactions", () => {
	afterEach(() => {
		restoreGlobalStubs();
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
		installIdleCallbackMock();
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
		installIdleCallbackMock();
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
		installIdleCallbackMock();
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

	it("builds the grid once and reuses it for nearby hover candidates", () => {
		const coordinates = Array.from({ length: 1002 }, (_, index) => [
			index,
			0,
		]) as Array<[number, number]>;
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		const idleCallback = installIdleCallbackMock();
		const setCursor = vi.fn();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => [createRouteOverlay(coordinates)],
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => true,
			getLockedSegmentIndexes: () => [],
			setCursor,
		});

		interactions.attach();
		idleCallback.runIdle();
		expect(map.project).toHaveBeenCalledTimes(coordinates.length);

		map.project.mockClear();
		handlers.get("mousemove")?.({ point: { x: 700.5, y: 1 } });
		animationFrame.runFrame();

		expect(map.project).not.toHaveBeenCalled();
		expect(setCursor).toHaveBeenLastCalledWith("crosshair");
	});

	it("selects the correct grid segment among many coordinates", () => {
		const coordinates = Array.from({ length: 1000 }, (_, index) => [
			index,
			0,
		]) as Array<[number, number]>;
		const { map, handlers } = createMapMock();
		const onRouteSegmentSelection = vi.fn();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => [createRouteOverlay(coordinates)],
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => false,
			getLockedSegmentIndexes: () => [],
			setCursor: vi.fn(),
			onRouteSegmentSelection,
		});

		interactions.attach();
		handlers.get("click")?.({
			lngLat: { lng: 700.5, lat: 1 },
			point: { x: 700.5, y: 1 },
		});

		expect(onRouteSegmentSelection).toHaveBeenCalledWith({
			point: [700.5, 1],
			screenPoint: { x: 700.5, y: 1 },
			coordinateSegmentIndex: 700,
			segmentIndex: 0,
		});
	});

	it("rejects grid candidates outside the route segment threshold", () => {
		const coordinates = Array.from({ length: 1000 }, (_, index) => [
			index,
			0,
		]) as Array<[number, number]>;
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		installIdleCallbackMock();
		const setCursor = vi.fn();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => [createRouteOverlay(coordinates)],
			getPlannedRoute: () => null,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => true,
			getLockedSegmentIndexes: () => [],
			setCursor,
		});

		interactions.attach();
		handlers.get("mousemove")?.({ point: { x: 700.5, y: 30 } });
		animationFrame.runFrame();

		expect(setCursor).toHaveBeenLastCalledWith("");
	});

	it("cancels pending hover hit testing on camera changes", () => {
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		installIdleCallbackMock();
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

	it("cancels pending hit-test index warm-up on detach", () => {
		const { map } = createMapMock();
		const idleCallback = installIdleCallbackMock();
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
		expect(idleCallback.getPendingIdleIds()).toEqual([1]);

		interactions.detach();

		expect(idleCallback.cancelIdleCallback).toHaveBeenCalledWith(1);
		expect(idleCallback.getPendingIdleIds()).toEqual([]);
	});

	it("keeps rendered stops above route segment grid hits", () => {
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		installIdleCallbackMock();
		const setCursor = vi.fn();
		const preventDefault = vi.fn();
		map.queryRenderedFeatures.mockReturnValue([
			{
				properties: {
					kind: "waypoint",
					label: "Waypoint",
					order: 1,
				},
			},
		]);
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
		handlers.get("mousemove")?.({ point: { x: 10, y: 0 } });
		animationFrame.runFrame();
		handlers.get("mousedown")?.({
			lngLat: { lng: 10, lat: 0 },
			point: { x: 10, y: 0 },
			preventDefault,
		});

		expect(setCursor).toHaveBeenCalledWith("grab");
		expect(setCursor).toHaveBeenLastCalledWith("grabbing");
		expect(preventDefault).toHaveBeenCalled();
		expect(map.dragPan.disable).toHaveBeenCalled();
		expect(map.project).not.toHaveBeenCalled();
	});

	it("maps grid segment hits to planned editable legs", () => {
		const coordinates = Array.from({ length: 1000 }, (_, index) => [
			index,
			0,
		]) as Array<[number, number]>;
		const plannedRoute = createPlannedRoute(coordinates, {
			waypointIndexes: [500],
		});
		const { map, handlers } = createMapMock();
		const onRouteSegmentSelection = vi.fn();
		const interactions = createRouteEditInteractions({
			map: map as never,
			getRouteOverlays: () => [
				createRouteOverlay(coordinates, { waypointIndexes: [500] }),
			],
			getPlannedRoute: () => plannedRoute,
			getRouteMode: () => "point_to_point",
			getManualEditingEnabled: () => false,
			getLockedSegmentIndexes: () => [],
			setCursor: vi.fn(),
			onRouteSegmentSelection,
		});

		interactions.attach();
		handlers.get("click")?.({
			lngLat: { lng: 700.5, lat: 1 },
			point: { x: 700.5, y: 1 },
		});

		expect(onRouteSegmentSelection).toHaveBeenCalledWith({
			point: [700.5, 1],
			screenPoint: { x: 700.5, y: 1 },
			coordinateSegmentIndex: 700,
			segmentIndex: 1,
		});
	});

	it("cancels pending hover hit testing when a route drag starts", () => {
		const { map, handlers } = createMapMock();
		const animationFrame = installAnimationFrameMock();
		installIdleCallbackMock();
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
		installIdleCallbackMock();
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
		const idleCallback = installIdleCallbackMock();
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
		expect(idleCallback.getPendingIdleIds()).toEqual([1]);

		interactions.detach();

		expect(animationFrame.cancelAnimationFrame).toHaveBeenCalledWith(1);
		expect(idleCallback.cancelIdleCallback).toHaveBeenCalledWith(1);
		expect(animationFrame.getPendingFrameIds()).toEqual([]);
		expect(idleCallback.getPendingIdleIds()).toEqual([]);
		for (const event of ["move", "zoom", "rotate", "pitch", "resize"]) {
			expect(map.off).toHaveBeenCalledWith(event, expect.any(Function));
		}
		for (const event of ["moveend", "zoomend", "rotateend", "pitchend"]) {
			expect(map.off).toHaveBeenCalledWith(event, expect.any(Function));
		}
	});
});
