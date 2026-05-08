import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	assertRouteApiErrorPayload,
	assertRouteApiSuccessPayload,
	decodeRouteRequestPayload,
	PlannedRouteSchema,
	RemoteSavedRoutePayloadSchema,
	SavedRouteSchema,
	RouteSpatialConstraintInputSchema,
} from "$lib/route-api-schema";

function expectDecodedPayload(value: unknown) {
	const result = decodeRouteRequestPayload(value);

	expect(result.ok).toBe(true);

	if (!result.ok) {
		throw new Error(result.error);
	}

	return result.payload;
}

function buildValidRoute() {
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
		surfaceDetails: [{ from: 0, to: 1, value: "ASPHALT" }],
		smoothnessDetails: [{ from: 0, to: 1, value: "GOOD" }],
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

	it("accepts valid planned route shapes", () => {
		expect(() =>
			Schema.decodeUnknownSync(PlannedRouteSchema)(buildValidRoute()),
		).not.toThrow();
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
