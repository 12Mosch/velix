import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_MAPTILER_API_KEY: "maptiler-test-key",
		PUBLIC_STADIA_MAPS_API_KEY: "stadia-test-key",
	},
}));

import PageTestShell from "./page-test-shell.svelte";
import {
	MAP_STYLE_STORAGE_KEY,
	resetMapStylePreferenceForTests,
} from "$lib/map-style-settings.svelte";

const successfulRoutePayload = {
	route: {
		startLabel: "Marienplatz, Munich, Germany",
		destinationLabel: "Schliersee, Germany",
		bounds: [11.5755, 47.7362, 11.8598, 48.1374],
		distanceMeters: 61234,
		durationMs: 9876000,
		ascendMeters: 820,
		descendMeters: 740,
		coordinates: [
			[11.5755, 48.1374, 520],
			[11.62, 48.1, 545],
			[11.68, 48.05, 600],
			[11.75, 47.98, 655],
			[11.81, 47.88, 720],
			[11.8598, 47.7362, 785],
		],
		surfaceDetails: [
			{ from: 0, to: 4, value: "ASPHALT" },
			{ from: 4, to: 5, value: "COMPACTED" },
		],
		smoothnessDetails: [{ from: 0, to: 5, value: "GOOD" }],
	},
};

const { mapInstance, mapMock, mockState } = vi.hoisted(() => {
	const sources = new Map<string, { data: unknown; setData: ReturnType<typeof vi.fn> }>();
	const layers = new Set<string>();

	const mapInstance = {
		once: vi.fn(),
		remove: vi.fn(),
		resize: vi.fn(),
		setStyle: vi.fn(),
		addSource: vi.fn((id: string, spec: { data: unknown }) => {
			sources.set(id, {
				data: spec.data,
				setData: vi.fn(),
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
		if (event === "load" || event === "style.load") callback();
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

describe("+page.svelte", () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetMapStylePreferenceForTests();
		window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, "maptiler-outdoor");
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
		vi.unstubAllGlobals();
	});

	it("submits the route form, updates the summary, and renders the route overlay", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify(successfulRoutePayload)),
		);
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await expect
			.element(page.getByRole("region", { name: "Route map" }))
			.toBeInTheDocument();
		await expect.element(page.getByText("Basemap")).toBeInTheDocument();
		await page.getByRole("textbox", { name: "Start" }).fill("Marienplatz Munich");
		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		await expect.poll(() => document.body.textContent).toContain("61.2");
		await expect.poll(() => document.body.textContent).toContain("820");
		await expect.poll(() => document.body.textContent).toContain("740");
		await expect.poll(() => document.body.textContent).toContain("2:45");
		await expect.element(page.getByText("GraphHopper")).toBeInTheDocument();
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(1);

		expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/route");
		expect(mapInstance.addLayer.mock.calls.map((call) => call[0].id)).toEqual([
			"planned-route-casing",
			"planned-route-line",
			"planned-route-start",
			"planned-route-destination",
		]);
		expect(
			document.querySelector('path[d*="M 0 50 C 20 20, 40 80, 60 40"]'),
		).toBeNull();
		expect(document.body.textContent).not.toContain("OpenStreetMap contributors");
	});

	it("shows inline routing errors without clearing the existing map", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(
					JSON.stringify({
						error: "We couldn't resolve one or both locations.",
						fieldErrors: {
							startQuery: "We couldn't resolve that start point.",
						},
					}),
					{ status: 422 },
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("textbox", { name: "Start" }).fill("Nowhere");
		await page.getByRole("textbox", { name: "Destination" }).fill("Munich");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("We couldn't resolve one or both locations.");
		await expect
			.element(page.getByText("We couldn't resolve that start point."))
			.toBeInTheDocument();
		expect(mapInstance.addSource).not.toHaveBeenCalled();
	});
});
