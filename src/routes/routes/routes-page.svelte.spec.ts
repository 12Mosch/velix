import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";

const publicEnv = vi.hoisted(() => ({
	PUBLIC_CONVEX_URL: "",
}));
const convexClientMock = vi.hoisted(() => ({
	mutation: vi.fn(),
	query: vi.fn(),
}));

vi.mock("$env/dynamic/public", () => ({
	env: publicEnv,
}));

vi.mock("convex-svelte", () => ({
	useConvexClient: () => convexClientMock,
}));

import {
	resetSavedRoutesForTests,
	readSavedRoutesForTests,
	SAVED_ROUTES_STORAGE_KEY,
	seedSavedRoutesForTests,
	savedRoutesState,
	type SavedRoute,
	upsertSavedRoute,
} from "$lib/saved-routes.svelte";
import { serializeSavedRouteForRemote } from "$lib/saved-routes-core";
import type { PlannedRoute } from "$lib/route-planning";
import { api } from "../../convex/_generated/api";
import {
	DISTANCE_UNIT_STORAGE_KEY,
	resetUnitPreferenceForTests,
	setDistanceUnitPreference,
} from "$lib/unit-settings.svelte";
import RoutesPage from "./+page.svelte";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const savedRoutes: SavedRoute[] = [
	{
		id: "saved-route-1",
		createdAt: "2026-04-19T09:30:00.000Z",
		route: {
			mode: "point_to_point",
			source: {
				kind: "graphhopper",
			},
			startLabel: "Marienplatz, Munich, Germany",
			destinationLabel: "Schliersee, Germany",
			waypoints: [
				{ label: "Tegernsee, Germany", coordinate: [11.7571, 47.7123, 735] },
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
			instructions: [],
			surfaceDetails: [
				{ from: 0, to: 4, value: "asphalt" },
				{ from: 4, to: 5, value: "fine gravel" },
			],
			smoothnessDetails: [{ from: 0, to: 5, value: "GOOD" }],
		},
	},
];

const searchableSavedRoutes = [
	savedRoutes[0],
	{
		id: "saved-round-course",
		createdAt: "2026-04-20T09:30:00.000Z",
		route: {
			mode: "round_course",
			source: {
				kind: "graphhopper",
			},
			startLabel: "Garmisch-Partenkirchen, Germany",
			destinationLabel: "Garmisch-Partenkirchen, Germany",
			roundCourseTarget: {
				kind: "distance",
				distanceMeters: 50000,
			},
			waypoints: [],
			bounds: [11.05, 47.45, 11.18, 47.52],
			distanceMeters: 50123,
			durationMs: 7420000,
			ascendMeters: 540,
			descendMeters: 540,
			coordinates: [
				[11.0955, 47.4924, 700],
				[11.13, 47.5, 760],
				[11.16, 47.47, 820],
				[11.0955, 47.4924, 700],
			],
			surfaceDetails: [],
			smoothnessDetails: [],
		},
	},
	{
		id: "saved-import",
		createdAt: "2026-04-21T09:30:00.000Z",
		route: {
			mode: "point_to_point",
			source: {
				kind: "gpx_import",
				filename: "saved-import.gpx",
				stopDerivation: "track",
				hasDuration: false,
			},
			startLabel: "48.13740, 11.57550",
			destinationLabel: "47.73620, 11.85980",
			waypoints: [
				{
					label: "Bavarian foothills, Germany",
					coordinate: [11.62, 48.1, 545],
				},
			],
			bounds: [11.5755, 47.7362, 11.8598, 48.1374],
			distanceMeters: 71234,
			durationMs: 0,
			ascendMeters: 920,
			descendMeters: 840,
			coordinates: [
				[11.5755, 48.1374, 520],
				[11.62, 48.1, 545],
				[11.8598, 47.7362, 785],
			],
			surfaceDetails: [],
			smoothnessDetails: [],
		},
	},
];

function setupGpxDownloadSpies(options: { clickError?: Error } = {}) {
	const createObjectUrl = vi.fn((blob: Blob) => {
		(window as Window & { __lastGpxBlob?: Blob }).__lastGpxBlob = blob;
		return "blob:saved-route";
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
	anchorClick.mockClear();

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

describe("routes/+page.svelte", () => {
	beforeEach(async () => {
		vi.restoreAllMocks();
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			writable: true,
			value: originalCreateObjectURL,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			writable: true,
			value: originalRevokeObjectURL,
		});
		window.localStorage.clear();
		await resetSavedRoutesForTests();
		Effect.runSync(resetUnitPreferenceForTests());
		window.history.replaceState({}, "", "/routes");
		publicEnv.PUBLIC_CONVEX_URL = "";
		convexClientMock.mutation.mockReset();
		convexClientMock.query.mockReset();
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: vi.fn().mockResolvedValue(undefined),
			},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			writable: true,
			value: originalCreateObjectURL,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			writable: true,
			value: originalRevokeObjectURL,
		});
	});

	it("shows an empty state when there are no saved routes", async () => {
		render(RoutesPage);

		await expect
			.element(page.getByRole("heading", { name: "My routes" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("No saved routes yet"))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("link", { name: "Open route planner" }))
			.toHaveAttribute("href", "/");
	});

	it("renders saved-route skeletons while remote sync is loading", async () => {
		await savedRoutesState.setAuthUser("user_1");

		render(RoutesPage);

		await expect
			.element(page.getByRole("status", { name: "Loading saved routes" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("No saved routes yet"))
			.not.toBeInTheDocument();
		expect(
			document.querySelectorAll('[data-slot="skeleton"]').length,
		).toBeGreaterThanOrEqual(9);
	});

	it("lists saved routes from localStorage and links back to the planner", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(savedRoutes),
		);

		render(RoutesPage);

		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Schliersee, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Via: Tegernsee, Germany"))
			.toBeInTheDocument();
		await expect.element(page.getByText("61.2 km")).toBeInTheDocument();
		await expect.element(page.getByText("820 m up")).toBeInTheDocument();
		await expect
			.element(page.getByRole("link", { name: "Open route" }))
			.toHaveAttribute("href", "/?savedRoute=saved-route-1");
	});

	it("restores the previous route payload and persists it locally", async () => {
		await seedSavedRoutesForTests(savedRoutes);
		await upsertSavedRoute(
			{
				...savedRoutes[0].route,
				destinationLabel: "Garmisch-Partenkirchen, Germany",
			},
			"saved-route-1",
		);

		render(RoutesPage);

		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
		await page.getByRole("button", { name: "Restore previous" }).click();

		await expect
			.element(page.getByText("Schliersee, Germany"))
			.toBeInTheDocument();
		await vi.waitFor(async () => {
			expect((await readSavedRoutesForTests())[0]?.route.destinationLabel).toBe(
				"Schliersee, Germany",
			);
		});
	});

	it("shows a scoped message when no previous version is available", async () => {
		await seedSavedRoutesForTests(savedRoutes);

		render(RoutesPage);

		await page.getByRole("button", { name: "Restore previous" }).click();

		await expect
			.element(page.getByText("No previous version available."))
			.toBeInTheDocument();
	});

	it("loads remote route versions before restoring signed-in routes", async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const listVersions = vi.fn().mockResolvedValue([
			{
				versionId: "remote-version-1",
				routeId: "saved-route-1",
				capturedAt: "2026-04-20T09:30:00.000Z",
				savedRoute: serializeSavedRouteForRemote(savedRoutes[0]),
			},
		]);
		await savedRoutesState.setAuthUser("user_1");
		savedRoutesState.setRemoteAdapter({
			save,
			delete: vi.fn(),
			listVersions,
			mergeLocalRoutes: vi.fn(),
		});
		await savedRoutesState.applyRemoteRoutes("user_1", [
			serializeSavedRouteForRemote({
				...savedRoutes[0],
				route: {
					...savedRoutes[0].route,
					destinationLabel: "Current remote",
				},
			}),
		]);

		render(RoutesPage);

		await page.getByRole("button", { name: "Restore previous" }).click();

		expect(listVersions).toHaveBeenCalledWith("saved-route-1");
		await expect
			.element(page.getByText("Schliersee, Germany"))
			.toBeInTheDocument();
		await vi.waitFor(() => {
			expect(save).toHaveBeenCalledWith(
				serializeSavedRouteForRemote(savedRoutesState.savedRoutes[0]),
			);
		});
	});

	it("shows change history with the current route and a previous version", async () => {
		await seedSavedRoutesForTests(savedRoutes);
		await upsertSavedRoute(
			{
				...savedRoutes[0].route,
				destinationLabel: "Garmisch-Partenkirchen, Germany",
				distanceMeters: 70123,
				durationMs: 12_600_000,
				ascendMeters: 1040,
			},
			"saved-route-1",
		);

		render(RoutesPage);

		await page.getByRole("button", { name: "Change history" }).click();
		const history = page.getByRole("region", {
			name: "Change history for to Garmisch-Partenkirchen, Germany",
		});

		await expect
			.element(history.getByText("Current version"))
			.toBeInTheDocument();
		await expect
			.element(history.getByText("Previous version"))
			.toBeInTheDocument();
		await expect
			.element(history.getByText("Captured", { exact: false }))
			.toBeInTheDocument();
		await expect.element(history.getByText("70.1 km")).toBeInTheDocument();
		await expect.element(history.getByText("1,040 m up")).toBeInTheDocument();
		await expect.element(history.getByText("3:30 h")).toBeInTheDocument();
		await expect
			.element(history.getByText("to Schliersee, Germany", { exact: false }))
			.toBeInTheDocument();
		await expect.element(history.getByText("61.2 km")).toBeInTheDocument();
		await expect.element(history.getByText("820 m up")).toBeInTheDocument();
		await expect.element(history.getByText("2:45 h")).toBeInTheDocument();
	});

	it("shows an empty change history state when no previous versions exist", async () => {
		await seedSavedRoutesForTests(savedRoutes);

		render(RoutesPage);

		await page.getByRole("button", { name: "Change history" }).click();

		await expect
			.element(page.getByText("No previous versions yet"))
			.toBeInTheDocument();
	});

	it("loads remote route versions before showing signed-in change history", async () => {
		const listVersions = vi.fn().mockResolvedValue([
			{
				versionId: "remote-version-1",
				routeId: "saved-route-1",
				capturedAt: "2026-04-20T09:30:00.000Z",
				savedRoute: serializeSavedRouteForRemote(savedRoutes[0]),
			},
		]);
		await savedRoutesState.setAuthUser("user_1");
		savedRoutesState.setRemoteAdapter({
			save: vi.fn(),
			delete: vi.fn(),
			listVersions,
			mergeLocalRoutes: vi.fn(),
		});
		await savedRoutesState.applyRemoteRoutes("user_1", [
			serializeSavedRouteForRemote({
				...savedRoutes[0],
				route: {
					...savedRoutes[0].route,
					destinationLabel: "Current remote",
				},
			}),
		]);

		render(RoutesPage);

		await page.getByRole("button", { name: "Change history" }).click();

		expect(listVersions).toHaveBeenCalledWith("saved-route-1");
		await expect
			.element(page.getByText("to Schliersee, Germany", { exact: false }))
			.toBeInTheDocument();
	});

	it("shows a Share action on saved-route cards", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(savedRoutes),
		);

		render(RoutesPage);

		await expect
			.element(page.getByRole("button", { name: "Share" }))
			.toBeInTheDocument();
	});

	it("shares a saved route through Convex and copies the public link", async () => {
		publicEnv.PUBLIC_CONVEX_URL = "https://convex.example";
		convexClientMock.mutation.mockResolvedValue({
			shareToken: "abc123_DEF456-7890",
			urlPath: "/share/abc123_DEF456-7890",
		});
		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.applyRemoteRoutes("user_1", savedRoutes);

		render(RoutesPage);

		await page.getByRole("button", { name: "Share" }).click();
		await expect
			.element(page.getByRole("button", { name: "Copied" }))
			.toBeInTheDocument();

		expect(convexClientMock.mutation).toHaveBeenCalledWith(
			api.sharedRoutes.create,
			expect.objectContaining({
				sourceRouteId: "saved-route-1",
				savedRoute: serializeSavedRouteForRemote(
					savedRoutesState.savedRoutes[0],
				),
			}),
		);
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
			expect.stringMatching(/\/share\/abc123_DEF456-7890$/u),
		);
	});

	it("surfaces a clear share error when Convex is unavailable", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(savedRoutes),
		);

		render(RoutesPage);

		await page.getByRole("button", { name: "Share" }).click();

		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("Route sharing needs Convex to be configured.");
	});

	it("renders remote routes already applied through savedRoutesState", async () => {
		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.applyRemoteRoutes("user_1", savedRoutes);

		render(RoutesPage);

		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("link", { name: "Open route" }))
			.toHaveAttribute("href", "/?savedRoute=saved-route-1");
	});

	it("renders round-course saved routes without showing a destination leg", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-round-course",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: {
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
						surfaceDetails: [],
						smoothnessDetails: [],
					},
				},
			]),
		);

		render(RoutesPage);

		await expect.element(page.getByText("Round course")).toBeInTheDocument();
		await expect
			.element(page.getByText("Returns to start"))
			.toBeInTheDocument();
		await expect.element(page.getByText("Target 50.0 km")).toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Schliersee, Germany"))
			.not.toBeInTheDocument();
	});

	it("formats saved route distances and targets in miles when selected", async () => {
		window.localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, "mi");
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-round-course",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: {
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
						surfaceDetails: [],
						smoothnessDetails: [],
					},
				},
			]),
		);

		render(RoutesPage);

		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		expect(document.body.textContent).toContain("31.1 mi");
		await expect.element(page.getByText("Target 31.1 mi")).toBeInTheDocument();
	});

	it("renders out-and-back saved routes with turnaround copy", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-out-and-back",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: {
						mode: "out_and_back",
						source: {
							kind: "graphhopper",
						},
						startLabel: "Marienplatz, Munich, Germany",
						destinationLabel: "Schliersee, Germany",
						waypoints: [
							{
								label: "Schliersee, Germany",
								coordinate: [11.8598, 47.7362, 785],
							},
						],
						bounds: [11.5755, 47.7362, 11.8598, 48.1374],
						distanceMeters: 122468,
						durationMs: 19752000,
						ascendMeters: 1560,
						descendMeters: 1560,
						coordinates: [
							[11.5755, 48.1374, 520],
							[11.8598, 47.7362, 785],
							[11.5755, 48.1374, 520],
						],
						surfaceDetails: [],
						smoothnessDetails: [],
					},
				},
			]),
		);

		render(RoutesPage);

		await expect.element(page.getByText("Out and back")).toBeInTheDocument();
		await expect
			.element(page.getByText("to Schliersee, Germany and back"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Target 122.5 km"))
			.not.toBeInTheDocument();
	});

	it("renders duration and climb targets for round-course saved routes", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-round-course-duration",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: {
						mode: "round_course",
						source: {
							kind: "graphhopper",
						},
						startLabel: "Marienplatz, Munich, Germany",
						destinationLabel: "Marienplatz, Munich, Germany",
						roundCourseTarget: {
							kind: "duration",
							durationMs: 12600000,
						},
						waypoints: [],
						bounds: [11.55, 48.08, 11.69, 48.17],
						distanceMeters: 50123,
						durationMs: 12600000,
						ascendMeters: 540,
						descendMeters: 540,
						coordinates: [
							[11.5755, 48.1374, 520],
							[11.62, 48.15, 580],
							[11.67, 48.11, 610],
							[11.5755, 48.1374, 520],
						],
						surfaceDetails: [],
						smoothnessDetails: [],
					},
				},
				{
					id: "saved-round-course-climb",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: {
						mode: "round_course",
						source: {
							kind: "graphhopper",
						},
						startLabel: "Tegernsee, Germany",
						destinationLabel: "Tegernsee, Germany",
						roundCourseTarget: {
							kind: "ascend",
							ascendMeters: 800,
						},
						waypoints: [],
						bounds: [11.55, 48.08, 11.69, 48.17],
						distanceMeters: 50123,
						durationMs: 7420000,
						ascendMeters: 800,
						descendMeters: 800,
						coordinates: [
							[11.5755, 48.1374, 520],
							[11.62, 48.15, 580],
							[11.67, 48.11, 610],
							[11.5755, 48.1374, 520],
						],
						surfaceDetails: [],
						smoothnessDetails: [],
					},
				},
			]),
		);

		render(RoutesPage);

		await expect.element(page.getByText("Target 3:30 h")).toBeInTheDocument();
		await expect.element(page.getByText("Target 800 m up")).toBeInTheDocument();
	});

	it("shows imported GPX badges and duration fallback for saved imports", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-import",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: {
						mode: "point_to_point",
						source: {
							kind: "gpx_import",
							filename: "saved-import.gpx",
							stopDerivation: "track",
							hasDuration: false,
						},
						startLabel: "48.13740, 11.57550",
						destinationLabel: "47.73620, 11.85980",
						waypoints: [],
						bounds: [11.5755, 47.7362, 11.8598, 48.1374],
						distanceMeters: 61234,
						durationMs: 0,
						ascendMeters: 820,
						descendMeters: 740,
						coordinates: [
							[11.5755, 48.1374, 520],
							[11.62, 48.1, 545],
							[11.8598, 47.7362, 785],
						],
						surfaceDetails: [],
						smoothnessDetails: [],
					},
				},
			]),
		);

		render(RoutesPage);

		await expect.element(page.getByText("Imported GPX")).toBeInTheDocument();
		await expect
			.element(page.getByText("Time unavailable"))
			.toBeInTheDocument();
	});

	it("searches saved routes by start, destination, and waypoint text", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		const searchInput = page.getByRole("textbox", {
			name: "Search saved routes",
		});

		await searchInput.fill("tegernsee");

		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.not.toBeInTheDocument();
		await expect.element(page.getByText("1 of 3 routes")).toBeInTheDocument();

		await searchInput.fill("garmisch");

		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.not.toBeInTheDocument();

		await searchInput.fill("47.73620");

		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.not.toBeInTheDocument();
	});

	it("searches saved routes by visible metadata", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		const searchInput = page.getByRole("textbox", {
			name: "Search saved routes",
		});

		await searchInput.fill("round course");
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.not.toBeInTheDocument();

		await searchInput.fill("imported gpx");
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.not.toBeInTheDocument();

		await searchInput.fill("71.2 km");
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.not.toBeInTheDocument();

		await searchInput.fill("820 m up");
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.not.toBeInTheDocument();

		await searchInput.fill("2:04 h");
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.not.toBeInTheDocument();
	});

	it("refreshes saved-route search results after replacing a route with the same id", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([savedRoutes[0]]),
		);

		render(RoutesPage);

		const searchInput = page.getByRole("textbox", {
			name: "Search saved routes",
		});

		await searchInput.fill("schliersee");
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();

		const updatedRoute: PlannedRoute = {
			...savedRoutes[0].route,
			destinationLabel: "Lake Starnberg, Germany",
			waypoints: [
				{
					label: "Bad Tolz, Germany",
					coordinate: [11.5582, 47.7604, 685] as [number, number, number],
				},
			],
			distanceMeters: 45500,
			durationMs: 7200000,
			ascendMeters: 410,
		};

		await upsertSavedRoute(updatedRoute, savedRoutes[0].id);

		await searchInput.fill("schliersee");
		await expect
			.element(page.getByText("No routes match your filters"))
			.toBeInTheDocument();

		await searchInput.fill("starnberg");
		await expect
			.element(page.getByText("Lake Starnberg, Germany"))
			.toBeInTheDocument();

		await searchInput.fill("45.5 km");
		await expect
			.element(page.getByText("Lake Starnberg, Germany"))
			.toBeInTheDocument();
	});

	it("updates saved-route search matches when the distance unit changes", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([searchableSavedRoutes[1]]),
		);

		render(RoutesPage);

		const searchInput = page.getByRole("textbox", {
			name: "Search saved routes",
		});

		await searchInput.fill("50.1 km");
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();

		Effect.runSync(setDistanceUnitPreference("mi"));

		await searchInput.fill("31.1 mi");
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
	});

	it("drops saved-route search matches for ids removed by remote replacement", async () => {
		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.applyRemoteRoutes("user_1", [
			searchableSavedRoutes[0],
			searchableSavedRoutes[1],
		]);

		render(RoutesPage);

		const searchInput = page.getByRole("textbox", {
			name: "Search saved routes",
		});

		await searchInput.fill("schliersee");
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();

		await savedRoutesState.applyRemoteRoutes("user_1", [
			searchableSavedRoutes[1],
		]);

		await expect
			.element(page.getByText("No routes match your filters"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.not.toBeInTheDocument();

		await searchInput.fill("garmisch");
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
	});

	it("shows a search-empty state when saved routes do not match", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		await page
			.getByRole("textbox", { name: "Search saved routes" })
			.fill("no route has this");

		await expect
			.element(page.getByText("No routes match your filters"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("No saved routes yet"))
			.not.toBeInTheDocument();
		await expect.element(page.getByText("0 of 3 routes")).toBeInTheDocument();
	});

	it("clears a saved-routes search and restores the full list count", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		await page
			.getByRole("textbox", { name: "Search saved routes" })
			.fill("garmisch");
		await expect.element(page.getByText("1 of 3 routes")).toBeInTheDocument();

		await page.getByRole("button", { name: "Clear route search" }).click();

		await expect.element(page.getByText("3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.toBeInTheDocument();
	});

	it("filters saved routes by minimum distance in the selected distance unit", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		await page.getByRole("textbox", { name: "Min distance (km)" }).fill("60");

		await expect.element(page.getByText("2 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.not.toBeInTheDocument();
	});

	it("filters saved routes by maximum distance in the selected distance unit", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		await page.getByRole("textbox", { name: "Max distance (km)" }).fill("60");

		await expect.element(page.getByText("1 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.not.toBeInTheDocument();
	});

	it("filters saved routes by elevation gain range", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		await page.getByRole("textbox", { name: "Min elevation (m)" }).fill("800");
		await page.getByRole("textbox", { name: "Max elevation (m)" }).fill("900");

		await expect.element(page.getByText("1 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.not.toBeInTheDocument();
	});

	it("keeps saved-route search results correct across repeated filter input changes", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		const searchInput = page.getByRole("textbox", {
			name: "Search saved routes",
		});
		const minDistanceInput = page.getByRole("textbox", {
			name: "Min distance (km)",
		});
		const maxDistanceInput = page.getByRole("textbox", {
			name: "Max distance (km)",
		});
		const minElevationInput = page.getByRole("textbox", {
			name: "Min elevation (m)",
		});

		await searchInput.fill("germany");
		await expect.element(page.getByText("3 of 3 routes")).toBeInTheDocument();

		await minDistanceInput.fill("60");
		await expect.element(page.getByText("2 of 3 routes")).toBeInTheDocument();

		await maxDistanceInput.fill("65");
		await expect.element(page.getByText("1 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();

		await minDistanceInput.fill("");
		await expect.element(page.getByText("2 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();

		await maxDistanceInput.fill("");
		await minElevationInput.fill("900");
		await expect.element(page.getByText("1 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.toBeInTheDocument();

		await searchInput.fill("imported gpx");
		await expect.element(page.getByText("1 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.toBeInTheDocument();
	});

	it("combines saved-route search with elevation filters", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		await page
			.getByRole("textbox", { name: "Search saved routes" })
			.fill("germany");
		await page.getByRole("textbox", { name: "Min elevation (m)" }).fill("900");

		await expect.element(page.getByText("1 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.not.toBeInTheDocument();
	});

	it("clears route filters while preserving the current saved-route search", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		await page
			.getByRole("textbox", { name: "Search saved routes" })
			.fill("germany");
		await page.getByRole("textbox", { name: "Min distance (km)" }).fill("60");
		await page.getByRole("textbox", { name: "Min elevation (m)" }).fill("800");
		await expect.element(page.getByText("2 of 3 routes")).toBeInTheDocument();

		await page.getByRole("button", { name: "Clear filters" }).click();

		await expect.element(page.getByText("3 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByRole("textbox", { name: "Search saved routes" }))
			.toHaveValue("germany");
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
	});

	it("clears saved-route search and filters from the no-results state", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		await page
			.getByRole("textbox", { name: "Search saved routes" })
			.fill("germany");
		await page.getByRole("textbox", { name: "Min elevation (m)" }).fill("1000");
		await expect
			.element(page.getByText("No routes match your filters"))
			.toBeInTheDocument();

		await page
			.getByRole("button", { name: "Clear search and filters" })
			.click();

		await expect.element(page.getByText("3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByRole("textbox", { name: "Search saved routes" }))
			.toHaveValue("");
		await expect
			.element(page.getByRole("textbox", { name: "Min elevation (m)" }))
			.toHaveValue("");
	});

	it("uses miles when filtering saved routes with a miles distance preference", async () => {
		window.localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, "mi");
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		await page.getByRole("textbox", { name: "Max distance (mi)" }).fill("35");

		await expect.element(page.getByText("1 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.not.toBeInTheDocument();
	});

	it("treats invalid saved-route filter input as inactive", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(searchableSavedRoutes),
		);

		render(RoutesPage);

		await page
			.getByRole("textbox", { name: "Min distance (km)" })
			.fill("not a number");
		await page
			.getByRole("textbox", { name: "Max elevation (m)" })
			.fill("also invalid");

		await expect.element(page.getByText("3 of 3 routes")).toBeInTheDocument();
		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Garmisch-Partenkirchen, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("48.13740, 11.57550"))
			.toBeInTheDocument();
	});

	it("deletes a saved route from the list and localStorage", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(savedRoutes),
		);

		render(RoutesPage);

		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();

		await page.getByRole("button", { name: "Delete" }).click();

		await expect
			.element(page.getByText("No saved routes yet"))
			.toBeInTheDocument();
		expect(window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY)).toBeNull();
	});

	it("duplicates a saved route with a new id and keeps the original route payload", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(savedRoutes),
		);

		render(RoutesPage);

		await page.getByRole("button", { name: "Duplicate" }).click();

		const storedRoutes = await readSavedRoutesForTests();
		expect(storedRoutes).toHaveLength(2);
		expect(storedRoutes[0].id).not.toBe(savedRoutes[0].id);
		expect(storedRoutes[0].route).toEqual(savedRoutes[0].route);
		expect(storedRoutes[1]).toEqual(savedRoutes[0]);
		await expect.element(page.getByText("2 routes")).toBeInTheDocument();
	});

	it("duplicates optimistically and calls the remote adapter when signed in", async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.applyRemoteRoutes("user_1", savedRoutes);
		savedRoutesState.setRemoteAdapter({
			save,
			delete: vi.fn(),
			mergeLocalRoutes: vi.fn(),
		});

		render(RoutesPage);

		await page.getByRole("button", { name: "Duplicate" }).click();

		expect(savedRoutesState.savedRoutes).toHaveLength(2);
		expect(savedRoutesState.savedRoutes[0]?.id).not.toBe(savedRoutes[0].id);
		expect(savedRoutesState.savedRoutes[0]?.route).toEqual(
			savedRoutes[0].route,
		);
		await vi.waitFor(() => {
			expect(save).toHaveBeenCalledWith(
				serializeSavedRouteForRemote(savedRoutesState.savedRoutes[0]),
			);
		});
	});

	it("deletes optimistically and calls the remote adapter when signed in", async () => {
		const deleteRemote = vi.fn().mockResolvedValue(undefined);
		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.applyRemoteRoutes("user_1", savedRoutes);
		savedRoutesState.setRemoteAdapter({
			save: vi.fn(),
			delete: deleteRemote,
			mergeLocalRoutes: vi.fn(),
		});

		render(RoutesPage);

		await page.getByRole("button", { name: "Delete" }).click();

		await expect
			.element(page.getByText("No saved routes yet"))
			.toBeInTheDocument();
		await vi.waitFor(() => {
			expect(deleteRemote).toHaveBeenCalledWith("saved-route-1");
		});
	});

	it("exports a saved route as a GPX download", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(savedRoutes),
		);
		const downloadSpy = setupGpxDownloadSpies();

		render(RoutesPage);

		await page.getByRole("button", { name: "Export GPX" }).click();

		expect(downloadSpy.createObjectUrl).toHaveBeenCalledTimes(1);
		expect(downloadSpy.anchorClick).toHaveBeenCalledTimes(1);
		expect(downloadSpy.getClickedDownload()).toBe(
			"marienplatz-munich-germany-to-schliersee-germany.gpx",
		);
		expect(downloadSpy.getClickedHref()).toBe("blob:saved-route");
		expect(downloadSpy.revokeObjectUrl).toHaveBeenCalledWith(
			"blob:saved-route",
		);

		const blob = downloadSpy.getLastBlob();
		expect(blob).toBeInstanceOf(Blob);
		const gpx = await blob?.text();
		expect(gpx).toContain("<gpx");
		expect(gpx).toContain("<trk>");
		expect(gpx).toContain("Tegernsee, Germany");
		expect(gpx).toContain("Schliersee, Germany");
	});

	it("shows an alert when saved-route GPX export fails", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(savedRoutes),
		);
		const downloadSpy = setupGpxDownloadSpies({
			clickError: new Error("Download blocked"),
		});

		render(RoutesPage);

		await page.getByRole("button", { name: "Export GPX" }).click();

		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("Could not export GPX: Download blocked");
		expect(downloadSpy.createObjectUrl).toHaveBeenCalledTimes(1);
		expect(downloadSpy.revokeObjectUrl).toHaveBeenCalledWith(
			"blob:saved-route",
		);
	});

	it("exports a saved route as a FIT download", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(savedRoutes),
		);
		const downloadSpy = setupGpxDownloadSpies();

		render(RoutesPage);

		await page.getByRole("button", { name: "Export FIT" }).click();

		expect(downloadSpy.createObjectUrl).toHaveBeenCalledTimes(1);
		expect(downloadSpy.anchorClick).toHaveBeenCalledTimes(1);
		expect(downloadSpy.getClickedDownload()).toBe(
			"marienplatz-munich-germany-to-schliersee-germany.fit",
		);
		expect(downloadSpy.getClickedHref()).toBe("blob:saved-route");
		expect(downloadSpy.revokeObjectUrl).toHaveBeenCalledWith(
			"blob:saved-route",
		);

		const blob = downloadSpy.getLastBlob();
		expect(blob).toBeInstanceOf(Blob);
		expect(blob?.type).toBe("application/vnd.ant.fit");
		expect((await blob?.arrayBuffer())?.byteLength).toBeGreaterThan(14);
	});

	it("shows an alert when saved-route FIT export fails", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(savedRoutes),
		);
		const downloadSpy = setupGpxDownloadSpies({
			clickError: new Error("Download blocked"),
		});

		render(RoutesPage);

		await page.getByRole("button", { name: "Export FIT" }).click();

		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("Could not export FIT: Download blocked");
		expect(downloadSpy.createObjectUrl).toHaveBeenCalledTimes(1);
		expect(downloadSpy.revokeObjectUrl).toHaveBeenCalledWith(
			"blob:saved-route",
		);
	});

	it("ignores malformed saved routes in localStorage", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "broken-route",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: {
						startLabel: "Marienplatz, Munich, Germany",
						destinationLabel: "Schliersee, Germany",
						bounds: [11.5755, 47.7362, 11.8598, 48.1374],
						distanceMeters: 61234,
						durationMs: 9876000,
						ascendMeters: 820,
						descendMeters: 740,
						surfaceDetails: [],
						smoothnessDetails: [],
					},
				},
			]),
		);

		render(RoutesPage);

		await expect
			.element(page.getByText("No saved routes yet"))
			.toBeInTheDocument();
	});

	it("loads saved routes with normalized waypoint data", async () => {
		await seedSavedRoutesForTests([
			{
				id: "legacy-route",
				createdAt: "2026-04-19T09:30:00.000Z",
				route: {
					mode: "point_to_point",
					source: { kind: "graphhopper" },
					startLabel: "Marienplatz, Munich, Germany",
					destinationLabel: "Schliersee, Germany",
					waypoints: [],
					bounds: [11.5755, 47.7362, 11.8598, 48.1374],
					distanceMeters: 61234,
					durationMs: 9876000,
					ascendMeters: 820,
					descendMeters: 740,
					coordinates: [
						[11.5755, 48.1374, 520],
						[11.8598, 47.7362, 785],
					],
					instructions: [],
					surfaceDetails: [],
					smoothnessDetails: [],
				},
			},
		]);

		render(RoutesPage);

		await expect
			.element(page.getByText("Marienplatz, Munich, Germany"))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Schliersee, Germany"))
			.toBeInTheDocument();
	});
});
