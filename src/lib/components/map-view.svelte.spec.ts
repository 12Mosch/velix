import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { FeatureCollection } from "geojson";

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_MAPTILER_API_KEY: "maptiler-test-key",
		PUBLIC_STADIA_MAPS_API_KEY: "stadia-test-key",
	},
}));

import MapView from "./map-view.svelte";
import {
	MAP_STYLE_STORAGE_KEY,
	resetMapStylePreferenceForTests,
	setMapStylePreference,
} from "$lib/map-style-settings.svelte";

const testRouteGeoJson: FeatureCollection = {
	type: "FeatureCollection",
	features: [
		{
			type: "Feature",
			properties: { kind: "route" },
			geometry: {
				type: "LineString",
				coordinates: [
					[11.5, 47.2, 700],
					[11.6, 47.25, 760],
				],
			},
		},
		{
			type: "Feature",
			properties: { kind: "start", label: "Start" },
			geometry: {
				type: "Point",
				coordinates: [11.5, 47.2, 700],
			},
		},
		{
			type: "Feature",
			properties: { kind: "waypoint", label: "Waypoint 1", order: 1 },
			geometry: {
				type: "Point",
				coordinates: [11.55, 47.225, 730],
			},
		},
		{
			type: "Feature",
			properties: { kind: "destination", label: "Destination" },
			geometry: {
				type: "Point",
				coordinates: [11.6, 47.25, 760],
			},
		},
	],
};
const hoveredRouteCoordinate: [number, number, number] = [11.57, 47.23, 735];

const { mapInstance, mapMock, mockState } = vi.hoisted(() => {
	const sources = new Map<
		string,
		{ data: unknown; setData: ReturnType<typeof vi.fn> }
	>();
	const layers = new Set<string>();
	const eventHandlers = new Map<string, ((event: unknown) => void)[]>();
	const renderedFeatures = new Map<string, unknown[]>();

	function getRenderedFeatureKey(point: { x?: number; y?: number } | number[]) {
		if (Array.isArray(point)) {
			return `${point[0] ?? 0},${point[1] ?? 0}`;
		}

		return `${point.x ?? 0},${point.y ?? 0}`;
	}

	const mapInstance = {
		on: vi.fn((event: string, callback: (event: unknown) => void) => {
			eventHandlers.set(event, [...(eventHandlers.get(event) ?? []), callback]);
			return mapInstance;
		}),
		off: vi.fn((event: string, callback: (event: unknown) => void) => {
			eventHandlers.set(
				event,
				(eventHandlers.get(event) ?? []).filter(
					(handler) => handler !== callback,
				),
			);
			return mapInstance;
		}),
		once: vi.fn(),
		remove: vi.fn(),
		resize: vi.fn(),
		queryRenderedFeatures: vi.fn(
			(point: { x?: number; y?: number } | number[]) =>
				renderedFeatures.get(getRenderedFeatureKey(point)) ?? [],
		),
		setStyle: vi.fn(),
		addSource: vi.fn((id: string, spec: { data: unknown }) => {
			sources.set(id, {
				data: spec.data,
				setData: vi.fn((nextData: unknown) => {
					const source = sources.get(id);
					if (source) {
						source.data = nextData;
					}
				}),
			});
			return mapInstance;
		}),
		getSource: vi.fn((id: string) => sources.get(id)),
		removeSource: vi.fn((id: string) => {
			sources.delete(id);
			return mapInstance;
		}),
		addLayer: vi.fn((layer: { id: string }) => {
			layers.add(layer.id);
			return mapInstance;
		}),
		getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
		removeLayer: vi.fn((id: string) => {
			layers.delete(id);
			return mapInstance;
		}),
		fitBounds: vi.fn(),
	};

	const mapMock = vi.fn(function MockMap(_options: unknown) {
		return mapInstance;
	});

	return {
		mapInstance,
		mapMock,
		mockState: {
			sources,
			layers,
			eventHandlers,
			renderedFeatures,
		},
	};
});

vi.mock("maplibre-gl", () => {
	mapMock.mockImplementation(function MockMap(_options: unknown) {
		return mapInstance;
	});
	mapInstance.once.mockImplementation((event: string, callback: () => void) => {
		if (event === "load" || event === "style.load") {
			callback();
		}

		return mapInstance;
	});
	mapInstance.setStyle.mockImplementation(() => {
		mockState.sources.clear();
		mockState.layers.clear();
		for (const callback of mockState.eventHandlers.get("style.load") ?? []) {
			callback({});
		}
		return mapInstance;
	});

	return {
		Map: mapMock,
		default: {
			Map: mapMock,
		},
	};
});

describe("MapView", () => {
	let consoleError: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		window.localStorage.clear();
		resetMapStylePreferenceForTests();
		mockState.sources.clear();
		mockState.layers.clear();
		mapMock.mockClear();
		mapInstance.once.mockClear();
		mapInstance.on.mockClear();
		mapInstance.off.mockClear();
		mapInstance.remove.mockClear();
		mapInstance.resize.mockClear();
		mapInstance.queryRenderedFeatures.mockClear();
		mapInstance.setStyle.mockClear();
		mapInstance.addSource.mockClear();
		mapInstance.getSource.mockClear();
		mapInstance.removeSource.mockClear();
		mapInstance.addLayer.mockClear();
		mapInstance.getLayer.mockClear();
		mapInstance.removeLayer.mockClear();
		mapInstance.fitBounds.mockClear();
		mockState.eventHandlers.clear();
		mockState.renderedFeatures.clear();
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("creates a map, adds the route overlay, and fits to the route bounds", async () => {
		window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, "maptiler-outdoor");

		const view = render(MapView, {
			ariaLabel: "Test map",
			initialCenter: [11.5, 47.2],
			initialZoom: 9,
			routeGeoJson: testRouteGeoJson,
			routeBounds: [11.5, 47.2, 11.6, 47.25],
		});

		await expect
			.element(page.getByRole("region", { name: "Test map" }))
			.toBeInTheDocument();
		await expect.poll(() => mapMock.mock.calls.length).toBe(1);
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(1);

		expect(mapInstance.addSource).toHaveBeenCalledWith(
			"planned-route",
			expect.objectContaining({
				type: "geojson",
				data: testRouteGeoJson,
			}),
		);
		expect(mapInstance.addLayer.mock.calls.map((call) => call[0].id)).toEqual([
			"planned-route-casing",
			"planned-route-line",
			"planned-route-start",
			"planned-route-waypoint",
			"planned-route-destination",
		]);
		expect(mapInstance.fitBounds).toHaveBeenCalledWith(
			[11.5, 47.2, 11.6, 47.25],
			expect.objectContaining({
				maxZoom: 14,
			}),
		);

		await view.unmount();

		expect(mapInstance.remove).toHaveBeenCalledTimes(1);
	});

	it("re-adds the route overlay after a basemap style change without recreating the map", async () => {
		render(MapView, {
			routeGeoJson: testRouteGeoJson,
			routeBounds: [11.5, 47.2, 11.6, 47.25],
			hoveredRouteCoordinate,
		});

		await expect.poll(() => mapMock.mock.calls.length).toBe(1);
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(2);

		expect(setMapStylePreference("maptiler-satellite-hybrid")).toBe(true);

		await expect.poll(() => mapInstance.setStyle.mock.calls.length).toBe(1);
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(4);
		expect(mapMock).toHaveBeenCalledTimes(1);
		expect(mapInstance.addLayer.mock.calls.at(-1)?.[0].id).toBe(
			"planned-route-hover-point",
		);
	});

	it("forwards map clicks through the callback prop", async () => {
		const onMapClick = vi.fn();

		render(MapView, {
			onMapClick,
		});

		await expect.poll(() => mapMock.mock.calls.length).toBe(1);

		const clickHandlers = mockState.eventHandlers.get("click") ?? [];
		expect(clickHandlers).toHaveLength(1);
		clickHandlers[0]?.({
			lngLat: {
				lng: 11.5755,
				lat: 48.1374,
			},
			point: {
				x: 320,
				y: 180,
			},
		});

		expect(onMapClick).toHaveBeenCalledWith({
			point: [11.5755, 48.1374],
			screenPoint: {
				x: 320,
				y: 180,
			},
		});
	});

	it("includes the clicked route stop metadata when a marker is hit", async () => {
		const onMapClick = vi.fn();
		mockState.renderedFeatures.set("320,180", [
			{
				properties: {
					kind: "waypoint",
					label: "Waypoint 1",
					order: 1,
				},
			},
		]);

		render(MapView, {
			onMapClick,
			routeGeoJson: testRouteGeoJson,
		});

		await expect.poll(() => mapMock.mock.calls.length).toBe(1);

		const clickHandlers = mockState.eventHandlers.get("click") ?? [];
		clickHandlers[0]?.({
			lngLat: {
				lng: 11.55,
				lat: 47.225,
			},
			point: {
				x: 320,
				y: 180,
			},
		});

		expect(onMapClick).toHaveBeenCalledWith({
			point: [11.55, 47.225],
			screenPoint: {
				x: 320,
				y: 180,
			},
			selectedStop: {
				kind: "waypoint",
				label: "Waypoint 1",
				index: 0,
			},
		});
	});

	it("adds and removes the hovered route marker when the inspected point changes", async () => {
		const view = render(MapView, {
			routeGeoJson: testRouteGeoJson,
			routeBounds: [11.5, 47.2, 11.6, 47.25],
			hoveredRouteCoordinate,
		});

		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(2);

		expect(mapInstance.addSource).toHaveBeenCalledWith(
			"planned-route-hover",
			expect.objectContaining({
				type: "geojson",
				data: expect.objectContaining({
					features: [
						expect.objectContaining({
							geometry: expect.objectContaining({
								type: "Point",
								coordinates: hoveredRouteCoordinate,
							}),
						}),
					],
				}),
			}),
		);
		expect(mapInstance.addLayer.mock.calls.map((call) => call[0].id)).toContain(
			"planned-route-hover-point",
		);

		await view.rerender({
			routeGeoJson: testRouteGeoJson,
			routeBounds: [11.5, 47.2, 11.6, 47.25],
			hoveredRouteCoordinate: null,
		});

		await expect
			.poll(() =>
				mapInstance.removeSource.mock.calls.some(
					(call) => call[0] === "planned-route-hover",
				),
			)
			.toBe(true);
		expect(mapInstance.removeLayer).toHaveBeenCalledWith(
			"planned-route-hover-point",
		);
	});

	it("handles constructor failures without throwing unhandled rejections", async () => {
		mapMock.mockImplementationOnce(() => {
			throw new Error("WebGL unavailable");
		});

		const view = render(MapView);

		await expect
			.element(page.getByRole("region", { name: "Route map" }))
			.toBeInTheDocument();
		await expect.poll(() => consoleError.mock.calls.length).toBe(1);
		await expect
			.element(page.getByRole("region", { name: "Route map" }))
			.toHaveAttribute("aria-busy", "false");

		expect(consoleError.mock.calls[0]?.[0]).toBe(
			"Failed to initialize MapLibre map",
		);
		expect(mapInstance.remove).not.toHaveBeenCalled();

		await view.unmount();
	});
});
