import { page } from "vitest/browser";
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";

import RoutesPage from "./+page.svelte";
import {
	resetSavedRoutesForTests,
	SAVED_ROUTES_STORAGE_KEY,
} from "$lib/saved-routes.svelte";

const savedRoutes = [
	{
		id: "saved-route-1",
		createdAt: "2026-04-19T09:30:00.000Z",
		route: {
			mode: "point_to_point",
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

describe("routes/+page.svelte", () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetSavedRoutesForTests();
		window.history.replaceState({}, "", "/routes");
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

	it("renders round-course saved routes without showing a destination leg", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([
				{
					id: "saved-round-course",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: {
						mode: "round_course",
						startLabel: "Marienplatz, Munich, Germany",
						destinationLabel: "Marienplatz, Munich, Germany",
						requestedDistanceMeters: 50000,
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
