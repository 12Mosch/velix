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
import {
	sampleElevationProfile,
	type RouteCoordinate,
} from "$lib/route-planning";
import {
	resetSavedRoutesForTests,
	SAVED_ROUTES_STORAGE_KEY,
} from "$lib/saved-routes.svelte";

const successfulRoutePayload = {
	route: {
		startLabel: "Marienplatz, Munich, Germany",
		destinationLabel: "Schliersee, Germany",
		waypoints: [
			{
				label: "Tegernsee, Germany",
				coordinate: [11.7581, 47.7123, 734],
			},
		],
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
			{ from: 0, to: 4, value: "asphalt" },
			{ from: 4, to: 5, value: "fine gravel" },
		],
		smoothnessDetails: [{ from: 0, to: 5, value: "GOOD" }],
	},
};
const successfulRouteProfile = sampleElevationProfile(
	successfulRoutePayload.route.coordinates as RouteCoordinate[],
);
const successfulRouteEndProfilePoint =
	successfulRouteProfile[successfulRouteProfile.length - 1];

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
		resetSavedRoutesForTests();
		window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, "maptiler-outdoor");
		window.history.replaceState({}, "", "/");
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
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify(successfulRoutePayload)));
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await expect
			.element(page.getByRole("region", { name: "Route map" }))
			.toBeInTheDocument();
		await expect.element(page.getByText("Basemap")).toBeInTheDocument();
		await page
			.getByRole("textbox", { name: "Start" })
			.fill("Marienplatz Munich");
		await page.getByRole("button", { name: "Add waypoint" }).click();
		await page.getByRole("textbox", { name: "Waypoint 1" }).fill("Tegernsee");
		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		await expect.poll(() => document.body.textContent).toContain("61.2");
		await expect.poll(() => document.body.textContent).toContain("820");
		await expect.poll(() => document.body.textContent).toContain("740");
		await expect.poll(() => document.body.textContent).toContain("2:45");
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(1);
		await page.getByRole("button", { name: "Analysis" }).click();
		await expect
			.element(page.getByText(/GraphHopper bike/i))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("1. Tegernsee, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Smooth asphalt (80%)"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Mixed / worn (20%)"))
			.toBeInTheDocument();
		await page.getByRole("button", { name: "Save Draft" }).click();
		await expect
			.element(page.getByRole("button", { name: "Saved" }))
			.toBeInTheDocument();

		expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/route");
		const savedRoutes = JSON.parse(
			window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY) ?? "[]",
		);
		expect(savedRoutes).toHaveLength(1);
		expect(savedRoutes[0]?.route.startLabel).toBe(
			"Marienplatz, Munich, Germany",
		);
		expect(savedRoutes[0]?.route.destinationLabel).toBe("Schliersee, Germany");
		expect(savedRoutes[0]?.route.waypoints).toEqual([
			{
				label: "Tegernsee, Germany",
				coordinate: [11.7581, 47.7123, 734],
			},
		]);
		expect(
			JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
		).toMatchObject({
			startQuery: "Marienplatz Munich",
			waypointQueries: ["Tegernsee"],
			destinationQuery: "Schliersee",
		});
		expect(mapInstance.addLayer.mock.calls.map((call) => call[0].id)).toEqual([
			"planned-route-casing",
			"planned-route-line",
			"planned-route-start",
			"planned-route-waypoint",
			"planned-route-destination",
		]);
		expect(
			document.querySelector('path[d*="M 0 50 C 20 20, 40 80, 60 40"]'),
		).toBeNull();
		expect(document.body.textContent).not.toContain(
			"OpenStreetMap contributors",
		);

		await page.getByRole("button", { name: "Saved" }).click();
		await expect
			.element(page.getByRole("button", { name: "Save Draft" }))
			.toBeInTheDocument();
		expect(window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY)).toBeNull();
	});

	it("restores a saved route from the query string without recomputing it", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-route-1",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: successfulRoutePayload.route,
				},
			]),
		);
		window.history.replaceState({}, "", "/?savedRoute=saved-route-1");
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await expect.poll(() => document.body.textContent).toContain("61.2");
		await expect
			.element(page.getByRole("textbox", { name: "Start" }))
			.toHaveValue("Marienplatz, Munich, Germany");
		await expect
			.element(page.getByRole("textbox", { name: "Waypoint 1" }))
			.toHaveValue("Tegernsee, Germany");
		await expect
			.element(page.getByRole("textbox", { name: "Destination" }))
			.toHaveValue("Schliersee, Germany");
		await expect
			.element(page.getByRole("button", { name: "Saved" }))
			.toBeInTheDocument();
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("ignores an unknown saved-route id and keeps the planner empty", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-route-1",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: successfulRoutePayload.route,
				},
			]),
		);
		window.history.replaceState({}, "", "/?savedRoute=missing-route");

		render(PageTestShell);

		await expect
			.element(
				page.getByText(
					"Generate a route to see live distance, climbing, and elevation.",
				),
			)
			.toBeInTheDocument();
		expect(mapInstance.addSource).not.toHaveBeenCalled();
	});

	it("shows inline routing errors without clearing the existing map", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: "We couldn't resolve one or more locations.",
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
			.toHaveTextContent("We couldn't resolve one or more locations.");
		await expect
			.element(page.getByText("We couldn't resolve that start point."))
			.toBeInTheDocument();
		expect(mapInstance.addSource).not.toHaveBeenCalled();
	});

	it("supports reordering waypoints before submitting the route request", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify(successfulRoutePayload)));
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("textbox", { name: "Start" }).fill("Munich");
		await page.getByRole("button", { name: "Add waypoint" }).click();
		await page.getByRole("button", { name: "Add waypoint" }).click();
		await page.getByRole("textbox", { name: "Waypoint 1" }).fill("Bad Tolz");
		await page.getByRole("textbox", { name: "Waypoint 2" }).fill("Tegernsee");
		await page.getByRole("button", { name: "Move down" }).nth(0).click();
		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		expect(
			JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
		).toMatchObject({
			waypointQueries: ["Tegernsee", "Bad Tolz"],
		});
	});

	it("shows an inspected elevation readout and synced map marker while hovering the chart", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify(successfulRoutePayload)));
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("textbox", { name: "Start" }).fill("Munich");
		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(1);

		await page
			.getByRole("img", { name: "Elevation along route" })
			.hover({ position: { x: 1, y: 12 } });

		await expect.element(page.getByText("At 0.00 km")).toBeInTheDocument();
		await expect.element(page.getByText(/^520 m$/)).toBeInTheDocument();
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(2);
		expect(mapInstance.addLayer.mock.calls.map((call) => call[0].id)).toContain(
			"planned-route-hover-point",
		);

		await page.getByRole("button", { name: "Analysis" }).hover();

		await expect
			.poll(() =>
				mapInstance.removeSource.mock.calls.some(
					(call) => call[0] === "planned-route-hover",
				),
			)
			.toBe(true);
		await expect.element(page.getByText("At 0.00 km")).not.toBeInTheDocument();
	});

	it("supports touch scrubbing across the elevation chart", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify(successfulRoutePayload)));
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("textbox", { name: "Start" }).fill("Munich");
		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);

		const chart = page.getByRole("img", { name: "Elevation along route" });
		const chartElement = chart.element();
		const chartBounds = chartElement.getBoundingClientRect();

		if (!chartBounds || !successfulRouteEndProfilePoint) {
			throw new Error("Expected chart bounds and sampled profile data");
		}

		const pointerId = 7;
		const startY = chartBounds.y + chartBounds.height / 2;

		chartElement.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				pointerType: "touch",
				pointerId,
				clientX: chartBounds.x + 2,
				clientY: startY,
				buttons: 1,
				isPrimary: true,
			}),
		);
		chartElement.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				pointerType: "touch",
				pointerId,
				clientX: chartBounds.x + chartBounds.width - 2,
				clientY: startY,
				buttons: 1,
				isPrimary: true,
			}),
		);

		await expect
			.element(
				page.getByText(
					`At ${(
						(successfulRouteEndProfilePoint.distanceMeters ?? 0) / 1000
					).toFixed(2)} km`,
				),
			)
			.toBeInTheDocument();
		await expect
			.element(
				page.getByText(
					new RegExp(
						`^${Math.round(successfulRouteEndProfilePoint.elevationMeters).toLocaleString()} m$`,
					),
				),
			)
			.toBeInTheDocument();

		chartElement.dispatchEvent(
			new PointerEvent("pointerup", {
				bubbles: true,
				pointerType: "touch",
				pointerId,
				clientX: chartBounds.x + chartBounds.width - 2,
				clientY: startY,
				buttons: 0,
				isPrimary: true,
			}),
		);

		await expect
			.poll(() =>
				mapInstance.removeSource.mock.calls.some(
					(call) => call[0] === "planned-route-hover",
				),
			)
			.toBe(true);
	});
});
