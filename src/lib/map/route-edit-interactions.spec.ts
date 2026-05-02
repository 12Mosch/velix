import type { FeatureCollection } from "geojson";
import { describe, expect, it, vi } from "vitest";

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

describe("route edit interactions", () => {
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
});
