import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
	analyzeRouteClimbs as analyzeRouteClimbsEffect,
	buildRouteWindGeoJson as buildRouteWindGeoJsonEffect,
	buildRouteReadinessWarnings as buildRouteReadinessWarningsEffect,
	buildRouteGeoJson as buildRouteGeoJsonEffect,
	buildRouteGradientGeoJson as buildRouteGradientGeoJsonEffect,
	buildRouteSurfaceGeoJson as buildRouteSurfaceGeoJsonEffect,
	buildRouteTrafficStressGeoJson as buildRouteTrafficStressGeoJsonEffect,
	buildRouteAvoidanceGeoJson as buildRouteAvoidanceGeoJsonEffect,
	buildLockedSegmentGeoJson as buildLockedSegmentGeoJsonEffect,
	buildSpatialConstraintGeoJson as buildSpatialConstraintGeoJsonEffect,
	calculateBearingDegrees,
	calculateRouteQuality as calculateRouteQualityEffect,
	calculateRouteGradientMetrics as calculateRouteGradientMetricsEffect,
	calculateWindComponents,
	classifyClimbCategory,
	classifyWindBucket,
	getEditableRouteStops as getEditableRouteStopsEffect,
	getProviderWarnings as getProviderWarningsEffect,
	getRouteGradientSections as getRouteGradientSectionsEffect,
	getRouteQuality as getRouteQualityEffect,
	getRouteLegIndexForCoordinateSegment as getRouteLegIndexForCoordinateSegmentOption,
	getRouteSegmentCount,
	getRouteStopInputs as getRouteStopInputsEffect,
	getRouteWarnings as getRouteWarningsEffect,
	getRouteTurnCount,
	getSurfaceMix as getSurfaceMixEffect,
	mergeRouteWarnings as mergeRouteWarningsEffect,
	getWaypointInsertionIndex as getWaypointInsertionIndexEffect,
	isRouteStopLocked,
	mapGraphHopperSignToInstructionType,
	sampleElevationProfile as sampleElevationProfileEffect,
	sanitizeLockedSegmentIndexes,
	type PlannedRoute,
	type RouteCoordinate,
	type RouteStopInput,
} from "./route-planning";

function run<A>(effect: Effect.Effect<A>): A {
	return Effect.runSync(effect);
}

const analyzeRouteClimbs = (
	...args: Parameters<typeof analyzeRouteClimbsEffect>
) => run(analyzeRouteClimbsEffect(...args));
const buildRouteWindGeoJson = (
	...args: Parameters<typeof buildRouteWindGeoJsonEffect>
) => run(buildRouteWindGeoJsonEffect(...args));
const buildRouteReadinessWarnings = (
	...args: Parameters<typeof buildRouteReadinessWarningsEffect>
) => run(buildRouteReadinessWarningsEffect(...args));
const buildRouteGeoJson = (
	...args: Parameters<typeof buildRouteGeoJsonEffect>
) => run(buildRouteGeoJsonEffect(...args));
const buildRouteGradientGeoJson = (
	...args: Parameters<typeof buildRouteGradientGeoJsonEffect>
) => run(buildRouteGradientGeoJsonEffect(...args));
const buildRouteSurfaceGeoJson = (
	...args: Parameters<typeof buildRouteSurfaceGeoJsonEffect>
) => run(buildRouteSurfaceGeoJsonEffect(...args));
const buildRouteTrafficStressGeoJson = (
	...args: Parameters<typeof buildRouteTrafficStressGeoJsonEffect>
) => run(buildRouteTrafficStressGeoJsonEffect(...args));
const buildRouteAvoidanceGeoJson = (
	...args: Parameters<typeof buildRouteAvoidanceGeoJsonEffect>
) => run(buildRouteAvoidanceGeoJsonEffect(...args));
const buildLockedSegmentGeoJson = (
	...args: Parameters<typeof buildLockedSegmentGeoJsonEffect>
) => run(buildLockedSegmentGeoJsonEffect(...args));
const buildSpatialConstraintGeoJson = (
	...args: Parameters<typeof buildSpatialConstraintGeoJsonEffect>
) => run(buildSpatialConstraintGeoJsonEffect(...args));
const calculateRouteQuality = (
	...args: Parameters<typeof calculateRouteQualityEffect>
) => run(calculateRouteQualityEffect(...args));
const calculateRouteGradientMetrics = (
	...args: Parameters<typeof calculateRouteGradientMetricsEffect>
) => run(calculateRouteGradientMetricsEffect(...args));
const getEditableRouteStops = (
	...args: Parameters<typeof getEditableRouteStopsEffect>
) => run(getEditableRouteStopsEffect(...args));
const getProviderWarnings = (
	...args: Parameters<typeof getProviderWarningsEffect>
) => run(getProviderWarningsEffect(...args));
const getRouteGradientSections = (
	...args: Parameters<typeof getRouteGradientSectionsEffect>
) => run(getRouteGradientSectionsEffect(...args));
const getRouteQuality = (...args: Parameters<typeof getRouteQualityEffect>) =>
	run(getRouteQualityEffect(...args));
const getRouteLegIndexForCoordinateSegment = (
	...args: Parameters<typeof getRouteLegIndexForCoordinateSegmentOption>
) =>
	Option.getOrElse(
		getRouteLegIndexForCoordinateSegmentOption(...args),
		() => null,
	);
const getRouteStopInputs = (
	...args: Parameters<typeof getRouteStopInputsEffect>
) => run(getRouteStopInputsEffect(...args));
const getRouteWarnings = (...args: Parameters<typeof getRouteWarningsEffect>) =>
	run(getRouteWarningsEffect(...args));
const getSurfaceMix = (...args: Parameters<typeof getSurfaceMixEffect>) =>
	run(getSurfaceMixEffect(...args));
const mergeRouteWarnings = (
	...args: Parameters<typeof mergeRouteWarningsEffect>
) => run(mergeRouteWarningsEffect(...args));
const getWaypointInsertionIndex = (
	...args: Parameters<typeof getWaypointInsertionIndexEffect>
) => run(getWaypointInsertionIndexEffect(...args));
const sampleElevationProfile = (
	...args: Parameters<typeof sampleElevationProfileEffect>
) => run(sampleElevationProfileEffect(...args));

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
		instructions: [],
		surfaceDetails,
		smoothnessDetails,
	};
}

describe("route instruction helpers", () => {
	it("maps GraphHopper signs to normalized instruction types", () => {
		expect(mapGraphHopperSignToInstructionType(-3)).toBe("sharp_left");
		expect(mapGraphHopperSignToInstructionType(-2)).toBe("left");
		expect(mapGraphHopperSignToInstructionType(-1)).toBe("slight_left");
		expect(mapGraphHopperSignToInstructionType(0)).toBe("continue");
		expect(mapGraphHopperSignToInstructionType(1)).toBe("slight_right");
		expect(mapGraphHopperSignToInstructionType(2)).toBe("right");
		expect(mapGraphHopperSignToInstructionType(3)).toBe("sharp_right");
		expect(mapGraphHopperSignToInstructionType(4)).toBe("finish");
		expect(mapGraphHopperSignToInstructionType(5)).toBe("via");
		expect(mapGraphHopperSignToInstructionType(6)).toBe("roundabout");
		expect(mapGraphHopperSignToInstructionType(-6)).toBe("leave_roundabout");
		expect(mapGraphHopperSignToInstructionType(-7)).toBe("keep_left");
		expect(mapGraphHopperSignToInstructionType(7)).toBe("keep_right");
		expect(mapGraphHopperSignToInstructionType(-98)).toBe("u_turn");
		expect(mapGraphHopperSignToInstructionType(999)).toBe("unknown");
	});

	it("counts actionable turns and excludes continue, via, and finish", () => {
		const route = buildRoute([], []);
		route.instructions = [
			"continue",
			"left",
			"right",
			"keep_left",
			"roundabout",
			"leave_roundabout",
			"u_turn",
			"unknown",
			"via",
			"finish",
		].map((type, index) => ({
			distanceFromStartMeters: index * 100,
			text: type,
			sign: type === "unknown" ? 42 : index,
			type: type as NonNullable<PlannedRoute["instructions"]>[number]["type"],
			segmentDistanceMeters: 100,
			segmentTimeMs: 10000,
			coordinateIndex: 0,
			coordinate: route.coordinates[0],
			interval: [0, 1],
		}));

		expect(getRouteTurnCount(route)).toBe(7);
	});
});

function buildQualityRoute(
	overrides: Partial<PlannedRoute> = {},
): PlannedRoute {
	const route: PlannedRoute = {
		mode: "point_to_point",
		source: { kind: "graphhopper" },
		startLabel: "Start",
		destinationLabel: "Finish",
		waypoints: [],
		bounds: [0, 0, 0.1, 0],
		distanceMeters: 11119,
		durationMs: 1800000,
		ascendMeters: 80,
		descendMeters: 60,
		coordinates: [
			[0, 0, 100],
			[0.05, 0, 130],
			[0.1, 0, 180],
		],
		instructions: [],
		surfaceDetails: [{ from: 0, to: 2, value: "asphalt" }],
		smoothnessDetails: [{ from: 0, to: 2, value: "good" }],
		roadClassDetails: [{ from: 0, to: 2, value: "tertiary" }],
		roadEnvironmentDetails: [{ from: 0, to: 2, value: "road" }],
		roadAccessDetails: [{ from: 0, to: 2, value: "yes" }],
		bikeNetworkDetails: [{ from: 0, to: 2, value: "local" }],
	};

	return {
		...route,
		...overrides,
	};
}

function buildTurnInstructions(
	route: PlannedRoute,
	count: number,
	type: NonNullable<PlannedRoute["instructions"]>[number]["type"] = "left",
) {
	return Array.from({ length: count }, (_, index) => ({
		distanceFromStartMeters: index * 100,
		text: `${type} ${index}`,
		sign: type === "u_turn" ? 98 : 2,
		type,
		segmentDistanceMeters: 100,
		segmentTimeMs: 10000,
		coordinateIndex: 0,
		coordinate: route.coordinates[0] as RouteCoordinate,
		interval: [0, 1] as [number, number],
	}));
}

describe("route quality scoring", () => {
	it("scores smooth asphalt road-training routes highly", () => {
		const quality = calculateRouteQuality(buildQualityRoute());

		expect(quality.overallScore).toBeGreaterThan(80);
		expect(quality.subscores.surface.score).toBe(100);
		expect(quality.subscores.roadQuality.score).toBeGreaterThan(85);
		expect(quality.confidence).toBe("medium");
	});

	it("penalizes gravel/coarse routes for surface and road quality", () => {
		const quality = calculateRouteQuality(
			buildQualityRoute({
				surfaceDetails: [{ from: 0, to: 2, value: "gravel" }],
				roadClassDetails: [{ from: 0, to: 2, value: "track" }],
			}),
		);

		expect(quality.subscores.surface.score).toBeLessThan(20);
		expect(quality.subscores.roadQuality.score).toBeLessThan(45);
	});

	it("penalizes primary and trunk exposure for traffic stress and safety", () => {
		const quality = calculateRouteQuality(
			buildQualityRoute({
				roadClassDetails: [
					{ from: 0, to: 1, value: "primary" },
					{ from: 1, to: 2, value: "trunk" },
				],
				bikeNetworkDetails: [],
			}),
		);

		expect(quality.subscores.trafficStress.score).toBeLessThan(30);
		expect(quality.subscores.safety.score).toBeLessThan(60);
	});

	it("normalizes traffic stress weights when one detail source is missing", () => {
		const roadClassOnly = calculateRouteQuality(
			buildQualityRoute({
				roadClassDetails: [{ from: 0, to: 2, value: "primary" }],
				roadAccessDetails: [],
				bikeNetworkDetails: [],
			}),
		);
		const accessOnly = calculateRouteQuality(
			buildQualityRoute({
				roadClassDetails: [],
				roadAccessDetails: [{ from: 0, to: 2, value: "private" }],
				bikeNetworkDetails: [],
			}),
		);

		expect(roadClassOnly.subscores.trafficStress.score).toBe(20);
		expect(accessOnly.subscores.trafficStress.score).toBe(0);
	});

	it("penalizes residential and service-heavy routes for urban exposure and flow", () => {
		const route = buildQualityRoute({
			roadClassDetails: [
				{ from: 0, to: 1, value: "residential" },
				{ from: 1, to: 2, value: "service" },
			],
			roadEnvironmentDetails: [{ from: 0, to: 2, value: "urban" }],
		});
		route.instructions = buildTurnInstructions(route, 10);
		const quality = calculateRouteQuality(route);

		expect(quality.subscores.urbanExposure.score).toBeLessThan(25);
		expect(quality.subscores.flow.score).toBeLessThan(70);
	});

	it("lowers flow and interruption risk for high turn density", () => {
		const route = buildQualityRoute({
			distanceMeters: 5000,
			roadAccessDetails: [{ from: 0, to: 2, value: "destination" }],
		});
		route.instructions = [
			...buildTurnInstructions(route, 22),
			...buildTurnInstructions(route, 2, "roundabout"),
			...buildTurnInstructions(route, 1, "u_turn"),
		];
		const quality = calculateRouteQuality(route);

		expect(quality.subscores.flow.score).toBeLessThan(55);
		expect(quality.subscores.interruptionRisk.score).toBeLessThan(55);
	});

	it("penalizes strong headwind and crosswind exposure", () => {
		const quality = calculateRouteQuality(
			buildQualityRoute({
				windAnalysis: {
					source: "open_meteo",
					fetchedAt: "2026-05-26T10:00:00.000Z",
					forecastTime: "2026-05-26T10:00",
					samples: [],
					segments: [],
					averageHeadwindKmh: 18,
					maxHeadwindKmh: 34,
					averageTailwindKmh: 0,
					maxCrosswindKmh: 28,
					headwindDistanceMeters: 8000,
					tailwindDistanceMeters: 0,
					crosswindDistanceMeters: 3119,
				},
			}),
		);

		expect(quality.subscores.windExposure.score).toBeLessThan(20);
		expect(quality.confidence).toBe("high");
	});

	it("penalizes very steep routes for gradient suitability", () => {
		const quality = calculateRouteQuality(
			buildQualityRoute({
				distanceMeters: 1000,
				ascendMeters: 220,
				coordinates: [
					[0, 0, 100],
					[0.001, 0, 100],
					[0.002, 0, 130],
					[0.003, 0, 170],
					[0.004, 0, 220],
				],
			}),
		);

		expect(quality.subscores.gradientSuitability.score).toBeLessThan(50);
	});

	it("penalizes inefficient point-to-point geometry", () => {
		const quality = calculateRouteQuality(
			buildQualityRoute({
				distanceMeters: 30000,
				coordinates: [
					[0, 0, 100],
					[0.05, 0.05, 110],
					[0.1, 0, 120],
				],
			}),
		);

		expect(quality.subscores.routeEfficiency.score).toBeLessThan(40);
	});

	it("handles missing details without treating unavailable subscores as zero", () => {
		const quality = calculateRouteQuality(
			buildQualityRoute({
				surfaceDetails: [],
				smoothnessDetails: [],
				roadClassDetails: undefined,
				roadEnvironmentDetails: undefined,
				roadAccessDetails: undefined,
				bikeNetworkDetails: undefined,
			}),
		);

		expect(quality.confidence).toBe("low");
		expect(quality.subscores.surface.score).toBeNull();
		expect(quality.subscores.trafficStress.score).toBeNull();
		expect(quality.overallScore).not.toBeNull();
		expect(quality.overallScore).toBeGreaterThan(60);
	});

	it("returns persisted route quality when present", () => {
		const route = buildQualityRoute();
		const routeQuality = calculateRouteQuality(route);

		expect(getRouteQuality({ ...route, routeQuality })).toBe(routeQuality);
	});
});

describe("traffic stress GeoJSON", () => {
	function buildTrafficStressRoute(
		overrides: Partial<PlannedRoute> = {},
	): PlannedRoute {
		return buildQualityRoute({
			distanceMeters: 4000,
			coordinates: [
				[0, 0, 10],
				[0.01, 0, 10],
				[0.02, 0, 10],
				[0.03, 0, 10],
				[0.04, 0, 10],
			],
			roadClassDetails: [],
			roadAccessDetails: [],
			bikeNetworkDetails: [],
			...overrides,
		});
	}

	it("builds traffic stress GeoJSON and classifies all buckets", () => {
		const geoJson = buildRouteTrafficStressGeoJson(
			buildTrafficStressRoute({
				roadClassDetails: [
					{ from: 0, to: 1, value: "cycleway" },
					{ from: 1, to: 2, value: "tertiary" },
					{ from: 2, to: 3, value: "secondary" },
					{ from: 3, to: 4, value: "primary" },
				],
			}),
		);

		expect(
			geoJson.features.flatMap((feature) =>
				feature.properties?.kind === "traffic_stress"
					? [feature.properties.trafficStressBucket]
					: [],
			),
		).toEqual(["low", "moderate", "elevated", "high"]);
		expect(
			geoJson.features.flatMap((feature) =>
				feature.properties?.kind === "traffic_stress"
					? [feature.properties.trafficStressScore]
					: [],
			),
		).toEqual([100, 65, 45, 20]);
	});

	it("applies access penalties and bike-network offsets", () => {
		const geoJson = buildRouteTrafficStressGeoJson(
			buildTrafficStressRoute({
				roadClassDetails: [
					{ from: 0, to: 1, value: "primary" },
					{ from: 1, to: 2, value: "residential" },
				],
				roadAccessDetails: [{ from: 1, to: 2, value: "destination" }],
				bikeNetworkDetails: [{ from: 0, to: 1, value: "regional" }],
			}),
		);

		expect(
			geoJson.features.flatMap((feature) =>
				feature.properties?.kind === "traffic_stress"
					? [
							{
								bucket: feature.properties.trafficStressBucket,
								score: feature.properties.trafficStressScore,
							},
						]
					: [],
			),
		).toEqual([
			{ bucket: "high", score: 35 },
			{ bucket: "moderate", score: 79 },
		]);
	});

	it("classifies access-only restricted segments as high stress", () => {
		const geoJson = buildRouteTrafficStressGeoJson(
			buildTrafficStressRoute({
				roadClassDetails: undefined,
				roadAccessDetails: [{ from: 0, to: 1, value: "private" }],
			}),
		);

		const trafficStressFeature = geoJson.features.find(
			(feature) => feature.properties?.kind === "traffic_stress",
		);

		expect(trafficStressFeature?.properties).toMatchObject({
			kind: "traffic_stress",
			trafficStressBucket: "high",
			trafficStressScore: 0,
		});
	});

	it("merges adjacent same-bucket traffic stress segments", () => {
		const geoJson = buildRouteTrafficStressGeoJson(
			buildTrafficStressRoute({
				roadClassDetails: [
					{ from: 0, to: 1, value: "residential" },
					{ from: 1, to: 2, value: "service" },
					{ from: 2, to: 3, value: "primary" },
				],
			}),
		);

		expect(geoJson.features).toHaveLength(2);
		expect(geoJson.features[0]?.properties).toMatchObject({
			kind: "traffic_stress",
			trafficStressBucket: "low",
		});
		expect(geoJson.features[0]?.geometry.coordinates).toHaveLength(3);
	});

	it("distance-weights merged traffic stress scores", () => {
		const geoJson = buildRouteTrafficStressGeoJson(
			buildTrafficStressRoute({
				coordinates: [
					[0, 0, 10],
					[0.001, 0, 10],
					[0.011, 0, 10],
				],
				roadClassDetails: [
					{ from: 0, to: 1, value: "cycleway" },
					{ from: 1, to: 2, value: "residential" },
				],
			}),
		);

		expect(geoJson.features).toHaveLength(1);
		expect(geoJson.features[0]?.properties).toMatchObject({
			kind: "traffic_stress",
			trafficStressBucket: "low",
			trafficStressScore: 84,
		});
	});

	it("skips missing, unknown, degenerate, fractional, negative, and out-of-bounds intervals", () => {
		const geoJson = buildRouteTrafficStressGeoJson(
			buildTrafficStressRoute({
				coordinates: [
					[0, 0, 10],
					[0, 0, 10],
					[0.01, 0, 10],
					[0.02, 0, 10],
				],
				roadClassDetails: [
					{ from: 0, to: 1, value: "primary" },
					{ from: 1, to: 2, value: "missing" },
					{ from: 2, to: 3, value: "unknown" },
					{ from: 0.5, to: 2, value: "primary" },
					{ from: -1, to: 2, value: "primary" },
					{ from: 2, to: 4, value: "primary" },
					{ from: 2, to: 3, value: "cycleway" },
				],
			}),
		);

		expect(geoJson.features).toHaveLength(1);
		expect(geoJson.features[0]?.properties).toMatchObject({
			kind: "traffic_stress",
			trafficStressBucket: "low",
		});
		expect(geoJson.features[0]?.geometry.coordinates).toEqual([
			[0.01, 0, 10],
			[0.02, 0, 10],
		]);
	});
});

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

describe("wind route analysis helpers", () => {
	it("calculates cardinal bearings", () => {
		expect(Math.round(calculateBearingDegrees([0, 0], [0, 1]))).toBe(0);
		expect(Math.round(calculateBearingDegrees([0, 0], [1, 0]))).toBe(90);
		expect(Math.round(calculateBearingDegrees([0, 0], [0, -1]))).toBe(180);
		expect(Math.round(calculateBearingDegrees([0, 0], [-1, 0]))).toBe(270);
	});

	it("classifies wind components by relative route angle", () => {
		expect(classifyWindBucket(0)).toBe("headwind");
		expect(classifyWindBucket(180)).toBe("tailwind");
		expect(classifyWindBucket(90)).toBe("crosswind");
		expect(classifyWindBucket(45)).toBe("cross_headwind");
		expect(classifyWindBucket(135)).toBe("cross_tailwind");

		expect(
			calculateWindComponents({
				speedKmh: 20,
				windDirectionDegrees: 0,
				routeBearingDegrees: 0,
			}),
		).toMatchObject({
			bucket: "headwind",
			headwindComponentKmh: 20,
		});
		expect(
			Math.round(
				calculateWindComponents({
					speedKmh: 20,
					windDirectionDegrees: 180,
					routeBearingDegrees: 0,
				}).headwindComponentKmh,
			),
		).toBe(-20);
	});

	it("builds wind GeoJSON features and skips invalid intervals", () => {
		const route: PlannedRoute = {
			...buildRoute([], []),
			coordinates: [
				[0, 0],
				[0, 1],
				[1, 1],
			],
			windAnalysis: {
				source: "open_meteo",
				fetchedAt: "2026-05-10T10:00:00.000Z",
				forecastTime: "2026-05-10T10:00",
				samples: [],
				segments: [
					{
						from: 0,
						to: 1,
						speedKmh: 18,
						directionDegrees: 0,
						routeBearingDegrees: 0,
						relativeAngleDegrees: 0,
						headwindComponentKmh: 18,
						crosswindComponentKmh: 0,
						bucket: "headwind",
					},
					{
						from: 2,
						to: 9,
						speedKmh: 18,
						directionDegrees: 0,
						routeBearingDegrees: 0,
						relativeAngleDegrees: 0,
						headwindComponentKmh: 18,
						crosswindComponentKmh: 0,
						bucket: "headwind",
					},
				],
				averageHeadwindKmh: 18,
				maxHeadwindKmh: 18,
				averageTailwindKmh: 0,
				maxCrosswindKmh: 0,
				headwindDistanceMeters: 1000,
				tailwindDistanceMeters: 0,
				crosswindDistanceMeters: 0,
			},
		};

		const geoJson = buildRouteWindGeoJson(route);

		expect(geoJson.features).toHaveLength(1);
		expect(geoJson.features[0]?.properties).toMatchObject({
			kind: "wind",
			windBucket: "headwind",
			speedKmh: 18,
		});
	});
});

describe("route readiness warnings", () => {
	function buildReadinessRoute(
		overrides: Partial<PlannedRoute> = {},
	): PlannedRoute {
		return {
			...buildRoute([], []),
			waypoints: [],
			distanceMeters: 20000,
			ascendMeters: 0,
			descendMeters: 0,
			coordinates: [
				[0, 0, 0],
				[0, 0.09, 0],
				[0, 0.18, 0],
			],
			surfaceDetails: [],
			smoothnessDetails: [],
			...overrides,
		};
	}

	it("builds a coarse-surface warning from surfaceDetails", () => {
		const warnings = buildRouteReadinessWarnings(
			buildReadinessRoute({
				surfaceDetails: [
					{ from: 0, to: 1, value: "asphalt" },
					{ from: 1, to: 2, value: "gravel" },
				],
			}),
		);

		expect(warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "coarse_surface_exposure",
					severity: "warning",
				}),
			]),
		);
	});

	it("falls back to smoothnessDetails when surface details are missing", () => {
		const warnings = buildRouteReadinessWarnings(
			buildReadinessRoute({
				smoothnessDetails: [
					{ from: 0, to: 1, value: "good" },
					{ from: 1, to: 2, value: "bad" },
				],
			}),
		);

		expect(warnings.map((warning) => warning.code)).toContain(
			"coarse_surface_exposure",
		);
	});

	it("emits no surface warning for mostly smooth surfaces", () => {
		const warnings = buildRouteReadinessWarnings(
			buildReadinessRoute({
				surfaceDetails: [{ from: 0, to: 2, value: "asphalt" }],
			}),
		);

		expect(warnings.some((warning) => warning.code.includes("surface"))).toBe(
			false,
		);
	});

	it("emits missing-surface-analysis info for generated routes without surface details", () => {
		const warnings = buildRouteReadinessWarnings(buildReadinessRoute());

		expect(warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "surface_analysis_unavailable",
					severity: "info",
				}),
			]),
		);
	});

	it("builds headwind and crosswind warnings from windAnalysis", () => {
		const warnings = buildRouteReadinessWarnings(
			buildReadinessRoute({
				windAnalysis: {
					source: "open_meteo",
					fetchedAt: "2026-05-18T10:00:00.000Z",
					forecastTime: "2026-05-18T10:00",
					samples: [],
					segments: [],
					averageHeadwindKmh: 18,
					maxHeadwindKmh: 29,
					averageTailwindKmh: 0,
					maxCrosswindKmh: 26,
					headwindDistanceMeters: 8000,
					tailwindDistanceMeters: 0,
					crosswindDistanceMeters: 4000,
				},
			}),
		);

		expect(warnings.map((warning) => warning.code)).toEqual(
			expect.arrayContaining([
				"strong_headwind_exposure",
				"strong_crosswind_exposure",
			]),
		);
	});

	it("builds steep-gradient and major-climb warnings from elevation coordinates", () => {
		const coordinates = Array.from(
			{ length: 31 },
			(_, index): RouteCoordinate => [0, index * 0.0015, index * 32],
		);
		const warnings = buildRouteReadinessWarnings(
			buildReadinessRoute({
				distanceMeters: 50000,
				ascendMeters: 960,
				coordinates,
				surfaceDetails: [{ from: 0, to: 30, value: "asphalt" }],
				windAnalysis: {
					source: "open_meteo",
					fetchedAt: "2026-05-18T10:00:00.000Z",
					forecastTime: "2026-05-18T10:00",
					samples: [],
					segments: [],
					averageHeadwindKmh: 0,
					maxHeadwindKmh: 0,
					averageTailwindKmh: 0,
					maxCrosswindKmh: 0,
					headwindDistanceMeters: 0,
					tailwindDistanceMeters: 0,
					crosswindDistanceMeters: 0,
				},
			}),
		);

		expect(warnings.map((warning) => warning.code)).toEqual(
			expect.arrayContaining(["steep_gradient", "major_climb"]),
		);
	});

	it("builds low-efficiency warning for a very indirect point-to-point route", () => {
		const warnings = buildRouteReadinessWarnings(
			buildReadinessRoute({
				distanceMeters: 20000,
				coordinates: [
					[0, 0],
					[0.1, 0.1],
					[0.05, 0],
				],
				surfaceDetails: [{ from: 0, to: 2, value: "asphalt" }],
				windAnalysis: {
					source: "open_meteo",
					fetchedAt: "2026-05-18T10:00:00.000Z",
					forecastTime: "2026-05-18T10:00",
					samples: [],
					segments: [],
					averageHeadwindKmh: 0,
					maxHeadwindKmh: 0,
					averageTailwindKmh: 0,
					maxCrosswindKmh: 0,
					headwindDistanceMeters: 0,
					tailwindDistanceMeters: 0,
					crosswindDistanceMeters: 0,
				},
			}),
		);

		expect(warnings.map((warning) => warning.code)).toContain(
			"low_route_efficiency",
		);
	});

	it("converts legacy routingWarnings into provider warnings", () => {
		const route = buildReadinessRoute({
			routingWarnings: ["Legacy fallback."],
		});

		expect(getRouteWarnings(route)).toEqual([
			expect.objectContaining({
				category: "routing_provider",
				code: "routing_profile_fallback",
				message: "Legacy fallback.",
			}),
		]);
		expect(getProviderWarnings(route)).toHaveLength(1);
	});

	it("deduplicates warnings by category, code, and title", () => {
		const route = mergeRouteWarnings(
			buildReadinessRoute({
				warnings: [
					{
						category: "readiness",
						code: "steep_gradient",
						severity: "caution",
						title: "Steep gradient",
						message: "First",
					},
				],
			}),
			[
				{
					category: "readiness",
					code: "steep_gradient",
					severity: "warning",
					title: "Steep gradient",
					message: "Second",
				},
			],
		);

		expect(route.warnings).toHaveLength(1);
		expect(route.warnings?.[0]?.message).toBe("First");
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

describe("buildRouteGradientGeoJson", () => {
	const gradientRoute = (
		coordinates: PlannedRoute["coordinates"],
	): PlannedRoute => ({
		...buildRoute([], []),
		coordinates,
	});

	it("classifies uphill, downhill, flat, and steep gradient buckets", () => {
		const bucketFor = (fromElevation: number, toElevation: number) => {
			const feature = buildRouteGradientGeoJson(
				gradientRoute([
					[0, 0, fromElevation],
					[0.001, 0, toElevation],
				]),
			).features[0];

			return feature?.properties?.kind === "gradient"
				? feature.properties.gradientBucket
				: null;
		};

		expect(bucketFor(100, 92)).toBe("steep_down");
		expect(bucketFor(100, 96)).toBe("down");
		expect(bucketFor(100, 98)).toBe("mild_down");
		expect(bucketFor(100, 100.5)).toBe("flat");
		expect(bucketFor(100, 102)).toBe("mild_up");
		expect(bucketFor(100, 104)).toBe("up");
		expect(bucketFor(100, 108)).toBe("steep_up");
	});

	it("returns no gradient features when elevation samples are missing", () => {
		const geoJson = buildRouteGradientGeoJson(
			gradientRoute([
				[0, 0],
				[0.001, 0],
			]),
		);

		expect(geoJson.features).toEqual([]);
	});

	it("merges adjacent same-bucket segments into one feature", () => {
		const coordinates: PlannedRoute["coordinates"] = [
			[0, 0, 100],
			[0.001, 0, 104],
			[0.002, 0, 108],
		];
		const geoJson = buildRouteGradientGeoJson(gradientRoute(coordinates));

		expect(geoJson.features).toHaveLength(1);
		expect(geoJson.features[0]?.properties).toMatchObject({
			kind: "gradient",
			gradientBucket: "up",
		});
		expect(geoJson.features[0]?.geometry.coordinates).toEqual(coordinates);
	});

	it("skips zero-distance gradient segments", () => {
		const geoJson = buildRouteGradientGeoJson(
			gradientRoute([
				[0, 0, 100],
				[0, 0, 120],
			]),
		);

		expect(geoJson.features).toEqual([]);
	});
});

describe("getRouteGradientSections", () => {
	const gradientRoute = (
		coordinates: PlannedRoute["coordinates"],
	): PlannedRoute => ({
		...buildRoute([], []),
		coordinates,
	});

	it("returns no sections when elevation samples are missing", () => {
		expect(
			getRouteGradientSections(
				gradientRoute([
					[0, 0],
					[0.001, 0],
				]),
			),
		).toEqual([]);
	});

	it("merges adjacent same-bucket intervals", () => {
		const coordinates: PlannedRoute["coordinates"] = [
			[0, 0, 100],
			[0.001, 0, 104],
			[0.002, 0, 108],
		];
		const sections = getRouteGradientSections(gradientRoute(coordinates));

		expect(sections).toHaveLength(1);
		expect(sections[0]).toMatchObject({
			bucket: "up",
			coordinates,
		});
	});

	it("calculates section distance, elevation delta, and average grade", () => {
		const sections = getRouteGradientSections(
			gradientRoute([
				[0, 0, 100],
				[0.001, 0, 104],
			]),
		);

		expect(sections).toHaveLength(1);
		expect(sections[0]?.startDistanceMeters).toBe(0);
		expect(sections[0]?.endDistanceMeters).toBeCloseTo(111.2, 1);
		expect(sections[0]?.distanceMeters).toBeCloseTo(111.2, 1);
		expect(sections[0]?.elevationDeltaMeters).toBeCloseTo(4, 5);
		expect(sections[0]?.averageGradePercent).toBeCloseTo(3.6, 1);
	});

	it("retains flat sections for shared overlay data", () => {
		const sections = getRouteGradientSections(
			gradientRoute([
				[0, 0, 100],
				[0.001, 0, 100.5],
				[0.002, 0, 100.8],
			]),
		);

		expect(sections).toHaveLength(1);
		expect(sections[0]?.bucket).toBe("flat");
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

describe("buildRouteAvoidanceGeoJson", () => {
	it("builds polygon and centerline features for avoided roads", () => {
		const geoJson = buildRouteAvoidanceGeoJson([
			{
				kind: "road_segment",
				label: "Avoided road 1",
				centerline: [
					[11.5755, 48.1374],
					[11.58, 48.14],
				],
				bufferMeters: 35,
				polygon: [
					[11.57, 48.13],
					[11.59, 48.13],
					[11.59, 48.15],
					[11.57, 48.15],
				],
			},
		]);

		expect(geoJson.features).toHaveLength(2);
		expect(geoJson.features.map((feature) => feature.geometry.type)).toEqual([
			"Polygon",
			"LineString",
		]);
		expect(geoJson.features[0]?.properties).toMatchObject({
			kind: "route_avoidance",
			avoidanceKind: "road_segment",
			label: "Avoided road 1",
			index: 0,
		});
		expect(
			geoJson.features[0]?.geometry.type === "Polygon"
				? geoJson.features[0].geometry.coordinates[0]?.at(-1)
				: null,
		).toEqual([11.57, 48.13]);
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

describe("calculateRouteGradientMetrics", () => {
	const routeWithMetrics = (
		overrides: Partial<PlannedRoute>,
	): PlannedRoute => ({
		...buildRoute([], []),
		...overrides,
	});
	const coordinates = (elevations: number[]): PlannedRoute["coordinates"] =>
		elevations.map((elevationMeters, index) => [
			index * 0.001,
			0,
			elevationMeters,
		]) as PlannedRoute["coordinates"];
	const coordinatesWithStep = (
		elevations: number[],
		longitudeStep: number,
	): PlannedRoute["coordinates"] =>
		elevations.map((elevationMeters, index) => [
			index * longitudeStep,
			0,
			elevationMeters,
		]) as PlannedRoute["coordinates"];

	it("calculates average gradient from total ascent and route distance", () => {
		const metrics = calculateRouteGradientMetrics(
			routeWithMetrics({
				distanceMeters: 10_000,
				ascendMeters: 500,
				coordinates: coordinates([100, 150]),
			}),
		);

		expect(metrics.averageGradientPercent).toBe(5);
	});

	it("smooths maximum gradient so a single elevation spike is reduced", () => {
		const metrics = calculateRouteGradientMetrics(
			routeWithMetrics({
				distanceMeters: 700,
				ascendMeters: 150,
				coordinates: coordinates([100, 100, 100, 250, 100, 100, 100]),
			}),
		);

		expect(metrics.maximumGradientPercent).not.toBeNull();
		expect(metrics.maximumGradientPercent).toBeGreaterThan(0);
		expect(metrics.maximumGradientPercent).toBeLessThan(50);
	});

	it("ignores uphill spikes shorter than the minimum gradient window", () => {
		const metrics = calculateRouteGradientMetrics(
			routeWithMetrics({
				distanceMeters: 120,
				ascendMeters: 50,
				coordinates: [
					[0, 0, 0],
					[0.00089, 0, 50],
					[0.00091, 0, 1],
				],
			}),
		);

		expect(metrics.maximumGradientPercent).not.toBeNull();
		expect(metrics.maximumGradientPercent).toBeLessThan(2);
	});

	it("handles long dense routes without changing flat-route maximum gradients", () => {
		const elevations = Array.from({ length: 8_000 }, () => 250);

		const metrics = calculateRouteGradientMetrics(
			routeWithMetrics({
				distanceMeters: 8_000 * 50,
				ascendMeters: 0,
				coordinates: coordinatesWithStep(elevations, 0.00045),
			}),
		);

		expect(metrics.maximumGradientPercent).toBeNull();
	});

	it("returns null maximum gradient for flat or downhill profiles", () => {
		expect(
			calculateRouteGradientMetrics(
				routeWithMetrics({
					coordinates: coordinates([200, 180, 160, 140]),
				}),
			).maximumGradientPercent,
		).toBeNull();
		expect(
			calculateRouteGradientMetrics(
				routeWithMetrics({
					coordinates: coordinates([150, 150, 150, 150]),
				}),
			).maximumGradientPercent,
		).toBeNull();
	});

	it("returns null maximum gradient when elevation samples are missing", () => {
		expect(
			calculateRouteGradientMetrics(
				routeWithMetrics({
					coordinates: [
						[0, 0],
						[0.001, 0],
					],
				}),
			).maximumGradientPercent,
		).toBeNull();
	});

	it("returns null average gradient for invalid or zero distance", () => {
		expect(
			calculateRouteGradientMetrics(
				routeWithMetrics({
					distanceMeters: 0,
					coordinates: coordinates([100, 120]),
				}),
			).averageGradientPercent,
		).toBeNull();
		expect(
			calculateRouteGradientMetrics(
				routeWithMetrics({
					distanceMeters: Number.NaN,
					coordinates: coordinates([100, 120]),
				}),
			).averageGradientPercent,
		).toBeNull();
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
