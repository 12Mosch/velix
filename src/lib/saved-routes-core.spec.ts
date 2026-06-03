import { describe, expect, it } from "vitest";

import {
	deserializeRemoteSavedRoute,
	deserializeRemoteSavedRouteVersion,
	normalizeSavedRouteVersions,
	normalizePlannedRoute,
	parseSavedRoutes,
	serializeSavedRouteVersionForRemote,
	serializeSavedRouteForRemote,
	type SavedRoute,
	type SavedRouteVersion,
} from "$lib/saved-routes-core";
import {
	calculateRouteQuality,
	calculateRouteTrainingSuitability,
} from "$lib/route-planning";

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
	instructions: [],
	surfaceDetails: [{ from: 0, to: 2, value: "asphalt" }],
	smoothnessDetails: [{ from: 0, to: 2, value: "GOOD" }],
	roadClassDetails: [{ from: 0, to: 2, value: "tertiary" }],
	roadEnvironmentDetails: [{ from: 0, to: 2, value: "road" }],
	roadAccessDetails: [{ from: 0, to: 2, value: "yes" }],
	bikeNetworkDetails: [],
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

	it("rejects malformed route tuple lengths after Convex shape validation", () => {
		expect(
			normalizePlannedRoute({
				...baseRoute,
				coordinates: [
					[11.5755, 48.1374, 520, 1],
					[11.62, 48.1, 545],
				],
			}),
		).toBeNull();
		expect(
			normalizePlannedRoute({
				...baseRoute,
				waypoints: [{ label: "Tegernsee, Germany", coordinate: [11.7571] }],
			}),
		).toBeNull();
		expect(
			normalizePlannedRoute({
				...baseRoute,
				spatialConstraint: {
					kind: "area",
					label: "Munich",
					center: [11.5755, 48.1374, 520],
					radiusMeters: 5000,
					enforcement: "preferred",
					polygon: [
						[11.5, 48.1],
						[11.6, 48.1],
						[11.6, 48.2],
						[11.5, 48.1],
					],
				},
			}),
		).toBeNull();
		expect(
			normalizePlannedRoute({
				...baseRoute,
				bounds: [11.5755, 47.7362, 11.8598],
			}),
		).toBeNull();
	});

	it("rejects routes with fewer than two coordinates", () => {
		expect(
			normalizePlannedRoute({
				...baseRoute,
				coordinates: [[11.5755, 48.1374, 520]],
			}),
		).toBeNull();
	});

	it("loads legacy routes without waypoints", () => {
		const legacyRoute = { ...baseRoute };
		delete (legacyRoute as { waypoints?: unknown }).waypoints;
		delete (legacyRoute as { instructions?: unknown }).instructions;
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
					instructions: [],
				},
			},
		]);
	});

	it("normalizes legacy routes without mode, source, or waypoints", () => {
		const legacyRoute = { ...baseRoute };
		delete (legacyRoute as { mode?: unknown }).mode;
		delete (legacyRoute as { source?: unknown }).source;
		delete (legacyRoute as { waypoints?: unknown }).waypoints;
		delete (legacyRoute as { instructions?: unknown }).instructions;

		expect(normalizePlannedRoute(legacyRoute)).toEqual({
			...legacyRoute,
			mode: "point_to_point",
			source: { kind: "graphhopper" },
			waypoints: [],
			instructions: [],
		});
	});

	it("restores older routes without route quality or new detail arrays", () => {
		const legacyRoute = { ...baseRoute };
		delete (legacyRoute as { routeQuality?: unknown }).routeQuality;
		delete (legacyRoute as { roadClassDetails?: unknown }).roadClassDetails;
		delete (legacyRoute as { roadEnvironmentDetails?: unknown })
			.roadEnvironmentDetails;
		delete (legacyRoute as { roadAccessDetails?: unknown }).roadAccessDetails;
		delete (legacyRoute as { bikeNetworkDetails?: unknown }).bikeNetworkDetails;

		expect(normalizePlannedRoute(legacyRoute)).toEqual(legacyRoute);
	});

	it("saves and restores route quality", () => {
		const route = {
			...baseRoute,
			routeQuality: calculateRouteQuality(baseRoute),
		};
		const savedRoute: SavedRoute = {
			id: "quality-route",
			createdAt: "2026-04-19T09:30:00.000Z",
			route,
		};

		expect(parseSavedRoutes(JSON.stringify([savedRoute]))[0]?.route).toEqual(
			route,
		);
	});

	it("normalizes a saved route with training suitability", () => {
		const route = {
			...baseRoute,
			mode: "round_course" as const,
			destinationLabel: baseRoute.startLabel,
			waypoints: [],
			roundCourseTarget: {
				kind: "workout" as const,
				durationMs: baseRoute.durationMs,
				distanceMeters: baseRoute.distanceMeters,
				estimatedSpeedMetersPerHour: 22314,
				weightedIntensity: 0.7,
			},
		};
		const suitability = calculateRouteTrainingSuitability(route);
		expect(suitability).not.toBeNull();
		if (!suitability) {
			throw new Error("Expected workout route to have training suitability.");
		}
		const routeWithTraining = {
			...route,
			trainingSuitability: suitability,
		};
		const savedRoute: SavedRoute = {
			id: "training-route",
			createdAt: "2026-04-19T09:30:00.000Z",
			route: routeWithTraining,
		};

		expect(parseSavedRoutes(JSON.stringify([savedRoute]))[0]?.route).toEqual(
			routeWithTraining,
		);
	});

	it("preserves valid instructions and defaults missing instructions", () => {
		const instructions = [
			{
				distanceFromStartMeters: 1200,
				text: "Turn right onto Main Street",
				sign: 2,
				type: "right" as const,
				segmentDistanceMeters: 320,
				segmentTimeMs: 82000,
				coordinateIndex: 1,
				coordinate: [11.62, 48.1, 545] as [number, number, number],
				interval: [1, 2] as [number, number],
			},
		];
		const legacyRoute = { ...baseRoute };
		delete (legacyRoute as { instructions?: unknown }).instructions;

		expect(
			normalizePlannedRoute({
				...baseRoute,
				instructions,
			})?.instructions,
		).toEqual(instructions);
		expect(normalizePlannedRoute(legacyRoute)?.instructions).toEqual([]);
	});

	it("rejects invalid route source shapes through schema normalization", () => {
		expect(
			normalizePlannedRoute({
				...baseRoute,
				source: { kind: "gpx_import", filename: "route.gpx" },
			}),
		).toBeNull();
	});

	it("rejects invalid round-course targets through schema normalization", () => {
		expect(
			normalizePlannedRoute({
				...baseRoute,
				roundCourseTarget: { kind: "duration", durationMs: "3600000" },
			}),
		).toBeNull();
	});

	it("synthesizes round-course target from legacy requested distance", () => {
		expect(
			normalizePlannedRoute({
				...baseRoute,
				requestedDistanceMeters: 50_000,
			})?.roundCourseTarget,
		).toEqual({
			kind: "distance",
			distanceMeters: 50_000,
		});
	});

	it("rejects structurally valid spatial constraint polygons that are not closed", () => {
		expect(
			normalizePlannedRoute({
				...baseRoute,
				spatialConstraint: {
					kind: "area",
					label: "Munich",
					center: [11.5755, 48.1374],
					radiusMeters: 5000,
					enforcement: "preferred",
					polygon: [
						[11.5, 48.1],
						[11.6, 48.1],
						[11.6, 48.2],
						[11.4, 48.2],
					],
				},
			}),
		).toBeNull();
	});

	it("preserves valid avoided roads and rejects malformed avoidance polygons", () => {
		const routeWithAvoidance = {
			...baseRoute,
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
		} satisfies SavedRoute["route"];

		expect(normalizePlannedRoute(routeWithAvoidance)?.avoidances).toEqual(
			routeWithAvoidance.avoidances,
		);
		expect(
			normalizePlannedRoute({
				...routeWithAvoidance,
				avoidances: [
					{
						...routeWithAvoidance.avoidances[0],
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

	it("sanitizes manual editing locks and omits them when all are out of range", () => {
		expect(
			normalizePlannedRoute({
				...baseRoute,
				manualEditing: { lockedSegmentIndexes: [0, 99] },
			})?.manualEditing,
		).toEqual({ lockedSegmentIndexes: [0] });
		expect(
			normalizePlannedRoute({
				...baseRoute,
				manualEditing: { lockedSegmentIndexes: [99] },
			}),
		).not.toHaveProperty("manualEditing");
	});

	it("preserves manual editing locks when loading saved routes", () => {
		const savedRoute: SavedRoute = {
			id: "manual-edit-route",
			createdAt: "2026-04-19T09:30:00.000Z",
			route: {
				...baseRoute,
				manualEditing: { lockedSegmentIndexes: [0] },
			},
		};

		expect(parseSavedRoutes(JSON.stringify([savedRoute]))[0]?.route).toEqual({
			...savedRoute.route,
			manualEditing: { lockedSegmentIndexes: [0] },
		});
	});

	it("rejects invalid manual editing indexes", () => {
		expect(
			normalizePlannedRoute({
				...baseRoute,
				manualEditing: { lockedSegmentIndexes: [0, 1.5] },
			}),
		).toBeNull();
	});

	it("serializes long remote routes without exposing coordinates as Convex arrays", () => {
		const coordinates: SavedRoute["route"]["coordinates"] = Array.from(
			{ length: 19_487 },
			(_, index) => [
				11.5755 + index / 100_000,
				48.1374 - index / 100_000,
				520 + (index % 100),
			],
		);
		const savedRoute: SavedRoute = {
			id: "long-route",
			createdAt: "2026-04-19T09:30:00.000Z",
			route: {
				...baseRoute,
				coordinates,
			},
		};

		const remotePayload = serializeSavedRouteForRemote(savedRoute);

		expect(remotePayload).toEqual({
			id: savedRoute.id,
			createdAt: savedRoute.createdAt,
			routeJson: expect.any(String),
		});
		expect("route" in remotePayload).toBe(false);
		expect(JSON.parse(remotePayload.routeJson).coordinates).toHaveLength(
			19_487,
		);
		expect(deserializeRemoteSavedRoute(remotePayload)).toEqual(savedRoute);
	});

	it("rejects invalid remote route JSON", () => {
		expect(
			deserializeRemoteSavedRoute({
				id: "broken",
				createdAt: "2026-04-19T09:30:00.000Z",
				routeJson: "{not-json",
			}),
		).toBeNull();
		expect(
			deserializeRemoteSavedRoute({
				id: "broken",
				createdAt: "2026-04-19T09:30:00.000Z",
				routeJson: JSON.stringify({ ...baseRoute, coordinates: [] }),
			}),
		).toBeNull();
	});

	it("preserves remote route ids exactly", () => {
		expect(
			deserializeRemoteSavedRoute({
				id: " route-with-spaces ",
				createdAt: "2026-04-19T09:30:00.000Z",
				routeJson: JSON.stringify(baseRoute),
			})?.id,
		).toBe(" route-with-spaces ");
	});

	it("normalizes and serializes saved route versions", () => {
		const savedRoute: SavedRoute = {
			id: "route-1",
			createdAt: "2026-04-19T09:30:00.000Z",
			route: baseRoute,
		};
		const version: SavedRouteVersion = {
			versionId: "version-1",
			routeId: savedRoute.id,
			capturedAt: "2026-04-20T09:30:00.000Z",
			savedRoute,
		};
		const remoteVersion = serializeSavedRouteVersionForRemote(version);

		expect(remoteVersion).toEqual({
			versionId: "version-1",
			routeId: "route-1",
			capturedAt: "2026-04-20T09:30:00.000Z",
			savedRoute: serializeSavedRouteForRemote(savedRoute),
		});
		expect(deserializeRemoteSavedRouteVersion(remoteVersion)).toEqual(version);
		expect(normalizeSavedRouteVersions([version, remoteVersion])).toEqual([
			version,
			version,
		]);
	});

	it("rejects saved route versions with mismatched route ids or invalid snapshots", () => {
		const savedRoute: SavedRoute = {
			id: "route-1",
			createdAt: "2026-04-19T09:30:00.000Z",
			route: baseRoute,
		};

		expect(
			normalizeSavedRouteVersions([
				{
					versionId: "version-1",
					routeId: "other-route",
					capturedAt: "2026-04-20T09:30:00.000Z",
					savedRoute,
				},
				{
					versionId: "version-2",
					routeId: savedRoute.id,
					capturedAt: "2026-04-20T09:30:00.000Z",
					savedRoute: {
						...savedRoute,
						route: { ...baseRoute, coordinates: [] },
					},
				},
			]),
		).toEqual([]);
	});
});
