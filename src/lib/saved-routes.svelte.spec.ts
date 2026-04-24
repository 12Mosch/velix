import { describe, expect, it } from "vitest";

import { normalizePlannedRoute } from "$lib/saved-routes.svelte";

const baseRoundCourseRoute = {
	mode: "round_course",
	source: {
		kind: "graphhopper",
	},
	startLabel: "Marienplatz, Munich, Germany",
	destinationLabel: "Marienplatz, Munich, Germany",
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
} as const;

describe("normalizePlannedRoute", () => {
	it("upgrades legacy requested distance metadata into a round-course target", () => {
		const route = normalizePlannedRoute({
			...baseRoundCourseRoute,
			requestedDistanceMeters: 50000,
		});

		expect(route?.roundCourseTarget).toEqual({
			kind: "distance",
			distanceMeters: 50000,
		});
	});

	it("prefers explicit round-course targets over legacy requested distance metadata", () => {
		const route = normalizePlannedRoute({
			...baseRoundCourseRoute,
			requestedDistanceMeters: 50000,
			roundCourseTarget: {
				kind: "ascend",
				ascendMeters: 800,
			},
		});

		expect(route?.roundCourseTarget).toEqual({
			kind: "ascend",
			ascendMeters: 800,
		});
	});

	it("rejects saved spatial constraints with an unclosed polygon ring", () => {
		const route = normalizePlannedRoute({
			...baseRoundCourseRoute,
			spatialConstraint: {
				kind: "area",
				label: "Munich, Germany",
				center: [11.5755, 48.1374],
				radiusMeters: 30000,
				enforcement: "strict",
				polygon: [
					[11.2, 48.0],
					[11.9, 48.0],
					[11.9, 48.3],
					[11.2, 48.3],
				],
			},
		});

		expect(route).toBeNull();
	});
});
