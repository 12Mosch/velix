import { describe, expect, it } from "vitest";

import {
	analyzeRouteClimbs,
	buildRouteGeoJson,
	buildRouteSurfaceGeoJson,
	buildLockedSegmentGeoJson,
	buildSpatialConstraintGeoJson,
	classifyClimbCategory,
	getEditableRouteStops,
	getRouteLegIndexForCoordinateSegment,
	getRouteSegmentCount,
	getRouteStopInputs,
	getSurfaceMix,
	getWaypointInsertionIndex,
	isRouteStopLocked,
	sampleElevationProfile,
	sanitizeLockedSegmentIndexes,
	type PlannedRoute,
	type RouteStopInput,
} from "./route-planning";

function buildRoute(
	surfaceDetails: PlannedRoute["surfaceDetails"],
	smoothnessDetails: PlannedRoute["smoothnessDetails"] = [],
): PlannedRoute {
	return {
		mode: "point_to_point",
		source: {
			kind: "graphhopper",
		},
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

	it("omits the destination marker for round-course routes", () => {
		const route: PlannedRoute = {
			...buildRoute([{ from: 0, to: 10, value: "ASPHALT" }]),
			mode: "round_course",
			startLabel: "Loop start",
			destinationLabel: "Loop start",
			roundCourseTarget: {
				kind: "distance",
				distanceMeters: 50000,
			},
			waypoints: [],
			coordinates: [
				[11.5, 47.2, 520],
				[11.6, 47.25, 560],
				[11.5, 47.2, 520],
			],
		};

		const geoJson = buildRouteGeoJson(route);

		expect(geoJson.features.map((feature) => feature.properties?.kind)).toEqual(
			["route", "start"],
		);
	});

	it("renders the turnaround as a waypoint marker for out-and-back routes", () => {
		const route: PlannedRoute = {
			...buildRoute([{ from: 0, to: 10, value: "ASPHALT" }]),
			mode: "out_and_back",
			startLabel: "Start",
			destinationLabel: "Turnaround",
			waypoints: [
				{
					label: "Turnaround",
					coordinate: [1, 1, 20],
				},
			],
			coordinates: [
				[0, 0, 10],
				[1, 1, 20],
				[0, 0, 10],
			],
		};

		const geoJson = buildRouteGeoJson(route);

		expect(geoJson.features.map((feature) => feature.properties?.kind)).toEqual(
			["route", "start", "waypoint"],
		);
		expect(geoJson.features[2]?.properties).toMatchObject({
			kind: "waypoint",
			label: "Turnaround",
		});
	});
});

describe("buildRouteSurfaceGeoJson", () => {
	const routeCoordinates: PlannedRoute["coordinates"] = [
		[0, 0, 10],
		[1, 1, 20],
		[2, 2, 30],
		[3, 3, 40],
		[4, 4, 50],
	];

	it("builds smooth, mixed, and coarse surface segment features from interval indexes", () => {
		const geoJson = buildRouteSurfaceGeoJson({
			...buildRoute([
				{ from: 0, to: 1, value: "asphalt" },
				{ from: 1, to: 3, value: "paving_stones" },
				{ from: 3, to: 4, value: "gravel" },
			]),
			coordinates: routeCoordinates,
		});

		expect(geoJson.features.map((feature) => feature.properties)).toEqual([
			{ kind: "surface", surfaceBucket: "smooth" },
			{ kind: "surface", surfaceBucket: "mixed" },
			{ kind: "surface", surfaceBucket: "coarse" },
		]);
		expect(
			geoJson.features.map((feature) =>
				feature.geometry.type === "LineString"
					? feature.geometry.coordinates
					: [],
			),
		).toEqual([
			[routeCoordinates[0], routeCoordinates[1]],
			[routeCoordinates[1], routeCoordinates[2], routeCoordinates[3]],
			[routeCoordinates[3], routeCoordinates[4]],
		]);
	});

	it("normalizes incoming surface values", () => {
		const geoJson = buildRouteSurfaceGeoJson({
			...buildRoute([
				{ from: 0, to: 1, value: " Concrete:plates " },
				{ from: 1, to: 2, value: "fine gravel" },
			]),
			coordinates: routeCoordinates,
		});

		expect(geoJson.features.map((feature) => feature.properties)).toEqual([
			{ kind: "surface", surfaceBucket: "smooth" },
			{ kind: "surface", surfaceBucket: "mixed" },
		]);
	});

	it("falls back to smoothness when surface details are unavailable or unclassifiable", () => {
		const geoJson = buildRouteSurfaceGeoJson({
			...buildRoute(
				[{ from: 0, to: 1, value: "unknown_surface" }],
				[
					{ from: 0, to: 1, value: "GOOD" },
					{ from: 1, to: 2, value: "INTERMEDIATE" },
					{ from: 2, to: 3, value: "BAD" },
				],
			),
			coordinates: routeCoordinates,
		});

		expect(geoJson.features.map((feature) => feature.properties)).toEqual([
			{ kind: "surface", surfaceBucket: "smooth" },
			{ kind: "surface", surfaceBucket: "mixed" },
			{ kind: "surface", surfaceBucket: "coarse" },
		]);
	});

	it("skips unknown, missing, degenerate, and out-of-bounds intervals", () => {
		const geoJson = buildRouteSurfaceGeoJson({
			...buildRoute([
				{ from: 0, to: 1, value: "unknown" },
				{ from: 1, to: 2, value: "missing" },
				{ from: 2, to: 2, value: "asphalt" },
				{ from: -1, to: 1, value: "asphalt" },
				{ from: 3, to: 5, value: "asphalt" },
				{ from: 1, to: 2, value: "asphalt" },
			]),
			coordinates: routeCoordinates,
		});

		expect(geoJson.features).toHaveLength(1);
		expect(geoJson.features[0]?.properties).toEqual({
			kind: "surface",
			surfaceBucket: "smooth",
		});
	});
});

describe("buildSpatialConstraintGeoJson", () => {
	it("closes unclosed rings and emits presentation properties", () => {
		const geoJson = buildSpatialConstraintGeoJson({
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
		});
		const feature = geoJson.features[0];

		expect(feature?.properties).toMatchObject({
			kind: "spatial_constraint",
			constraintKind: "area",
			enforcement: "strict",
			label: "Munich, Germany",
			radiusMeters: 30000,
		});
		expect(feature?.geometry.coordinates[0]?.at(-1)).toEqual(
			feature?.geometry.coordinates[0]?.[0],
		);
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

describe("getRouteStopInputs", () => {
	it("derives exact stop points from the planned route geometry", () => {
		const route = buildRoute([{ from: 0, to: 10, value: "ASPHALT" }]);

		expect(getRouteStopInputs(route)).toEqual([
			{
				label: "Start",
				point: [0, 0],
			},
			{
				label: "Waypoint",
				point: [0.5, 0.5],
			},
			{
				label: "Destination",
				point: [1, 1],
			},
		]);
	});

	it("returns only the start stop for round-course routes", () => {
		const route: PlannedRoute = {
			...buildRoute([{ from: 0, to: 10, value: "ASPHALT" }]),
			mode: "round_course",
			startLabel: "Loop start",
			destinationLabel: "Loop start",
			roundCourseTarget: {
				kind: "distance",
				distanceMeters: 65000,
			},
			waypoints: [],
			coordinates: [
				[11.5, 47.2, 520],
				[11.6, 47.25, 560],
				[11.5, 47.2, 520],
			],
		};

		expect(getRouteStopInputs(route)).toEqual([
			{
				label: "Loop start",
				point: [11.5, 47.2],
			},
		]);
	});

	it("returns start and turnaround stops for out-and-back routes", () => {
		const route: PlannedRoute = {
			...buildRoute([{ from: 0, to: 10, value: "ASPHALT" }]),
			mode: "out_and_back",
			startLabel: "Start",
			destinationLabel: "Turnaround",
			waypoints: [
				{
					label: "Turnaround",
					coordinate: [1, 1, 20],
				},
			],
			coordinates: [
				[0, 0, 10],
				[1, 1, 20],
				[0, 0, 10],
			],
		};

		expect(getRouteStopInputs(route)).toEqual([
			{
				label: "Start",
				point: [0, 0],
			},
			{
				label: "Turnaround",
				point: [1, 1],
			},
		]);
	});
});

describe("manual route editing helpers", () => {
	it("returns editable shaping stops for round-course and out-and-back routes", () => {
		const roundRoute: PlannedRoute = {
			...buildRoute([]),
			mode: "round_course",
			startLabel: "Loop start",
			destinationLabel: "Loop start",
			waypoints: [
				{
					label: "Shaper",
					coordinate: [0.5, 0.5, 15],
				},
			],
			coordinates: [
				[0, 0, 10],
				[0.5, 0.5, 15],
				[0, 0, 10],
			],
		};
		const outAndBackRoute: PlannedRoute = {
			...buildRoute([]),
			mode: "out_and_back",
			startLabel: "Start",
			destinationLabel: "Turnaround",
			waypoints: [
				{
					label: "Shaper",
					coordinate: [0.5, 0.5, 15],
				},
				{
					label: "Turnaround",
					coordinate: [1, 1, 20],
				},
			],
			coordinates: [
				[0, 0, 10],
				[0.5, 0.5, 15],
				[1, 1, 20],
				[0, 0, 10],
			],
		};

		expect(getEditableRouteStops(roundRoute).map((stop) => stop.label)).toEqual(
			["Loop start", "Shaper"],
		);
		expect(getRouteSegmentCount(roundRoute)).toBe(2);
		expect(
			getEditableRouteStops(outAndBackRoute).map((stop) => stop.label),
		).toEqual(["Start", "Shaper", "Turnaround"]);
		expect(getRouteSegmentCount(outAndBackRoute)).toBe(2);
	});

	it("sanitizes locked segments and marks adjacent stops as locked", () => {
		expect(sanitizeLockedSegmentIndexes([2, 0, 2, -1, 4], 3)).toEqual([0, 2]);
		expect(isRouteStopLocked(1, [0], 3)).toBe(true);
		expect(isRouteStopLocked(0, [2], 3, true)).toBe(true);
		expect(isRouteStopLocked(0, [2], 3, false)).toBe(false);
	});

	it("builds locked segment GeoJSON from route legs", () => {
		const route: PlannedRoute = {
			...buildRoute([]),
			waypoints: [
				{
					label: "Waypoint",
					coordinate: [0, 1, 10],
				},
			],
			coordinates: [
				[0, 0, 0],
				[0, 0.5, 0],
				[0, 1, 0],
				[1, 1, 0],
			],
		};
		const geoJson = buildLockedSegmentGeoJson(route, [0]);

		expect(geoJson.features).toHaveLength(1);
		expect(geoJson.features[0]?.properties).toEqual({
			kind: "locked_segment",
			segmentIndex: 0,
		});
		expect(geoJson.features[0]?.geometry.coordinates).toEqual([
			[0, 0, 0],
			[0, 0.5, 0],
			[0, 1, 0],
		]);
	});

	it("maps coordinate segments back to editable route legs", () => {
		const route: PlannedRoute = {
			...buildRoute([]),
			waypoints: [
				{
					label: "Waypoint",
					coordinate: [0, 1, 10],
				},
			],
			coordinates: [
				[0, 0, 0],
				[0, 0.5, 0],
				[0, 1, 0],
				[1, 1, 0],
			],
		};

		expect(getRouteLegIndexForCoordinateSegment(route, 0)).toBe(0);
		expect(getRouteLegIndexForCoordinateSegment(route, 2)).toBe(1);
	});
});

describe("getWaypointInsertionIndex", () => {
	it("uses the routed leg when the active route still matches the current stops", () => {
		const route: PlannedRoute = {
			mode: "point_to_point",
			source: {
				kind: "graphhopper",
			},
			startLabel: "Start",
			destinationLabel: "Destination",
			waypoints: [
				{
					label: "Waypoint 1",
					coordinate: [0, 1, 10],
				},
			],
			bounds: [0, 0, 2, 2],
			distanceMeters: 1000,
			durationMs: 1000,
			ascendMeters: 10,
			descendMeters: 10,
			coordinates: [
				[0, 0, 0],
				[0, 0.5, 0],
				[0, 1, 0],
				[1, 1, 0],
				[2, 1, 0],
				[2, 2, 0],
			],
			surfaceDetails: [],
			smoothnessDetails: [],
		};

		const stops = getRouteStopInputs(route);

		expect(getWaypointInsertionIndex(stops, [1.9, 1.2], route)).toBe(1);
		expect(getWaypointInsertionIndex(stops, [0.1, 0.6], route)).toBe(0);
	});

	it("falls back to straight-line legs when the current stops no longer match the route", () => {
		const route = buildRoute([{ from: 0, to: 10, value: "ASPHALT" }]);
		const stops: RouteStopInput[] = [
			{
				label: "Edited start",
				point: [0, 0],
			},
			{
				label: "Waypoint",
				point: [0.5, 0.5],
			},
			{
				label: "Destination",
				point: [1, 1],
			},
		];

		expect(getWaypointInsertionIndex(stops, [0.8, 0.9], route)).toBe(1);
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

describe("analyzeRouteClimbs", () => {
	const points = (elevations: number[], stepMeters = 250) =>
		elevations.map((elevationMeters, index) => ({
			distanceMeters: index * stepMeters,
			elevationMeters,
		}));

	it("detects one clear sustained climb", () => {
		const climbs = analyzeRouteClimbs(points([100, 115, 132, 150, 170, 190]));

		expect(climbs).toHaveLength(1);
		expect(climbs[0]).toMatchObject({
			startIndex: 0,
			endIndex: 5,
			category: "Uncategorized",
			isKeyClimb: true,
		});
		expect(climbs[0]?.distanceMeters).toBe(1250);
		expect(climbs[0]?.elevationGainMeters).toBeGreaterThanOrEqual(70);
	});

	it("does not produce false climbs on rolling terrain", () => {
		expect(analyzeRouteClimbs(points([100, 106, 101, 108, 104, 110]))).toEqual(
			[],
		);
	});

	it("keeps brief downhill interruptions inside a larger climb", () => {
		const climbs = analyzeRouteClimbs(
			points([100, 120, 140, 137, 160, 185, 210], 100),
		);

		expect(climbs).toHaveLength(1);
		expect(climbs[0]?.distanceMeters).toBe(600);
		expect(climbs[0]?.elevationGainMeters).toBeGreaterThan(70);
	});

	it("merges adjacent climbs separated by less than 300 m", () => {
		const climbs = analyzeRouteClimbs(
			points([100, 125, 150, 170, 170, 172, 195, 225, 255], 100),
		);

		expect(climbs).toHaveLength(1);
		expect(climbs[0]?.distanceMeters).toBe(800);
	});

	it("does not merge climbs separated by 300 m or more", () => {
		const climbs = analyzeRouteClimbs(
			points([100, 140, 180, 220, 160, 160, 160, 160, 200, 240, 280, 320], 200),
		);

		expect(climbs).toHaveLength(2);
	});

	it("returns no climbs for missing or flat elevation data", () => {
		expect(analyzeRouteClimbs([])).toEqual([]);
		expect(analyzeRouteClimbs(points([100, 100, 100, 100]))).toEqual([]);
	});

	it.each([
		{ gain: 500, grade: 16, category: "HC" },
		{ gain: 300, grade: 16, category: "Cat 1" },
		{ gain: 200, grade: 16, category: "Cat 2" },
		{ gain: 100, grade: 16, category: "Cat 3" },
		{ gain: 50, grade: 16, category: "Cat 4" },
		{ gain: 49, grade: 16, category: "Uncategorized" },
	])("classifies category boundary gain $gain as $category", ({
		gain,
		grade,
		category,
	}) => {
		expect(classifyClimbCategory(gain * grade, gain)).toBe(category);
	});

	it.each([
		{ score: 8000, gain: 499, category: "Cat 1" },
		{ score: 4800, gain: 299, category: "Cat 2" },
		{ score: 3200, gain: 199, category: "Cat 3" },
		{ score: 1600, gain: 99, category: "Cat 4" },
	])("requires gain as well as score when classifying $category fallback", ({
		score,
		gain,
		category,
	}) => {
		expect(classifyClimbCategory(score, gain)).toBe(category);
	});
});
