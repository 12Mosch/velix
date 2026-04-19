import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
			properties: { kind: "destination", label: "Destination" },
			geometry: {
				type: "Point",
				coordinates: [11.6, 47.25, 760],
			},
		},
	],
};

const { mapInstance, mapMock, mockState } = vi.hoisted(() => {
	const sources = new Map<
		string,
		{ data: unknown; setData: ReturnType<typeof vi.fn> }
	>();
	const layers = new Set<string>();

	const mapInstance = {
		once: vi.fn(),
		remove: vi.fn(),
		resize: vi.fn(),
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
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

	beforeEach(() => {
		window.localStorage.clear();
		resetMapStylePreferenceForTests();
		mockState.sources.clear();
		mockState.layers.clear();
		mapMock.mockClear();
		mapInstance.once.mockClear();
		mapInstance.remove.mockClear();
		mapInstance.resize.mockClear();
		mapInstance.setStyle.mockClear();
		mapInstance.addSource.mockClear();
		mapInstance.getSource.mockClear();
		mapInstance.removeSource.mockClear();
		mapInstance.addLayer.mockClear();
		mapInstance.getLayer.mockClear();
		mapInstance.removeLayer.mockClear();
		mapInstance.fitBounds.mockClear();
		consoleError.mockClear();
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
		});

		await expect.poll(() => mapMock.mock.calls.length).toBe(1);
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(1);

		expect(setMapStylePreference("maptiler-satellite-hybrid")).toBe(true);

		await expect.poll(() => mapInstance.setStyle.mock.calls.length).toBe(1);
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(2);
		expect(mapMock).toHaveBeenCalledTimes(1);
		expect(mapInstance.addLayer.mock.calls.at(-1)?.[0].id).toBe(
			"planned-route-destination",
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
