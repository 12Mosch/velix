import { describe, expect, it } from "vitest";

import {
	normalizePlannedRoute,
	parseSavedRoutes,
	type SavedRoute,
} from "$lib/saved-routes-core";

const baseRoute: SavedRoute["route"] = {
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
		[11.8598, 47.7362, 785],
	],
	surfaceDetails: [{ from: 0, to: 2, value: "asphalt" }],
	smoothnessDetails: [{ from: 0, to: 2, value: "GOOD" }],
};

describe("saved-routes-core", () => {
	it("normalizes a valid route without changing its saved shape", () => {
		expect(normalizePlannedRoute(baseRoute)).toEqual(baseRoute);
	});

	it("rejects invalid saved routes", () => {
		expect(
			parseSavedRoutes(
				JSON.stringify([
					{
						id: "broken",
						createdAt: "2026-04-19T09:30:00.000Z",
						route: { ...baseRoute, coordinates: [] },
					},
				]),
			),
		).toEqual([]);
	});

	it("loads legacy routes without waypoints", () => {
		const legacyRoute = { ...baseRoute };
		delete (legacyRoute as { waypoints?: unknown }).waypoints;
		const savedRoute: SavedRoute = {
			id: "legacy-route",
			createdAt: "2026-04-19T09:30:00.000Z",
			route: legacyRoute as unknown as SavedRoute["route"],
		};

		expect(parseSavedRoutes(JSON.stringify([savedRoute]))).toEqual([
			{
				...savedRoute,
				route: {
					...savedRoute.route,
					waypoints: [],
				},
			},
		]);
	});
});
