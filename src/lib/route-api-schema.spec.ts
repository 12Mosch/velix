import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	assertRouteApiErrorPayload,
	assertRouteApiSuccessPayload,
	decodeRouteRequestPayload,
	PlannedRouteSchema,
	RemoteSavedRoutePayloadSchema,
	SavedRouteSchema,
	RouteAvoidanceInputSchema,
	RouteSpatialConstraintInputSchema,
	RouteStopInputSchema,
} from "$lib/route-api-schema";
import { normalizePlannedRoute } from "$lib/saved-routes-core";
import { calculateRouteQuality, type PlannedRoute } from "$lib/route-planning";

function expectDecodedPayload(value: unknown) {
	const result = decodeRouteRequestPayload(value);

	expect(result.ok).toBe(true);

	if (!result.ok) {
		throw new Error(result.error);
	}

	return result.payload;
}

function buildValidRoute(): PlannedRoute {
	return {
		mode: "point_to_point",
		source: {
			kind: "graphhopper",
		},
		startLabel: "Munich",
		destinationLabel: "Berlin",
		waypoints: [
			{
				label: "Tegernsee",
				coordinate: [11.7581, 47.7123, 734],
			},
		],
		bounds: [11.5, 47.7, 13.4, 52.5],
		distanceMeters: 61234,
		durationMs: 9876000,
		ascendMeters: 820,
		descendMeters: 740,
		coordinates: [
			[11.5755, 48.1374],
			[13.405, 52.52, 40],
		],
		instructions: [],
		surfaceDetails: [{ from: 0, to: 1, value: "ASPHALT" }],
		smoothnessDetails: [{ from: 0, to: 1, value: "GOOD" }],
		roadClassDetails: [{ from: 0, to: 1, value: "TERTIARY" }],
		roadEnvironmentDetails: [{ from: 0, to: 1, value: "ROAD" }],
		roadAccessDetails: [{ from: 0, to: 1, value: "YES" }],
		bikeNetworkDetails: [],
	};
}

describe("route API schema helpers", () => {
	it("rejects invalid top-level payloads", () => {
		for (const value of [null, [], "route", 42]) {
			expect(decodeRouteRequestPayload(value)).toEqual({
				ok: false,
				error: "Invalid route request payload.",
			});
		}
	});

	it("accepts legacy payloads", () => {
		expectDecodedPayload({
			startQuery: "Munich",
			waypointQueries: ["Tegernsee"],
			destinationQuery: "Berlin",
		});
	});

	it("accepts structured point-to-point payloads", () => {
		expectDecodedPayload({
			mode: "point_to_point",
			start: {
				label: "Munich",
				point: [11.5755, 48.1374, 520],
			},
			waypoints: [""],
			destination: "Berlin",
		});
	});

	it("rejects structured payloads with out-of-bounds stop coordinates", () => {
		expect(
			decodeRouteRequestPayload({
				mode: "point_to_point",
				start: {
					point: [181, 48.1374],
				},
				destination: {
					point: [11.8598, 95],
				},
			}),
		).toEqual({
			ok: false,
			error: "Invalid route request payload.",
		});
	});

	it("accepts structured round-course payloads with target or legacy distance", () => {
		expectDecodedPayload({
			mode: "round_course",
			start: "Munich",
			target: {
				kind: "distance",
				distanceMeters: 50000,
			},
		});

		expectDecodedPayload({
			mode: "round_course",
			start: "Munich",
			requestedDistanceMeters: 50000,
		});

		expectDecodedPayload({
			mode: "round_course",
			start: "Munich",
			target: {
				kind: "workout",
				durationMs: 3600000,
				distanceMeters: 23000,
				estimatedSpeedMetersPerHour: 23000,
				weightedIntensity: 0.75,
			},
		});
	});

	it("accepts structured out-and-back payloads", () => {
		expectDecodedPayload({
			mode: "out_and_back",
			start: "Munich",
			turnaround: {
				label: "Schliersee",
				point: [11.8598, 47.7362],
			},
		});
	});

	it("rejects stop schema decodes with out-of-bounds point values", () => {
		expect(() =>
			Schema.decodeUnknownSync(RouteStopInputSchema)({
				label: "Impossible stop",
				point: [181, 48.1374],
			}),
		).toThrow();
	});

	it("preserves permissive waypoint behavior for endpoint normalization", () => {
		expect(expectDecodedPayload({ waypoints: "not an array" }).waypoints).toBe(
			"not an array",
		);
		expect(
			expectDecodedPayload({ waypoints: ["", "Berlin"] }).waypoints,
		).toEqual(["", "Berlin"]);
	});

	it("decodes supported spatial constraint shapes", () => {
		const decode = Schema.decodeUnknownSync(RouteSpatialConstraintInputSchema);

		expect(
			decode({
				kind: "area",
				center: {
					label: "Oberland",
					point: [11.72, 47.93, 700],
				},
				radiusMeters: 90000,
				enforcement: "unexpected",
			}),
		).toEqual({
			kind: "area",
			center: {
				label: "Oberland",
				point: [11.72, 47.93],
			},
			radiusMeters: 90000,
			enforcement: "unexpected",
		});

		expect(
			decode({
				kind: "corridor",
				widthMeters: 12000,
			}),
		).toEqual({
			kind: "corridor",
			widthMeters: 12000,
		});
	});

	it("accepts structured payloads with road avoidances", () => {
		expectDecodedPayload({
			mode: "point_to_point",
			start: "Munich",
			destination: "Berlin",
			avoidances: [
				{
					kind: "road_segment",
					centerline: [
						[11.5755, 48.1374, 520],
						[11.58, 48.14],
					],
					bufferMeters: 35,
					label: "Avoid Arnulfstrasse",
				},
			],
		});

		expect(
			Schema.decodeUnknownSync(RouteAvoidanceInputSchema)({
				kind: "road_segment",
				centerline: [
					[11.5755, 48.1374, 520],
					[11.58, 48.14],
				],
				bufferMeters: 35,
			}),
		).toEqual({
			kind: "road_segment",
			centerline: [
				[11.5755, 48.1374],
				[11.58, 48.14],
			],
			bufferMeters: 35,
		});
	});

	it("accepts valid planned route shapes", () => {
		expect(() =>
			Schema.decodeUnknownSync(PlannedRouteSchema)(buildValidRoute()),
		).not.toThrow();
	});

	it("accepts valid planned route instructions", () => {
		const route = Schema.decodeUnknownSync(PlannedRouteSchema)({
			...buildValidRoute(),
			instructions: [
				{
					distanceFromStartMeters: 0,
					text: "Turn right onto Main Street",
					sign: 2,
					type: "right",
					segmentDistanceMeters: 250,
					segmentTimeMs: 60000,
					coordinateIndex: 0,
					coordinate: [11.5755, 48.1374],
					interval: [0, 1],
				},
			],
		});

		expect(route.instructions).toHaveLength(1);
		expect(route.instructions?.[0]).toMatchObject({
			text: "Turn right onto Main Street",
			type: "right",
			coordinateIndex: 0,
		});
	});

	it("rejects malformed planned route instruction intervals", () => {
		expect(() =>
			Schema.decodeUnknownSync(PlannedRouteSchema)({
				...buildValidRoute(),
				instructions: [
					{
						distanceFromStartMeters: 0,
						text: "Turn right",
						sign: 2,
						type: "right",
						segmentDistanceMeters: 250,
						segmentTimeMs: 60000,
						coordinateIndex: 0,
						coordinate: [11.5755, 48.1374],
						interval: [0, 1, 2],
					},
				],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PlannedRouteSchema)({
				...buildValidRoute(),
				instructions: [
					{
						distanceFromStartMeters: 0,
						text: "Turn right",
						sign: 2,
						type: "right",
						segmentDistanceMeters: 250,
						segmentTimeMs: 60000,
						coordinateIndex: 0,
						coordinate: [11.5755, 48.1374],
						interval: [0, "1"],
					},
				],
			}),
		).toThrow();
	});

	it("normalizes legacy planned routes without instructions to an empty array", () => {
		const legacyRoute = buildValidRoute();
		delete (legacyRoute as { instructions?: unknown }).instructions;

		expect(normalizePlannedRoute(legacyRoute)?.instructions).toEqual([]);
	});

	it("accepts route quality payloads", () => {
		const route = buildValidRoute();
		const decoded = Schema.decodeUnknownSync(PlannedRouteSchema)({
			...route,
			routeQuality: Effect.runSync(calculateRouteQuality(route)),
		});

		expect(decoded.routeQuality?.version).toBe(1);
		expect(decoded.routeQuality?.overallScore).not.toBeNull();
	});

	it("normalizes legacy planned routes without new detail arrays", () => {
		const legacyRoute = buildValidRoute();
		delete (legacyRoute as { roadClassDetails?: unknown }).roadClassDetails;
		delete (legacyRoute as { roadEnvironmentDetails?: unknown })
			.roadEnvironmentDetails;
		delete (legacyRoute as { roadAccessDetails?: unknown }).roadAccessDetails;
		delete (legacyRoute as { bikeNetworkDetails?: unknown }).bikeNetworkDetails;

		expect(normalizePlannedRoute(legacyRoute)).toEqual(legacyRoute);
	});

	it("accepts planned routes with resolved avoidances", () => {
		expect(() =>
			Schema.decodeUnknownSync(PlannedRouteSchema)({
				...buildValidRoute(),
				avoidances: [
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
							[11.57, 48.13],
						],
					},
				],
			}),
		).not.toThrow();
	});

	it("rejects malformed saved route avoidance polygons during normalization", () => {
		expect(
			normalizePlannedRoute({
				...buildValidRoute(),
				avoidances: [
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
				],
			}),
		).toBeNull();
	});

	it("accepts planned routes with optional wind analysis", () => {
		expect(() =>
			Schema.decodeUnknownSync(PlannedRouteSchema)({
				...buildValidRoute(),
				windAnalysis: {
					source: "open_meteo",
					fetchedAt: "2026-05-10T10:00:00.000Z",
					forecastTime: "2026-05-10T10:00",
					samples: [
						{
							coordinate: [11.5755, 48.1374],
							speedKmh: 18,
							directionDegrees: 270,
							time: "2026-05-10T10:00",
							source: "open_meteo",
						},
					],
					segments: [
						{
							from: 0,
							to: 1,
							speedKmh: 18,
							directionDegrees: 270,
							routeBearingDegrees: 180,
							relativeAngleDegrees: 90,
							headwindComponentKmh: 0,
							crosswindComponentKmh: 18,
							bucket: "crosswind",
						},
					],
					averageHeadwindKmh: 0,
					maxHeadwindKmh: 0,
					averageTailwindKmh: 0,
					maxCrosswindKmh: 18,
					headwindDistanceMeters: 0,
					tailwindDistanceMeters: 0,
					crosswindDistanceMeters: 61234,
				},
			}),
		).not.toThrow();
	});

	it("accepts planned routes with structured warnings", () => {
		const route = Schema.decodeUnknownSync(PlannedRouteSchema)({
			...buildValidRoute(),
			warnings: [
				{
					category: "readiness",
					code: "coarse_surface_exposure",
					severity: "caution",
					title: "Coarse surface exposure",
					message: "This route includes notable rough or unpaved surface.",
					metricLabel: "Coarse",
					metricValue: "1.2 km (4%)",
				},
				{
					category: "routing_provider",
					code: "routing_profile_fallback",
					severity: "info",
					title: "Routing fallback",
					message: "Advanced paved-road tuning was unavailable.",
				},
			],
		});

		expect(route.warnings).toHaveLength(2);
	});

	it("still accepts legacy routingWarnings", () => {
		const route = Schema.decodeUnknownSync(PlannedRouteSchema)({
			...buildValidRoute(),
			routingWarnings: ["Legacy fallback."],
		});

		expect(route.routingWarnings).toEqual(["Legacy fallback."]);
	});

	it("rejects invalid wind buckets", () => {
		expect(() =>
			Schema.decodeUnknownSync(PlannedRouteSchema)({
				...buildValidRoute(),
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
							directionDegrees: 270,
							routeBearingDegrees: 180,
							relativeAngleDegrees: 90,
							headwindComponentKmh: 0,
							crosswindComponentKmh: 18,
							bucket: "sideways",
						},
					],
					averageHeadwindKmh: 0,
					maxHeadwindKmh: 0,
					averageTailwindKmh: 0,
					maxCrosswindKmh: 18,
					headwindDistanceMeters: 0,
					tailwindDistanceMeters: 0,
					crosswindDistanceMeters: 61234,
				},
			}),
		).toThrow();
	});

	it("rejects malformed planned route coordinate tuple lengths", () => {
		expect(() =>
			Schema.decodeUnknownSync(PlannedRouteSchema)({
				...buildValidRoute(),
				coordinates: [[11.5755, 48.1374, 520, 1]],
			}),
		).toThrow();
	});

	it("accepts valid saved route shapes", () => {
		expect(() =>
			Schema.decodeUnknownSync(SavedRouteSchema)({
				id: "saved-route",
				createdAt: "2026-04-19T09:30:00.000Z",
				route: buildValidRoute(),
			}),
		).not.toThrow();
	});

	it("validates remote saved route payload shapes", () => {
		const decode = Schema.decodeUnknownSync(RemoteSavedRoutePayloadSchema);

		expect(() =>
			decode({
				id: "saved-route",
				createdAt: "2026-04-19T09:30:00.000Z",
				routeJson: JSON.stringify(buildValidRoute()),
			}),
		).not.toThrow();
		expect(() =>
			decode({
				id: "saved-route",
				createdAt: "2026-04-19T09:30:00.000Z",
			}),
		).toThrow();
		expect(() =>
			decode({
				id: "saved-route",
				createdAt: "2026-04-19T09:30:00.000Z",
				routeJson: buildValidRoute(),
			}),
		).toThrow();
	});

	it("catches malformed success payloads", () => {
		expect(() =>
			assertRouteApiSuccessPayload({ selectedRouteIndex: 0 }),
		).toThrow();
		expect(() =>
			assertRouteApiSuccessPayload({
				routes: [],
				selectedRouteIndex: "0",
			}),
		).toThrow();
		expect(() =>
			assertRouteApiSuccessPayload({
				routes: [
					{
						...buildValidRoute(),
						coordinates: [[11.5755, 48.1374, 520, 1]],
					},
				],
				selectedRouteIndex: 0,
			}),
		).toThrow();
	});

	it("accepts route API payloads with round-course candidate diagnostics", () => {
		const roundCourseCandidateErrors = [
			{
				roundIndex: 0,
				candidateIndex: 1,
				sequence: 1,
				requestedDistanceMeters: 77000,
				seed: 37,
				errorTag: "GraphHopperRouteStatusError",
				message: "Routing failed with status 500",
				status: 500,
			},
		];

		expect(() =>
			assertRouteApiSuccessPayload({
				routes: [buildValidRoute()],
				selectedRouteIndex: 0,
				roundCourseCandidateErrors,
			}),
		).not.toThrow();

		expect(() =>
			assertRouteApiErrorPayload({
				error: "GraphHopper could not generate a round course right now.",
				roundCourseCandidateErrors,
			}),
		).not.toThrow();
	});

	it("rejects malformed round-course candidate diagnostics", () => {
		const validPayload = {
			error: "GraphHopper could not generate a round course right now.",
			roundCourseCandidateErrors: [
				{
					roundIndex: 0,
					candidateIndex: 1,
					sequence: 1,
					requestedDistanceMeters: 77000,
					errorTag: "GraphHopperRouteStatusError",
					message: "Routing failed with status 500",
					status: 500,
				},
			],
		};

		expect(() =>
			assertRouteApiErrorPayload({
				...validPayload,
				roundCourseCandidateErrors: [
					{
						...validPayload.roundCourseCandidateErrors[0],
						status: "500",
					},
				],
			}),
		).toThrow();
		expect(() =>
			assertRouteApiErrorPayload({
				...validPayload,
				roundCourseCandidateErrors: [
					{
						...validPayload.roundCourseCandidateErrors[0],
						errorTag: undefined,
					},
				],
			}),
		).toThrow();
		expect(() =>
			assertRouteApiErrorPayload({
				...validPayload,
				roundCourseCandidateErrors: [
					{
						...validPayload.roundCourseCandidateErrors[0],
						requestedDistanceMeters: "77000",
					},
				],
			}),
		).toThrow();
	});
});
