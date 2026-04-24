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
import { parseRouteGpx } from "$lib/route-gpx-import";
import {
	sampleElevationProfile,
	type RouteCoordinate,
} from "$lib/route-planning";
import {
	resetSavedRoutesForTests,
	SAVED_ROUTES_STORAGE_KEY,
} from "$lib/saved-routes.svelte";

const successfulRoute = {
	mode: "point_to_point",
	source: {
		kind: "graphhopper",
	},
	startLabel: "Marienplatz, Munich, Germany",
	destinationLabel: "Schliersee, Germany",
	routingProfile: "racingbike",
	routingStrategy:
		"GraphHopper racingbike with asphalt-first, lower-traffic road-bike tuning.",
	routingWarnings: [],
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
};
const successfulRoutePayload = {
	routes: [successfulRoute],
	selectedRouteIndex: 0,
};
const alternativeRoutePayload = {
	routes: [
		successfulRoute,
		{
			...successfulRoute,
			distanceMeters: 68450,
			durationMs: 10500000,
			ascendMeters: 940,
			descendMeters: 860,
			coordinates: [
				[11.5755, 48.1374, 520],
				[11.6, 48.11, 540],
				[11.7, 48.03, 610],
				[11.82, 47.89, 740],
				[11.8598, 47.7362, 790],
			],
			routingWarnings: ["Alternative route warning."],
			bounds: [11.5755, 47.7362, 11.8598, 48.1374],
		},
	],
	selectedRouteIndex: 0,
};
const successfulRoundCourseRoute = {
	mode: "round_course",
	source: {
		kind: "graphhopper",
	},
	startLabel: "Marienplatz, Munich, Germany",
	destinationLabel: "Marienplatz, Munich, Germany",
	roundCourseTarget: {
		kind: "distance",
		distanceMeters: 50000,
	},
	routingProfile: "racingbike",
	routingStrategy:
		"GraphHopper racingbike with asphalt-first, lower-traffic road-bike tuning.",
	routingWarnings: [],
	waypoints: [],
	bounds: [11.55, 48.08, 11.69, 48.17],
	distanceMeters: 50123,
	durationMs: 7420000,
	ascendMeters: 540,
	descendMeters: 540,
	coordinates: [
		[11.5755, 48.1374, 520],
		[11.62, 48.15, 580],
		[11.67, 48.11, 610],
		[11.5755, 48.1374, 520],
	],
	surfaceDetails: [
		{ from: 0, to: 3, value: "asphalt" },
		{ from: 3, to: 4, value: "fine gravel" },
	],
	smoothnessDetails: [{ from: 0, to: 4, value: "GOOD" }],
};
const successfulRoundCoursePayload = {
	routes: [successfulRoundCourseRoute],
	selectedRouteIndex: 0,
};
const successfulRouteProfile = sampleElevationProfile(
	successfulRoute.coordinates as RouteCoordinate[],
);
const successfulRouteEndProfilePoint =
	successfulRouteProfile[successfulRouteProfile.length - 1];
const suggestionPayload = {
	suggestions: [
		{
			label: "Marienplatz, Munich, Germany",
			point: [11.5755, 48.1374],
		},
		{
			label: "Marienplatz station, Munich, Germany",
			point: [11.576, 48.138],
		},
	],
};
const importedWaypointGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="48.1374" lon="11.5755"><name>Marienplatz, Munich, Germany</name></wpt>
  <wpt lat="47.7123" lon="11.7581"><name>Tegernsee, Germany</name></wpt>
  <wpt lat="47.7362" lon="11.8598"><name>Schliersee, Germany</name></wpt>
  <trk>
    <name>Imported Ride</name>
    <trkseg>
      <trkpt lat="48.1374" lon="11.5755"><ele>520</ele><time>2026-04-22T08:00:00Z</time></trkpt>
      <trkpt lat="47.7123" lon="11.7581"><ele>734</ele><time>2026-04-22T09:15:00Z</time></trkpt>
      <trkpt lat="47.7362" lon="11.8598"><ele>785</ele><time>2026-04-22T10:45:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;
const importedTrackOnlyGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Track only</name>
    <trkseg>
      <trkpt lat="48.1374" lon="11.5755"><ele>520</ele></trkpt>
      <trkpt lat="48.1" lon="11.62"><ele>545</ele></trkpt>
      <trkpt lat="47.7362" lon="11.8598"><ele>785</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;
const invalidGpx = `<gpx><trk><trkseg><trkpt lat="48.1374" lon="11.5755"></gpx>`;

async function importGpxFile(name: string, contents: string) {
	await page
		.getByLabelText("Import GPX file")
		.upload(new File([contents], name, { type: "application/gpx+xml" }));
}

function setupGpxDownloadSpies(options: { clickError?: Error } = {}) {
	const createObjectUrl = vi.fn((blob: Blob) => {
		(window as Window & { __lastGpxBlob?: Blob }).__lastGpxBlob = blob;
		return "blob:velix-test-route";
	});
	const revokeObjectUrl = vi.fn();
	let clickedDownload = "";
	let clickedHref = "";
	const anchorClick = vi
		.spyOn(HTMLAnchorElement.prototype, "click")
		.mockImplementation(function mockClick(this: HTMLAnchorElement) {
			if (options.clickError) {
				throw options.clickError;
			}

			clickedDownload = this.download;
			clickedHref = this.href;
		});

	Object.defineProperty(URL, "createObjectURL", {
		configurable: true,
		writable: true,
		value: createObjectUrl,
	});
	Object.defineProperty(URL, "revokeObjectURL", {
		configurable: true,
		writable: true,
		value: revokeObjectUrl,
	});

	return {
		createObjectUrl,
		revokeObjectUrl,
		anchorClick,
		getClickedDownload: () => clickedDownload,
		getClickedHref: () => clickedHref,
		getLastBlob: () =>
			(window as Window & { __lastGpxBlob?: Blob }).__lastGpxBlob ?? null,
	};
}

function mockCurrentPositionSequence(
	positions: Array<{
		lng: number;
		lat: number;
		accuracy?: number;
	}>,
) {
	let positionIndex = 0;
	const getCurrentPosition = vi.fn(
		(success: PositionCallback, _error?: PositionErrorCallback | null) => {
			const position = positions[Math.min(positionIndex, positions.length - 1)];
			positionIndex += 1;

			if (!position) {
				throw new Error("No mocked current position configured.");
			}

			success({
				coords: {
					latitude: position.lat,
					longitude: position.lng,
					accuracy: position.accuracy ?? 12,
					altitude: null,
					altitudeAccuracy: null,
					heading: null,
					speed: null,
				},
				timestamp: Date.now(),
			} as GeolocationPosition);
		},
	);

	Object.defineProperty(window.navigator, "geolocation", {
		configurable: true,
		value: {
			getCurrentPosition,
		},
	});

	return getCurrentPosition;
}

function mockCurrentPositionError() {
	const getCurrentPosition = vi.fn(
		(_success: PositionCallback, error?: PositionErrorCallback | null) => {
			error?.({
				code: 1,
				message: "Permission denied",
				PERMISSION_DENIED: 1,
				POSITION_UNAVAILABLE: 2,
				TIMEOUT: 3,
			} as GeolocationPositionError);
		},
	);

	Object.defineProperty(window.navigator, "geolocation", {
		configurable: true,
		value: {
			getCurrentPosition,
		},
	});

	return getCurrentPosition;
}

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
		easeTo: vi.fn(),
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
		mapInstance.easeTo.mockClear();
		mockState.eventHandlers.clear();
		mockState.renderedFeatures.clear();
		vi.unstubAllGlobals();
		Object.defineProperty(window.navigator, "geolocation", {
			configurable: true,
			value: undefined,
		});
	});

	it("submits the route form, updates the summary, and renders the route overlay", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/suggest")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			return Promise.resolve(
				new Response(JSON.stringify(successfulRoutePayload)),
			);
		});
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

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		await expect.poll(() => document.body.textContent).toContain("61.2");
		await expect.poll(() => document.body.textContent).toContain("820");
		await expect.poll(() => document.body.textContent).toContain("740");
		await expect.poll(() => document.body.textContent).toContain("2:45");
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(1);
		await page.getByRole("button", { name: "Analysis" }).click();
		await expect
			.element(page.getByText(/GraphHopper racingbike/i))
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

		const routeCalls = fetchMock.mock.calls.filter(
			(call) => String(call[0]) === "/api/route",
		);
		expect(routeCalls[0]?.[0]).toBe("/api/route");
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
		expect(JSON.parse(String(routeCalls[0]?.[1]?.body))).toMatchObject({
			mode: "point_to_point",
			start: {
				label: "Marienplatz Munich",
			},
			waypoints: [
				{
					label: "Tegernsee",
				},
			],
			destination: {
				label: "Schliersee",
			},
		});
		expect(mapInstance.addLayer.mock.calls.map((call) => call[0].id)).toEqual([
			"planned-route-route-0-casing",
			"planned-route-route-0-line",
			"planned-route-route-0-start",
			"planned-route-route-0-waypoint",
			"planned-route-route-0-destination",
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
					route: successfulRoute,
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

	it("lets the user switch between generated route alternatives", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/suggest")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			return Promise.resolve(
				new Response(JSON.stringify(alternativeRoutePayload)),
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("textbox", { name: "Start" }).fill("Munich");
		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		await expect.element(page.getByText("Alternatives")).toBeInTheDocument();
		await expect
			.element(page.getByText("Found 2 distinct routes for this request."))
			.toBeInTheDocument();
		await expect.poll(() => document.body.textContent).toContain("61.2");
		await page.getByRole("button", { name: /Route 2/i }).click();
		await expect.poll(() => document.body.textContent).toContain("68.5");
		await expect
			.element(page.getByText("Alternative route warning."))
			.toBeInTheDocument();
	});

	it("imports a GPX file, fills the planner, and saves the imported metadata", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await importGpxFile("alpine-import.gpx", importedWaypointGpx);

		await expect
			.element(page.getByRole("textbox", { name: "Start" }))
			.toHaveValue("Marienplatz, Munich, Germany");
		await expect
			.element(page.getByRole("textbox", { name: "Waypoint 1" }))
			.toHaveValue("Tegernsee, Germany");
		await expect
			.element(page.getByRole("textbox", { name: "Destination" }))
			.toHaveValue("Schliersee, Germany");
		await expect.element(page.getByText("Imported GPX")).toBeInTheDocument();
		await expect
			.element(page.getByText("alpine-import.gpx"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Stops loaded from GPX waypoints."))
			.toBeInTheDocument();
		await expect
			.element(
				page.getByText("Edit stops, then Generate Route to recalculate."),
			)
			.toBeInTheDocument();
		await expect.element(page.getByText("2:45 h")).toBeInTheDocument();
		await expect.poll(() => mapInstance.addSource.mock.calls.length).toBe(1);

		await page.getByRole("button", { name: "Save Draft" }).click();

		const savedRoutes = JSON.parse(
			window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY) ?? "[]",
		);
		expect(savedRoutes[0]?.route.source).toEqual({
			kind: "gpx_import",
			filename: "alpine-import.gpx",
			stopDerivation: "wpt",
			hasDuration: true,
		});
	});

	it("imports a track-only GPX, shows duration fallback, and replaces it after re-routing", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			if (String(input) === "/api/route") {
				return Promise.resolve(
					new Response(JSON.stringify(successfulRoutePayload)),
				);
			}

			throw new Error(`Unexpected fetch request: ${String(input)}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await importGpxFile("track-only.gpx", importedTrackOnlyGpx);

		await expect
			.element(page.getByRole("textbox", { name: "Start" }))
			.toHaveValue("48.13740, 11.57550");
		await expect
			.element(page.getByRole("textbox", { name: "Destination" }))
			.toHaveValue("47.73620, 11.85980");
		await expect
			.element(page.getByText("Stops inferred from track."))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Time unavailable"))
			.toBeInTheDocument();

		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		await expect.poll(() => document.body.textContent).toContain("61.2");
		await expect
			.element(page.getByText("Time unavailable"))
			.not.toBeInTheDocument();
		await expect
			.element(
				page.getByText("Edit stops, then Generate Route to recalculate."),
			)
			.not.toBeInTheDocument();
	});

	it("shows an alert when GPX import fails", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await importGpxFile("broken.gpx", invalidGpx);

		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("The selected file is not valid GPX XML.");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("restores a saved imported GPX route with its metadata and stop values", async () => {
		const importedRoute = parseRouteGpx(importedWaypointGpx, {
			filename: "saved-import.gpx",
		});
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-import",
					createdAt: "2026-04-23T08:00:00.000Z",
					route: importedRoute,
				},
			]),
		);
		window.history.replaceState({}, "", "/?savedRoute=saved-import");
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

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
			.element(page.getByText("saved-import.gpx"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Stops loaded from GPX waypoints."))
			.toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("exports the active route as a GPX download", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/suggest")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			if (url === "/api/route") {
				return Promise.resolve(
					new Response(JSON.stringify(successfulRoutePayload)),
				);
			}

			throw new Error(`Unexpected fetch request: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		const downloadSpy = setupGpxDownloadSpies();

		render(PageTestShell);

		await page
			.getByRole("textbox", { name: "Start" })
			.fill("Marienplatz Munich");
		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		await page.getByRole("button", { name: "Export GPX" }).click();

		expect(downloadSpy.createObjectUrl).toHaveBeenCalledTimes(1);
		expect(downloadSpy.anchorClick).toHaveBeenCalledTimes(1);
		expect(downloadSpy.getClickedDownload()).toBe(
			"marienplatz-munich-germany-to-schliersee-germany.gpx",
		);
		expect(downloadSpy.getClickedHref()).toBe("blob:velix-test-route");
		expect(downloadSpy.revokeObjectUrl).toHaveBeenCalledWith(
			"blob:velix-test-route",
		);

		const blob = downloadSpy.getLastBlob();
		expect(blob).toBeInstanceOf(Blob);
		expect(blob?.type).toBe("application/gpx+xml;charset=utf-8");
		const gpx = await blob?.text();
		expect(gpx).toContain("<gpx");
		expect(gpx).toContain("<trk>");
		expect(gpx).toContain("<trkpt");
		expect(gpx).toContain("Marienplatz, Munich, Germany");
		expect(gpx).toContain("Schliersee, Germany");
	});

	it("shows an alert when GPX export fails", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/suggest")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			if (url === "/api/route") {
				return Promise.resolve(
					new Response(JSON.stringify(successfulRoutePayload)),
				);
			}

			throw new Error(`Unexpected fetch request: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		const downloadSpy = setupGpxDownloadSpies({
			clickError: new Error("Download blocked"),
		});

		render(PageTestShell);

		await page
			.getByRole("textbox", { name: "Start" })
			.fill("Marienplatz Munich");
		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		await page.getByRole("button", { name: "Export GPX" }).click();

		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("Could not export GPX: Download blocked");
		expect(downloadSpy.createObjectUrl).toHaveBeenCalledTimes(1);
		expect(downloadSpy.revokeObjectUrl).toHaveBeenCalledWith(
			"blob:velix-test-route",
		);
	});

	it("switches into round-course mode, submits the loop payload, and saves it", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			if (String(input).startsWith("/api/route/suggest")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			return Promise.resolve(
				new Response(JSON.stringify(successfulRoundCoursePayload)),
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("button", { name: /Round course/i }).click();
		await expect
			.element(page.getByRole("textbox", { name: "Start" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("spinbutton", { name: "Target distance" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("textbox", { name: "Destination" }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: "Add waypoint" }))
			.not.toBeInTheDocument();

		await page
			.getByRole("textbox", { name: "Start" })
			.fill("Marienplatz Munich");
		await page.getByRole("spinbutton", { name: "Target distance" }).fill("50");
		await page.getByRole("button", { name: "Generate Round Course" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		expect(
			JSON.parse(
				String(
					fetchMock.mock.calls.find(
						(call) => String(call[0]) === "/api/route",
					)?.[1]?.body,
				),
			),
		).toMatchObject({
			mode: "round_course",
			start: {
				label: "Marienplatz Munich",
			},
			target: {
				kind: "distance",
				distanceMeters: 50000,
			},
		});

		await expect
			.element(page.getByText("Returns to start"))
			.toBeInTheDocument();
		await page.getByRole("button", { name: "Save Draft" }).click();

		const savedRoutes = JSON.parse(
			window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY) ?? "[]",
		);
		expect(savedRoutes[0]?.route.mode).toBe("round_course");
		expect(savedRoutes[0]?.route.roundCourseTarget).toEqual({
			kind: "distance",
			distanceMeters: 50000,
		});
	});

	it("submits a duration-based round-course payload", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			if (String(input).startsWith("/api/route/suggest")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			return Promise.resolve(
				new Response(
					JSON.stringify({
						route: {
							...successfulRoundCourseRoute,
							roundCourseTarget: {
								kind: "duration",
								durationMs: 3.5 * 60 * 60 * 1000,
							},
							durationMs: 3.5 * 60 * 60 * 1000,
						},
					}),
				),
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("button", { name: /Round course/i }).click();
		await page.getByRole("button", { name: "Time" }).click();
		await page.getByRole("textbox", { name: "Target time" }).fill("3:30");
		await page
			.getByRole("textbox", { name: "Start" })
			.fill("Marienplatz Munich");
		await page.getByRole("button", { name: "Generate Round Course" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		expect(
			JSON.parse(
				String(
					fetchMock.mock.calls.find(
						(call) => String(call[0]) === "/api/route",
					)?.[1]?.body,
				),
			),
		).toMatchObject({
			mode: "round_course",
			target: {
				kind: "duration",
				durationMs: 12600000,
			},
		});
	});

	it("submits an ascent-based round-course payload", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			if (String(input).startsWith("/api/route/suggest")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			return Promise.resolve(
				new Response(
					JSON.stringify({
						route: {
							...successfulRoundCourseRoute,
							roundCourseTarget: {
								kind: "ascend",
								ascendMeters: 800,
							},
							ascendMeters: 800,
						},
					}),
				),
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("button", { name: /Round course/i }).click();
		await page.getByRole("button", { name: "Climb" }).click();
		await page.getByRole("spinbutton", { name: "Target climb" }).fill("800");
		await page
			.getByRole("textbox", { name: "Start" })
			.fill("Marienplatz Munich");
		await page.getByRole("button", { name: "Generate Round Course" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		expect(
			JSON.parse(
				String(
					fetchMock.mock.calls.find(
						(call) => String(call[0]) === "/api/route",
					)?.[1]?.body,
				),
			),
		).toMatchObject({
			mode: "round_course",
			target: {
				kind: "ascend",
				ascendMeters: 800,
			},
		});
	});

	it("restores a saved round course from the query string", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-round-course",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: successfulRoundCourseRoute,
				},
			]),
		);
		window.history.replaceState({}, "", "/?savedRoute=saved-round-course");
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await expect.poll(() => document.body.textContent).toContain("50.1");
		await expect
			.element(
				page.getByRole("button", { name: /Round course Loop from one/i }),
			)
			.toHaveAttribute("aria-pressed", "true");
		await expect
			.element(page.getByRole("spinbutton", { name: "Target distance" }))
			.toHaveValue(50);
		await expect
			.element(page.getByText("Returns to start"))
			.toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("ignores an unknown saved-route id and keeps the planner empty", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-route-1",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: successfulRoute,
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
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/suggest")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			return Promise.resolve(
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
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("textbox", { name: "Start" }).fill("Nowhere");
		await page.getByRole("textbox", { name: "Destination" }).fill("Munich");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("We couldn't resolve one or more locations.");
		await expect
			.element(page.getByText("We couldn't resolve that start point."))
			.toBeInTheDocument();
		expect(mapInstance.addSource).not.toHaveBeenCalled();
	});

	it("supports reordering waypoints before submitting the route request", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/suggest")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			return Promise.resolve(
				new Response(JSON.stringify(successfulRoutePayload)),
			);
		});
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

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		const routeCalls = fetchMock.mock.calls.filter(
			(call) => String(call[0]) === "/api/route",
		);
		expect(JSON.parse(String(routeCalls[0]?.[1]?.body))).toMatchObject({
			waypoints: [{ label: "Tegernsee" }, { label: "Bad Tolz" }],
		});
	});

	it("can set start and destination from map clicks and submit exact coordinates", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/reverse?")) {
				const searchParams = new URL(`http://localhost${url}`).searchParams;
				const lat = Number(searchParams.get("lat"));
				const lng = Number(searchParams.get("lng"));

				return Promise.resolve(
					new Response(
						JSON.stringify({
							label:
								lat > 48
									? "Marienplatz, Munich, Germany"
									: "Schliersee, Germany",
							point: [lng, lat],
						}),
					),
				);
			}

			if (url === "/api/route") {
				return Promise.resolve(
					new Response(JSON.stringify(successfulRoutePayload)),
				);
			}

			throw new Error(`Unexpected fetch request: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);
		await expect.poll(() => mapMock.mock.calls.length).toBe(1);
		await expect
			.poll(() => (mockState.eventHandlers.get("click") ?? []).length)
			.toBe(1);

		mockState.eventHandlers.get("click")?.[0]?.({
			lngLat: {
				lng: 11.5755,
				lat: 48.1374,
			},
			point: {
				x: 320,
				y: 180,
			},
		});
		await page.getByRole("button", { name: "Set as start" }).click();
		await expect
			.element(page.getByRole("textbox", { name: "Start" }))
			.toHaveValue("Marienplatz, Munich, Germany");

		mockState.eventHandlers.get("click")?.[0]?.({
			lngLat: {
				lng: 11.8598,
				lat: 47.7362,
			},
			point: {
				x: 520,
				y: 260,
			},
		});
		await page.getByRole("button", { name: "Set as destination" }).click();
		await expect
			.element(page.getByRole("textbox", { name: "Destination" }))
			.toHaveValue("Schliersee, Germany");

		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);

		expect(
			JSON.parse(
				String(
					fetchMock.mock.calls.find(
						(call) => String(call[0]) === "/api/route",
					)?.[1]?.body,
				),
			),
		).toMatchObject({
			start: {
				label: "Marienplatz, Munich, Germany",
				point: [11.5755, 48.1374],
			},
			destination: {
				label: "Schliersee, Germany",
				point: [11.8598, 47.7362],
			},
		});
	});

	it("can set start and destination from current location and submit exact coordinates", async () => {
		const getCurrentPosition = mockCurrentPositionSequence([
			{
				lng: 11.5755,
				lat: 48.1374,
				accuracy: 15,
			},
			{
				lng: 11.8598,
				lat: 47.7362,
				accuracy: 20,
			},
		]);
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/reverse?")) {
				const searchParams = new URL(`http://localhost${url}`).searchParams;
				const lat = Number(searchParams.get("lat"));
				const lng = Number(searchParams.get("lng"));

				return Promise.resolve(
					new Response(
						JSON.stringify({
							label:
								lat > 48
									? "Marienplatz, Munich, Germany"
									: "Schliersee, Germany",
							point: [lng, lat],
						}),
					),
				);
			}

			if (url === "/api/route") {
				return Promise.resolve(
					new Response(JSON.stringify(successfulRoutePayload)),
				);
			}

			throw new Error(`Unexpected fetch request: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page
			.getByRole("button", { name: "Use current location as start" })
			.click();
		await expect
			.element(page.getByRole("textbox", { name: "Start" }))
			.toHaveValue("Marienplatz, Munich, Germany");
		await expect
			.poll(() =>
				mapInstance.addSource.mock.calls.some(
					(call) => call[0] === "current-location",
				),
			)
			.toBe(true);
		expect(mapInstance.easeTo).toHaveBeenCalledWith({
			center: [11.5755, 48.1374],
			zoom: 14,
			duration: 600,
		});

		await page
			.getByRole("button", { name: "Use current location as destination" })
			.click();
		await expect
			.element(page.getByRole("textbox", { name: "Destination" }))
			.toHaveValue("Schliersee, Germany");

		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		expect(getCurrentPosition).toHaveBeenCalledTimes(2);
		expect(
			fetchMock.mock.calls.filter((call) =>
				String(call[0]).startsWith("/api/route/reverse?"),
			),
		).toHaveLength(2);
		expect(
			JSON.parse(
				String(
					fetchMock.mock.calls.find(
						(call) => String(call[0]) === "/api/route",
					)?.[1]?.body,
				),
			),
		).toMatchObject({
			start: {
				label: "Marienplatz, Munich, Germany",
				point: [11.5755, 48.1374],
			},
			destination: {
				label: "Schliersee, Germany",
				point: [11.8598, 47.7362],
			},
		});
	});

	it("uses a current-location fallback label when reverse geocoding fails", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockCurrentPositionSequence([
			{
				lng: 11.5755,
				lat: 48.1374,
			},
		]);
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			if (String(input).startsWith("/api/route/reverse?")) {
				return Promise.resolve(new Response("Reverse failed", { status: 502 }));
			}

			throw new Error(`Unexpected fetch request: ${String(input)}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page
			.getByRole("button", { name: "Use current location as start" })
			.click();

		await expect
			.element(page.getByRole("textbox", { name: "Start" }))
			.toHaveValue("Current location");
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to reverse geocode current location",
			expect.any(Error),
		);
	});

	it("shows an alert when current location is unavailable without changing fields", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const getCurrentPosition = mockCurrentPositionError();
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("textbox", { name: "Start" }).fill("Munich");
		await page
			.getByRole("button", { name: "Use current location as start" })
			.click();

		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent(
				"Current location is unavailable. Check browser location permissions.",
			);
		await expect
			.element(page.getByRole("textbox", { name: "Start" }))
			.toHaveValue("Munich");
		expect(getCurrentPosition).toHaveBeenCalledTimes(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to get current location",
			expect.any(Object),
		);
	});

	it("can use current location as the start for a round course", async () => {
		mockCurrentPositionSequence([
			{
				lng: 11.5755,
				lat: 48.1374,
				accuracy: 14,
			},
		]);
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/reverse?")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							label: "Marienplatz, Munich, Germany",
							point: [11.5755, 48.1374],
						}),
					),
				);
			}

			if (url === "/api/route") {
				return Promise.resolve(
					new Response(JSON.stringify(successfulRoundCoursePayload)),
				);
			}

			throw new Error(`Unexpected fetch request: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("button", { name: /Round course/i }).click();
		await page
			.getByRole("button", { name: "Use current location as start" })
			.click();
		await expect
			.element(page.getByRole("textbox", { name: "Start" }))
			.toHaveValue("Marienplatz, Munich, Germany");
		await page.getByRole("spinbutton", { name: "Target distance" }).fill("50");
		await page.getByRole("button", { name: "Generate Round Course" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		expect(
			JSON.parse(
				String(
					fetchMock.mock.calls.find(
						(call) => String(call[0]) === "/api/route",
					)?.[1]?.body,
				),
			),
		).toMatchObject({
			mode: "round_course",
			start: {
				label: "Marienplatz, Munich, Germany",
				point: [11.5755, 48.1374],
			},
		});
	});

	it("inserts a map-picked waypoint on the nearest routed leg", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-route-1",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: successfulRoute,
				},
			]),
		);
		window.history.replaceState({}, "", "/?savedRoute=saved-route-1");
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/reverse?")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							label: "Fischhausen, Germany",
							point: [11.82, 47.725],
						}),
					),
				);
			}

			throw new Error(`Unexpected fetch request: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);
		await expect.poll(() => document.body.textContent).toContain("61.2");
		await expect
			.poll(() => (mockState.eventHandlers.get("click") ?? []).length)
			.toBe(1);

		mockState.eventHandlers.get("click")?.[0]?.({
			lngLat: {
				lng: 11.82,
				lat: 47.725,
			},
			point: {
				x: 540,
				y: 220,
			},
		});
		await page.getByRole("button", { name: "Add waypoint here" }).click();

		await expect
			.element(page.getByRole("textbox", { name: "Waypoint 1" }))
			.toHaveValue("Tegernsee, Germany");
		await expect
			.element(page.getByRole("textbox", { name: "Waypoint 2" }))
			.toHaveValue("Fischhausen, Germany");
	});

	it("allows removing an already selected waypoint from the map click menu", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-route-1",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: successfulRoute,
				},
			]),
		);
		window.history.replaceState({}, "", "/?savedRoute=saved-route-1");
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);
		await expect.poll(() => document.body.textContent).toContain("61.2");
		await expect
			.poll(() => (mockState.eventHandlers.get("click") ?? []).length)
			.toBe(1);

		mockState.renderedFeatures.set("360,200", [
			{
				properties: {
					kind: "waypoint",
					label: "Tegernsee, Germany",
					order: 1,
				},
			},
		]);
		mockState.eventHandlers.get("click")?.[0]?.({
			lngLat: {
				lng: 11.7581,
				lat: 47.7123,
			},
			point: {
				x: 360,
				y: 200,
			},
		});

		await expect
			.element(page.getByRole("button", { name: "Remove waypoint 1" }))
			.toBeInTheDocument();
		await page.getByRole("button", { name: "Remove waypoint 1" }).click();

		await expect
			.element(
				page.getByText(
					"No waypoints yet. Add one to force the route through intermediate stops.",
				),
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("textbox", { name: "Waypoint 1" }))
			.not.toBeInTheDocument();
	});

	it("shows start suggestions only after the minimum query length", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			if (String(input).startsWith("/api/route/suggest?")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			throw new Error(`Unexpected fetch request: ${String(input)}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		const startInput = page.getByRole("textbox", { name: "Start" });

		await startInput.fill("Ma");
		await new Promise((resolve) => setTimeout(resolve, 350));
		expect(fetchMock).not.toHaveBeenCalled();

		await startInput.fill("Mari");
		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		await expect
			.element(
				page.getByRole("option", { name: "Marienplatz, Munich, Germany" }),
			)
			.toBeInTheDocument();
	});

	it("selects a keyboard-highlighted suggestion into the start field", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			if (String(input).startsWith("/api/route/suggest?")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			throw new Error(`Unexpected fetch request: ${String(input)}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		const startInput = page.getByRole("textbox", { name: "Start" });

		await startInput.fill("Mari");
		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		const startInputElement = startInput.element();
		startInputElement.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "ArrowDown",
				bubbles: true,
			}),
		);
		startInputElement.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
			}),
		);

		await expect
			.element(page.getByRole("textbox", { name: "Start" }))
			.toHaveValue("Marienplatz station, Munich, Germany");
	});

	it("shows suggestions for dynamically added waypoint inputs", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			if (String(input).startsWith("/api/route/suggest?")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							suggestions: [
								{
									label: "Tegernsee, Germany",
									point: [11.7581, 47.7123],
								},
							],
						}),
					),
				);
			}

			throw new Error(`Unexpected fetch request: ${String(input)}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("button", { name: "Add waypoint" }).click();
		const waypointInput = page.getByRole("textbox", { name: "Waypoint 1" });
		await waypointInput.fill("Teg");

		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		await expect
			.element(page.getByRole("option", { name: "Tegernsee, Germany" }))
			.toBeInTheDocument();
	});

	it("keeps manual route submission available when suggestions return no matches", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/suggest?")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							suggestions: [],
						}),
					),
				);
			}

			if (url === "/api/route") {
				return Promise.resolve(
					new Response(JSON.stringify(successfulRoutePayload)),
				);
			}

			throw new Error(`Unexpected fetch request: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		const startInput = page.getByRole("textbox", { name: "Start" });
		await startInput.fill("Muni");
		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		await expect
			.element(page.getByText("No matches found."))
			.toBeInTheDocument();

		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
		await expect.poll(() => document.body.textContent).toContain("61.2");
	});

	it("shows an inspected elevation readout and synced map marker while hovering the chart", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockImplementation(() =>
				Promise.resolve(new Response(JSON.stringify(successfulRoutePayload))),
			);
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("textbox", { name: "Start" }).fill("Munich");
		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);
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
		const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
			const url = String(input);

			if (url.startsWith("/api/route/suggest")) {
				return Promise.resolve(new Response(JSON.stringify(suggestionPayload)));
			}

			return Promise.resolve(
				new Response(JSON.stringify(successfulRoutePayload)),
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(PageTestShell);

		await page.getByRole("textbox", { name: "Start" }).fill("Munich");
		await page.getByRole("textbox", { name: "Destination" }).fill("Schliersee");
		await page.getByRole("button", { name: "Generate Route" }).click();

		await expect
			.poll(
				() =>
					fetchMock.mock.calls.filter(
						(call) => String(call[0]) === "/api/route",
					).length,
			)
			.toBe(1);

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
