import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	assertRouteApiSuccessPayload,
	decodeRouteRequestPayload,
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
});
