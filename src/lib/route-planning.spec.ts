import { describe, expect, it } from "vitest";

import {
	buildRouteGeoJson,
	getSurfaceMix,
	sampleElevationProfile,
	type PlannedRoute,
} from "./route-planning";

function buildRoute(
	surfaceDetails: PlannedRoute["surfaceDetails"],
	smoothnessDetails: PlannedRoute["smoothnessDetails"] = [],
): PlannedRoute {
	return {
		startLabel: "Start",
		destinationLabel: "Destination",
		waypoints: [
			{
				label: "Waypoint",
				coordinate: [0.5, 0.5, 15],
			},
		],
		bounds: [0, 0, 1, 1],
		distanceMeters: 1000,
		durationMs: 120000,
		ascendMeters: 10,
		descendMeters: 10,
		coordinates: [
			[0, 0, 10],
			[1, 1, 20],
		],
		surfaceDetails,
		smoothnessDetails,
	};
}

describe("buildRouteGeoJson", () => {
	it("includes waypoint point features between the start and destination markers", () => {
		const route = buildRoute([{ from: 0, to: 10, value: "ASPHALT" }]);
		const geoJson = buildRouteGeoJson(route);

		expect(geoJson.features.map((feature) => feature.properties?.kind)).toEqual(
			["route", "start", "waypoint", "destination"],
		);
		expect(geoJson.features[2]?.properties).toMatchObject({
			kind: "waypoint",
			label: "Waypoint",
			order: 1,
		});
	});
});

describe("getSurfaceMix", () => {
	it("calculates the coarse percentage from its own share instead of subtracting from 100", () => {
		const route = buildRoute([
			{ from: 0, to: 333, value: "ASPHALT" },
			{ from: 333, to: 666, value: "COMPACTED" },
			{ from: 666, to: 1000, value: "DIRT" },
		]);

		expect(getSurfaceMix(route)).toEqual([
			{ label: "Smooth asphalt", pct: 33, className: "bg-emerald-500" },
			{ label: "Mixed / worn", pct: 33, className: "bg-amber-500" },
			{ label: "Coarse / rough", pct: 33, className: "bg-orange-600" },
		]);
	});

	it("normalizes incoming surface values before classifying them", () => {
		const route = buildRoute([
			{ from: 0, to: 6, value: "asphalt" },
			{ from: 6, to: 10, value: "fine gravel" },
		]);

		expect(getSurfaceMix(route)).toEqual([
			{ label: "Smooth asphalt", pct: 60, className: "bg-emerald-500" },
			{ label: "Mixed / worn", pct: 40, className: "bg-amber-500" },
		]);
	});

	it("falls back to smoothness when surface details are missing or unknown", () => {
		const route = buildRoute(
			[
				{ from: 0, to: 5, value: "missing" },
				{ from: 5, to: 10, value: "unknown" },
			],
			[
				{ from: 0, to: 7, value: "good" },
				{ from: 7, to: 10, value: "intermediate" },
			],
		);

		expect(getSurfaceMix(route)).toEqual([
			{ label: "Smooth asphalt", pct: 70, className: "bg-emerald-500" },
			{ label: "Mixed / worn", pct: 30, className: "bg-amber-500" },
		]);
	});
});

describe("sampleElevationProfile", () => {
	it("preserves the exact start and end distances when downsampling", () => {
		const profilePoints = sampleElevationProfile(
			[
				[11.5, 47.2, 520],
				[11.51, 47.205, 540],
				[11.53, 47.215, 580],
				[11.56, 47.23, 610],
			],
			2,
		);

		expect(profilePoints).toHaveLength(2);
		expect(profilePoints[0]).toMatchObject({
			distanceMeters: 0,
			elevationMeters: 520,
			coordinate: [11.5, 47.2, 520],
		});
		expect(profilePoints[1]?.distanceMeters).toBeGreaterThan(0);
		expect(profilePoints[1]).toMatchObject({
			elevationMeters: 610,
			coordinate: [11.56, 47.23, 610],
		});
	});

	it("uses cumulative route distance instead of distributing samples evenly by index", () => {
		const profilePoints = sampleElevationProfile([
			[0, 0, 10],
			[0, 0.01, 20],
			[0, 1, 30],
		]);

		expect(profilePoints).toHaveLength(3);
		expect(profilePoints[0]?.distanceMeters).toBe(0);
		expect(profilePoints[1]?.distanceMeters).toBeGreaterThan(1000);
		expect(profilePoints[1]?.distanceMeters).toBeLessThan(2000);
		expect(profilePoints[2]?.distanceMeters).toBeGreaterThan(100000);
		expect(profilePoints[1]?.distanceMeters).toBeLessThan(
			(profilePoints[2]?.distanceMeters ?? 0) / 10,
		);
	});

	it("skips coordinates without elevation values", () => {
		expect(
			sampleElevationProfile([
				[11.5, 47.2],
				[11.6, 47.25],
			]),
		).toEqual([]);
	});
});
