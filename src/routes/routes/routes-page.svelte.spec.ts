import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

import RoutesPage from "./+page.svelte";
import {
	resetSavedRoutesForTests,
	SAVED_ROUTES_STORAGE_KEY,
	savedRoutesState,
} from "$lib/saved-routes.svelte";
import {
	DISTANCE_UNIT_STORAGE_KEY,
	resetUnitPreferenceForTests,
} from "$lib/unit-settings.svelte";

const savedRoutes = [
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
			surfaceDetails: [
				{ from: 0, to: 4, value: "asphalt" },
				{ from: 4, to: 5, value: "fine gravel" },
			],
			smoothnessDetails: [{ from: 0, to: 5, value: "GOOD" }],
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
	beforeEach(() => {
		window.localStorage.clear();
		resetSavedRoutesForTests();
		resetUnitPreferenceForTests();
		window.history.replaceState({}, "", "/routes");
		vi.restoreAllMocks();
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

	it("renders remote routes already applied through savedRoutesState", async () => {
		savedRoutesState.setAuthUser("user_1");
		savedRoutesState.applyRemoteRoutes("user_1", savedRoutes);

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

	it("deletes optimistically and calls the remote adapter when signed in", async () => {
		const deleteRemote = vi.fn().mockResolvedValue(undefined);
		savedRoutesState.setAuthUser("user_1");
		savedRoutesState.applyRemoteRoutes("user_1", savedRoutes);
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
		expect(deleteRemote).toHaveBeenCalledWith("saved-route-1");
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

	it("loads legacy saved routes that do not include a waypoints array", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "legacy-route",
					createdAt: "2026-04-19T09:30:00.000Z",
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
							[11.8598, 47.7362, 785],
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
		await expect
			.element(page.getByText("Schliersee, Germany"))
			.toBeInTheDocument();
	});
});
