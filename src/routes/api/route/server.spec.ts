import { describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({
	env: {
		GRAPHHOPPER_API_KEY: "graphhopper-test-key",
	},
}));

import { POST } from "./+server";
import type { RouteApiSuccess } from "$lib/route-planning";

function buildEvent(body: unknown, fetchMock: typeof fetch) {
	return {
		request: new Request("http://localhost/api/route", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		}),
		fetch: fetchMock,
	} as Parameters<typeof POST>[0];
}

function buildRouteResponse(points: number[][]) {
	return new Response(
		JSON.stringify({
			paths: [
				{
					distance: 61234,
					time: 9876000,
					ascend: 820,
					descend: 740,
					bbox: [11.5755, 47.7362, 11.8598, 48.1374],
					points: {
						coordinates: [
							[11.5755, 48.1374, 520],
							[11.7, 48.02, 575],
							[11.8598, 47.7362, 785],
						],
					},
					snapped_waypoints: {
						coordinates: points,
					},
					details: {
						surface: [
							[0, 2, "ASPHALT"],
							[2, 3, "COMPACTED"],
						],
						smoothness: [[0, 3, "GOOD"]],
					},
				},
			],
		}),
	);
}

function buildRoundCourseResponse(point: number[]) {
	return new Response(
		JSON.stringify({
			paths: [
				{
					distance: 50123,
					time: 7420000,
					ascend: 540,
					descend: 540,
					bbox: [11.55, 48.08, 11.69, 48.17],
					points: {
						coordinates: [
							[11.5755, 48.1374, 520],
							[11.66, 48.12, 610],
							[11.5755, 48.1374, 520],
						],
					},
					snapped_waypoints: {
						coordinates: [point],
					},
					details: {
						surface: [
							[0, 2, "ASPHALT"],
							[2, 3, "COMPACTED"],
						],
						smoothness: [[0, 3, "GOOD"]],
					},
				},
			],
		}),
	);
}

function buildRoundCourseResponseWithoutSnappedWaypoints() {
	return new Response(
		JSON.stringify({
			paths: [
				{
					distance: 50123,
					time: 7420000,
					ascend: 540,
					descend: 540,
					bbox: [11.55, 48.08, 11.69, 48.17],
					points: {
						coordinates: [
							[11.5755, 48.1374, 520],
							[11.66, 48.12, 610],
							[11.5755, 48.1374, 520],
						],
					},
					details: {
						surface: [
							[0, 2, "ASPHALT"],
							[2, 3, "COMPACTED"],
						],
						smoothness: [[0, 3, "GOOD"]],
					},
				},
			],
		}),
	);
}

describe("POST /api/route", () => {
	it("uses exact stop coordinates without forward-geocoding them again", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			buildRouteResponse([
				[11.5756, 48.1375, 522],
				[11.7582, 47.7124, 734],
				[11.8597, 47.7361, 784],
			]),
		);

		const response = await POST(
			buildEvent(
				{
					mode: "point_to_point",
					start: {
						label: "Marienplatz, Munich, Germany",
						point: [11.5755, 48.1374],
					},
					waypoints: [
						{
							label: "Tegernsee, Germany",
							point: [11.7581, 47.7123],
						},
					],
					destination: {
						label: "Schliersee, Germany",
						point: [11.8598, 47.7362],
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const routeRequest = fetchMock.mock.calls[0];
		const requestBody = JSON.parse(String(routeRequest?.[1]?.body));
		expect(requestBody.points).toEqual([
			[11.5755, 48.1374],
			[11.7581, 47.7123],
			[11.8598, 47.7362],
		]);
		expect(requestBody.algorithm).toBeUndefined();
	});

	it("geocodes all ordered stops, requests a road-bike biased route, and returns snapped waypoint labels", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Marienplatz",
								city: "Munich",
								country: "Germany",
								point: {
									lat: 48.1374,
									lng: 11.5755,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Tegernsee",
								country: "Germany",
								point: {
									lat: 47.7123,
									lng: 11.7581,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Schliersee",
								country: "Germany",
								point: {
									lat: 47.7362,
									lng: 11.8598,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				buildRouteResponse([
					[11.5756, 48.1375, 522],
					[11.7582, 47.7124, 734],
					[11.8597, 47.7361, 784],
				]),
			);

		const response = await POST(
			buildEvent(
				{
					startQuery: "Marienplatz Munich",
					waypointQueries: ["Tegernsee"],
					destinationQuery: "Schliersee",
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
			"provider=nominatim",
		);
		expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
			"provider=nominatim",
		);
		expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
			"provider=nominatim",
		);

		const routeRequest = fetchMock.mock.calls[3];
		expect(routeRequest?.[0]).toBe(
			"https://graphhopper.com/api/1/route?key=graphhopper-test-key",
		);

		const requestOptions = routeRequest?.[1];
		const requestBody = JSON.parse(String(requestOptions?.body));
		expect(requestBody.profile).toBe("racingbike");
		expect(requestBody.points).toEqual([
			[11.5755, 48.1374],
			[11.7581, 47.7123],
			[11.8598, 47.7362],
		]);
		expect(requestBody.points_encoded).toBe(false);
		expect(requestBody.elevation).toBe(true);
		expect(requestBody["ch.disable"]).toBe(true);
		expect(requestBody.custom_model).toBeDefined();
		expect(requestBody.details).toEqual([
			"surface",
			"smoothness",
			"road_class",
			"road_environment",
			"road_access",
			"bike_network",
		]);

		const payload = (await response.json()) as {
			route: {
				mode: string;
				startLabel: string;
				destinationLabel: string;
				waypoints: Array<{
					label: string;
					coordinate: [number, number, number];
				}>;
				distanceMeters: number;
				routingProfile?: string;
				routingStrategy?: string;
				routingWarnings?: string[];
				surfaceDetails: Array<{ from: number; to: number; value: string }>;
			};
		};

		expect(payload.route.startLabel).toBe("Marienplatz, Munich, Germany");
		expect(payload.route.mode).toBe("point_to_point");
		expect(payload.route.destinationLabel).toBe("Schliersee, Germany");
		expect(payload.route.waypoints).toEqual([
			{
				label: "Tegernsee, Germany",
				coordinate: [11.7582, 47.7124, 734],
			},
		]);
		expect(payload.route.distanceMeters).toBe(61234);
		expect(payload.route.source).toEqual({
			kind: "graphhopper",
		});
		expect(payload.route.routingProfile).toBe("racingbike");
		expect(payload.route.routingStrategy).toContain("racingbike");
		expect(payload.route.routingWarnings).toEqual([]);
		expect(payload.route.surfaceDetails).toEqual([
			{ from: 0, to: 2, value: "ASPHALT" },
			{ from: 2, to: 3, value: "COMPACTED" },
		]);
	});

	it("validates missing required input and blank waypoints before calling GraphHopper", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					startQuery: "",
					waypointQueries: ["", "Tegernsee"],
					destinationQuery: "Berlin",
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Start and destination are required.",
			fieldErrors: {
				startQuery: "Enter a start point.",
				waypointQueries: ["Enter a waypoint or remove this stop.", ""],
			},
		});
	});

	it("requests a GraphHopper round trip from one resolved start point", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Marienplatz",
								city: "Munich",
								country: "Germany",
								point: {
									lat: 48.1374,
									lng: 11.5755,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(buildRoundCourseResponse([11.5756, 48.1375, 522]));

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Marienplatz Munich",
					},
					requestedDistanceMeters: 50000,
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const routeRequest = fetchMock.mock.calls[1];
		const requestBody = JSON.parse(String(routeRequest?.[1]?.body));
		expect(requestBody.profile).toBe("racingbike");
		expect(requestBody.custom_model).toBeDefined();
		expect(requestBody.points).toEqual([[11.5755, 48.1374]]);
		expect(requestBody.algorithm).toBe("round_trip");
		expect(requestBody["round_trip.distance"]).toBe(50000);

		const payload = (await response.json()) as RouteApiSuccess;

		expect(payload.route.mode).toBe("round_course");
		expect(payload.route.startLabel).toBe("Marienplatz, Munich, Germany");
		expect(payload.route.destinationLabel).toBe("Marienplatz, Munich, Germany");
		expect(payload.route.requestedDistanceMeters).toBe(50000);
		expect(payload.route.waypoints).toEqual([]);
		expect(payload.route.source).toEqual({
			kind: "graphhopper",
		});
		expect(payload.route.routingProfile).toBe("racingbike");
	});

	it("validates the required target distance for round-course requests", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Munich",
					},
					requestedDistanceMeters: 0,
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Start and target distance are required.",
			fieldErrors: {
				requestedDistanceKm: "Enter a target distance.",
			},
		});
	});

	it("accepts round-course responses even when GraphHopper omits snapped waypoints", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Marienplatz",
								city: "Munich",
								country: "Germany",
								point: {
									lat: 48.1374,
									lng: 11.5755,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(buildRoundCourseResponseWithoutSnappedWaypoints());

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Marienplatz Munich",
					},
					requestedDistanceMeters: 50000,
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			route: {
				mode: string;
				startLabel: string;
				destinationLabel: string;
			};
		};
		expect(payload.route.mode).toBe("round_course");
		expect(payload.route.startLabel).toBe("Marienplatz, Munich, Germany");
		expect(payload.route.destinationLabel).toBe("Marienplatz, Munich, Germany");
	});

	it("rejects routes with more than three waypoints", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					startQuery: "Munich",
					waypointQueries: ["A", "B", "C", "D"],
					destinationQuery: "Berlin",
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "You can add up to 3 waypoints per route.",
			fieldErrors: {
				waypointQueries: ["", "", "", ""],
			},
		});
	});

	it("returns field errors when a waypoint location cannot be resolved", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Berlin",
								country: "Germany",
								point: {
									lat: 52.52,
									lng: 13.405,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ hits: [] })))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Leipzig",
								country: "Germany",
								point: {
									lat: 51.3397,
									lng: 12.3731,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ hits: [] })));

		const response = await POST(
			buildEvent(
				{
					startQuery: "Berlin",
					waypointQueries: ["Unknown village"],
					destinationQuery: "Leipzig",
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(422);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		await expect(response.json()).resolves.toEqual({
			error: "We couldn't resolve one or more locations.",
			fieldErrors: {
				waypointQueries: ["We couldn't resolve that waypoint."],
			},
		});
	});

	it("falls back to the default geocoder when Nominatim returns 400", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "bad request" }), {
					status: 400,
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Berlin",
								country: "Germany",
								point: {
									lat: 52.52,
									lng: 13.405,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Leipzig",
								country: "Germany",
								point: {
									lat: 51.3397,
									lng: 12.3731,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				buildRouteResponse([
					[13.405, 52.52, 40],
					[12.3731, 51.3397, 50],
				]),
			);

		const response = await POST(
			buildEvent(
				{
					startQuery: "Berlin",
					destinationQuery: "Leipzig",
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const geocodeCalls = fetchMock.mock.calls
			.slice(0, 3)
			.map((call) => String(call[0]));
		expect(
			geocodeCalls.filter((call) => call.includes("provider=nominatim")),
		).toHaveLength(2);
		expect(geocodeCalls.some((call) => call.includes("locale=en"))).toBe(true);
	});

	it("surfaces upstream routing failures as a gateway error", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Berlin",
								country: "Germany",
								point: {
									lat: 52.52,
									lng: 13.405,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Leipzig",
								country: "Germany",
								point: {
									lat: 51.3397,
									lng: 12.3731,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "rate limited" }), {
					status: 429,
				}),
			);

		const response = await POST(
			buildEvent(
				{
					startQuery: "Berlin",
					destinationQuery: "Leipzig",
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toEqual({
			error: "GraphHopper could not generate a route right now.",
		});
	});

	it("converts GraphHopper point-limit errors into a user-facing validation response", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Munich",
								country: "Germany",
								point: {
									lat: 48.1374,
									lng: 11.5755,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Waypoint A",
								country: "Germany",
								point: {
									lat: 48.0,
									lng: 11.7,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Waypoint B",
								country: "Germany",
								point: {
									lat: 47.9,
									lng: 11.8,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Waypoint C",
								country: "Germany",
								point: {
									lat: 47.8,
									lng: 11.9,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Schliersee",
								country: "Germany",
								point: {
									lat: 47.7362,
									lng: 11.8598,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						message: "Too many points for Routing API: 5, allowed: 4",
					}),
					{ status: 400 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						message: "Too many points for Routing API: 5, allowed: 4",
					}),
					{ status: 400 },
				),
			);

		const response = await POST(
			buildEvent(
				{
					startQuery: "Munich",
					waypointQueries: ["Waypoint A", "Waypoint B", "Waypoint C"],
					destinationQuery: "Schliersee",
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error:
				"Your current routing plan allows up to 5 total route points (3 waypoints plus start and destination).",
		});
	});

	it("falls back through the road-bike routing ladder when GraphHopper rejects earlier strategies", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Berlin",
								country: "Germany",
								point: {
									lat: 52.52,
									lng: 13.405,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Leipzig",
								country: "Germany",
								point: {
									lat: 51.3397,
									lng: 12.3731,
								},
							},
						],
					}),
				),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "custom_model unsupported" }), {
					status: 400,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "profile unsupported" }), {
					status: 400,
				}),
			)
			.mockResolvedValueOnce(
				buildRouteResponse([
					[13.405, 52.52, 40],
					[12.3731, 51.3397, 50],
				]),
			);

		const response = await POST(
			buildEvent(
				{
					startQuery: "Berlin",
					destinationQuery: "Leipzig",
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(5);

		const racingbikeTunedRouteRequest = JSON.parse(
			String(fetchMock.mock.calls[2]?.[1]?.body),
		) as Record<string, unknown>;
		const racingbikeBaseRouteRequest = JSON.parse(
			String(fetchMock.mock.calls[3]?.[1]?.body),
		) as Record<string, unknown>;
		const bikeTunedRouteRequest = JSON.parse(
			String(fetchMock.mock.calls[4]?.[1]?.body),
		) as Record<string, unknown>;

		expect(racingbikeTunedRouteRequest.profile).toBe("racingbike");
		expect(racingbikeTunedRouteRequest.custom_model).toBeDefined();
		expect(racingbikeTunedRouteRequest["ch.disable"]).toBe(true);
		expect(racingbikeBaseRouteRequest.profile).toBe("racingbike");
		expect(racingbikeBaseRouteRequest.custom_model).toBeUndefined();
		expect(racingbikeBaseRouteRequest["ch.disable"]).toBeUndefined();
		expect(racingbikeBaseRouteRequest.snap_preventions).toBeUndefined();
		expect(bikeTunedRouteRequest.profile).toBe("bike");
		expect(bikeTunedRouteRequest.custom_model).toBeDefined();
		expect(bikeTunedRouteRequest["ch.disable"]).toBe(true);

		await expect(response.json()).resolves.toMatchObject({
			route: {
				routingProfile: "bike",
				routingStrategy: expect.stringContaining("bike"),
				routingWarnings: [expect.stringContaining("racingbike profile")],
			},
		});
	});
});
