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

function buildRoundCourseResponse(
	point: number[],
	options: {
		distance?: number;
		time?: number;
		ascend?: number;
		descend?: number;
	} = {},
) {
	return new Response(
		JSON.stringify({
			paths: [
				{
					distance: options.distance ?? 50123,
					time: options.time ?? 7420000,
					ascend: options.ascend ?? 540,
					descend: options.descend ?? options.ascend ?? 540,
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
		expect(requestBody.algorithm).toBe("alternative_route");
		expect(requestBody["alternative_route.max_paths"]).toBe(3);
		expect(requestBody["alternative_route.max_weight_factor"]).toBe(1.4);
		expect(requestBody["alternative_route.max_share_factor"]).toBe(0.6);
	});

	it("sends point-to-point area constraints through the GraphHopper custom model", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			buildRouteResponse([
				[11.5756, 48.1375, 522],
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
					waypoints: [],
					destination: {
						label: "Schliersee, Germany",
						point: [11.8598, 47.7362],
					},
					spatialConstraint: {
						kind: "area",
						center: {
							label: "Oberland",
							point: [11.72, 47.93],
						},
						radiusMeters: 90000,
						enforcement: "strict",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.custom_model.areas.features[0]).toMatchObject({
			id: "route_constraint",
			geometry: {
				type: "Polygon",
			},
		});
		expect(
			requestBody.custom_model.areas.features[0].geometry.coordinates[0],
		).toHaveLength(49);
		expect(requestBody.custom_model.priority.slice(0, 2)).toEqual([
			{ if: "in_route_constraint", multiply_by: "1" },
			{ else: "", multiply_by: "0" },
		]);

		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.spatialConstraint).toMatchObject({
			kind: "area",
			label: "Oberland",
			center: [11.72, 47.93],
			radiusMeters: 90000,
			enforcement: "strict",
		});
	});

	it("geocodes area centers before routing when only a label is supplied", async () => {
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
				buildRouteResponse([
					[11.5756, 48.1375, 522],
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
					waypoints: [],
					destination: {
						label: "Schliersee, Germany",
						point: [11.8598, 47.7362],
					},
					spatialConstraint: {
						kind: "area",
						center: {
							label: "Munich",
						},
						radiusMeters: 90000,
						enforcement: "preferred",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain("geocode");
		const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
		expect(requestBody.custom_model.priority.slice(0, 2)).toEqual([
			{ if: "in_route_constraint", multiply_by: "1" },
			{ else: "", multiply_by: "0.08" },
		]);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.spatialConstraint).toMatchObject({
			kind: "area",
			label: "Munich, Germany",
			center: [11.5755, 48.1374],
		});
	});

	it("defaults unknown area constraint enforcement to preferred", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			buildRouteResponse([
				[11.5756, 48.1375, 522],
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
					waypoints: [],
					destination: {
						label: "Schliersee, Germany",
						point: [11.8598, 47.7362],
					},
					spatialConstraint: {
						kind: "area",
						center: {
							label: "Oberland",
							point: [11.72, 47.93],
						},
						radiusMeters: 90000,
						enforcement: "unexpected",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.custom_model.priority.slice(0, 2)).toEqual([
			{ if: "in_route_constraint", multiply_by: "1" },
			{ else: "", multiply_by: "0.08" },
		]);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.spatialConstraint?.enforcement).toBe("preferred");
	});

	it("rejects strict area constraints when route stops are outside the radius", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "point_to_point",
					start: {
						label: "Marienplatz, Munich, Germany",
						point: [11.5755, 48.1374],
					},
					waypoints: [],
					destination: {
						label: "Schliersee, Germany",
						point: [11.8598, 47.7362],
					},
					spatialConstraint: {
						kind: "area",
						center: {
							label: "Far away",
							point: [0, 0],
						},
						radiusMeters: 1000,
						enforcement: "strict",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Route stops must be inside the requested area.",
			fieldErrors: {
				spatialConstraint:
					"Move the area or increase its radius so all stops are inside it.",
			},
		});
	});

	it("sends point-to-point corridor constraints as a closed custom-model polygon", async () => {
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
					spatialConstraint: {
						kind: "corridor",
						widthMeters: 10000,
						enforcement: "strict",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		const ring =
			requestBody.custom_model.areas.features[0].geometry.coordinates[0];
		expect(ring.length).toBeGreaterThan(4);
		expect(ring[0]).toEqual(ring.at(-1));
		expect(requestBody.custom_model.priority[0]).toEqual({
			if: "in_route_constraint",
			multiply_by: "1",
		});
	});

	it("supports corridor constraints for out-and-back routes", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			buildRouteResponse([
				[11.5756, 48.1375, 522],
				[11.8597, 47.7361, 784],
			]),
		);

		const response = await POST(
			buildEvent(
				{
					mode: "out_and_back",
					start: {
						label: "Marienplatz, Munich, Germany",
						point: [11.5755, 48.1374],
					},
					turnaround: {
						label: "Schliersee, Germany",
						point: [11.8598, 47.7362],
					},
					spatialConstraint: {
						kind: "corridor",
						widthMeters: 12000,
						enforcement: "preferred",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.custom_model.priority.slice(0, 2)).toEqual([
			{ if: "in_route_constraint", multiply_by: "1" },
			{ else: "", multiply_by: "0.08" },
		]);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.spatialConstraint).toMatchObject({
			kind: "corridor",
			widthMeters: 12000,
			enforcement: "preferred",
		});
	});

	it("rejects corridor constraints for round-course routes", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Munich",
					},
					target: {
						kind: "distance",
						distanceMeters: 50000,
					},
					spatialConstraint: {
						kind: "corridor",
						widthMeters: 10000,
						enforcement: "strict",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Start and a round-course target are required.",
			fieldErrors: {
				spatialConstraint:
					"Corridor constraints are available for point-to-point and out-and-back routes.",
			},
		});
	});

	it("fails fast when a strict round-course area is too small for the target distance", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Marienplatz, Munich, Germany",
						point: [11.5755, 48.1374],
					},
					target: {
						kind: "distance",
						distanceMeters: 10000,
					},
					spatialConstraint: {
						kind: "area",
						center: {
							label: "Marienplatz, Munich, Germany",
							point: [11.5755, 48.1374],
						},
						radiusMeters: 1000,
						enforcement: "strict",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Increase the area radius or reduce the target distance.",
			fieldErrors: {
				spatialConstraint:
					"Increase the area radius or reduce the target distance.",
			},
		});
	});

	it("does not fall back to unconstrained GraphHopper strategies for active constraints", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response("custom model rejected", {
				status: 400,
			}),
		);

		const response = await POST(
			buildEvent(
				{
					mode: "point_to_point",
					start: {
						label: "Marienplatz, Munich, Germany",
						point: [11.5755, 48.1374],
					},
					waypoints: [],
					destination: {
						label: "Schliersee, Germany",
						point: [11.8598, 47.7362],
					},
					spatialConstraint: {
						kind: "area",
						center: {
							label: "Oberland",
							point: [11.72, 47.93],
						},
						radiusMeters: 90000,
						enforcement: "strict",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(502);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const requestProfiles = fetchMock.mock.calls.map((call) => {
			const body = JSON.parse(String(call[1]?.body));
			expect(body.custom_model).toBeDefined();
			return body.profile;
		});
		expect(requestProfiles).toEqual(["racingbike", "bike"]);
	});

	it("generates an out-and-back route by mirroring the outbound leg", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			buildRouteResponse([
				[11.5756, 48.1375, 522],
				[11.8597, 47.7361, 784],
			]),
		);

		const response = await POST(
			buildEvent(
				{
					mode: "out_and_back",
					start: {
						label: "Marienplatz, Munich, Germany",
						point: [11.5755, 48.1374],
					},
					turnaround: {
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
			[11.8598, 47.7362],
		]);
		expect(requestBody.algorithm).toBe("alternative_route");
		expect(requestBody["alternative_route.max_paths"]).toBe(3);

		const payload = (await response.json()) as RouteApiSuccess;
		const route = payload.routes[0];
		expect(route?.mode).toBe("out_and_back");
		expect(route?.startLabel).toBe("Marienplatz, Munich, Germany");
		expect(route?.destinationLabel).toBe("Schliersee, Germany");
		expect(route?.distanceMeters).toBe(122468);
		expect(route?.durationMs).toBe(19752000);
		expect(route?.ascendMeters).toBe(1560);
		expect(route?.descendMeters).toBe(1560);
		expect(route?.waypoints).toEqual([
			{
				label: "Schliersee, Germany",
				coordinate: [11.8597, 47.7361, 784],
			},
		]);
		expect(route?.coordinates).toEqual([
			[11.5755, 48.1374, 520],
			[11.7, 48.02, 575],
			[11.8598, 47.7362, 785],
			[11.7, 48.02, 575],
			[11.5755, 48.1374, 520],
		]);
		expect(route?.surfaceDetails).toEqual([
			{ from: 0, to: 2, value: "ASPHALT" },
			{ from: 2, to: 3, value: "COMPACTED" },
			{ from: 3, to: 4, value: "COMPACTED" },
			{ from: 4, to: 6, value: "ASPHALT" },
		]);
	});

	it("validates the required turnaround for out-and-back requests", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "out_and_back",
					start: {
						label: "Munich",
					},
					turnaround: {
						label: "",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Start and turnaround are required.",
			fieldErrors: {
				destinationQuery: "Enter a turnaround point.",
			},
		});
	});

	it("returns a field error when an out-and-back turnaround cannot be resolved", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(JSON.stringify({ hits: [] })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ hits: [] })));

		const response = await POST(
			buildEvent(
				{
					mode: "out_and_back",
					start: {
						label: "Marienplatz, Munich, Germany",
						point: [11.5755, 48.1374],
					},
					turnaround: {
						label: "Unknown pass",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(422);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		await expect(response.json()).resolves.toEqual({
			error: "We couldn't resolve one or more locations.",
			fieldErrors: {
				destinationQuery: "We couldn't resolve that turnaround point.",
			},
		});
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
		expect(requestBody.algorithm).toBe("alternative_route");
		expect(requestBody["alternative_route.max_paths"]).toBe(3);
		expect(requestBody.details).toEqual([
			"surface",
			"smoothness",
			"road_class",
			"road_environment",
			"road_access",
			"bike_network",
		]);

		const payload = (await response.json()) as RouteApiSuccess;
		const route = payload.routes[0];
		expect(payload.selectedRouteIndex).toBe(0);
		expect(route?.startLabel).toBe("Marienplatz, Munich, Germany");
		expect(route?.mode).toBe("point_to_point");
		expect(route?.destinationLabel).toBe("Schliersee, Germany");
		expect(route?.waypoints).toEqual([
			{
				label: "Tegernsee, Germany",
				coordinate: [11.7582, 47.7124, 734],
			},
		]);
		expect(route?.distanceMeters).toBe(61234);
		expect(route?.source).toEqual({
			kind: "graphhopper",
		});
		expect(route?.routingProfile).toBe("racingbike");
		expect(route?.routingStrategy).toContain("racingbike");
		expect(route?.routingWarnings).toEqual([]);
		expect(route?.surfaceDetails).toEqual([
			{ from: 0, to: 2, value: "ASPHALT" },
			{ from: 2, to: 3, value: "COMPACTED" },
		]);
	});

	it("returns multiple point-to-point alternatives when GraphHopper provides distinct paths", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			new Response(
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
								coordinates: [
									[11.5756, 48.1375, 522],
									[11.7582, 47.7124, 734],
									[11.8597, 47.7361, 784],
								],
							},
							details: {
								surface: [[0, 3, "ASPHALT"]],
								smoothness: [[0, 3, "GOOD"]],
							},
						},
						{
							distance: 64500,
							time: 10320000,
							ascend: 910,
							descend: 860,
							bbox: [11.5755, 47.7362, 11.8598, 48.1374],
							points: {
								coordinates: [
									[11.5755, 48.1374, 520],
									[11.66, 48.07, 610],
									[11.8598, 47.7362, 790],
								],
							},
							snapped_waypoints: {
								coordinates: [
									[11.5756, 48.1375, 522],
									[11.751, 47.721, 750],
									[11.8597, 47.7361, 784],
								],
							},
							details: {
								surface: [[0, 3, "COMPACTED"]],
								smoothness: [[0, 3, "INTERMEDIATE"]],
							},
						},
					],
				}),
			),
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
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes).toHaveLength(2);
		expect(payload.selectedRouteIndex).toBe(0);
		expect(payload.routes[1]?.distanceMeters).toBe(64500);
		expect(payload.routes[1]?.waypoints).toEqual([
			{
				label: "Tegernsee, Germany",
				coordinate: [11.751, 47.721, 750],
			},
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
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
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
		);

		for (let index = 0; index < 6; index += 1) {
			fetchMock.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522]),
			);
		}

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
		expect(fetchMock).toHaveBeenCalledTimes(7);
		const routeRequest = fetchMock.mock.calls[1];
		const requestBody = JSON.parse(String(routeRequest?.[1]?.body));
		expect(requestBody.profile).toBe("racingbike");
		expect(requestBody.custom_model).toBeDefined();
		expect(requestBody.points).toEqual([[11.5755, 48.1374]]);
		expect(requestBody.algorithm).toBe("round_trip");
		expect(requestBody["round_trip.distance"]).toBe(45000);

		const payload = (await response.json()) as RouteApiSuccess;
		const route = payload.routes[0];
		expect(payload.selectedRouteIndex).toBe(0);
		expect(route?.mode).toBe("round_course");
		expect(route?.startLabel).toBe("Marienplatz, Munich, Germany");
		expect(route?.destinationLabel).toBe("Marienplatz, Munich, Germany");
		expect(route?.roundCourseTarget).toEqual({
			kind: "distance",
			distanceMeters: 50000,
		});
		expect(route?.waypoints).toEqual([]);
		expect(route?.source).toEqual({
			kind: "graphhopper",
		});
		expect(route?.routingProfile).toBe("racingbike");
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
			error: "Start and a round-course target are required.",
			fieldErrors: {
				roundCourseTarget: "Enter a target distance.",
			},
		});
	});

	it("validates the required target time for round-course requests", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Munich",
					},
					target: {
						kind: "duration",
						durationMs: 0,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Start and a round-course target are required.",
			fieldErrors: {
				roundCourseTarget: "Enter a target time.",
			},
		});
	});

	it("validates the required target climb for round-course requests", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Munich",
					},
					target: {
						kind: "ascend",
						ascendMeters: 0,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Start and a round-course target are required.",
			fieldErrors: {
				roundCourseTarget: "Enter a target climb.",
			},
		});
	});

	it("searches round-course candidates for duration targets and returns the closest match", async () => {
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
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 69000,
					time: 14400000,
					ascend: 620,
				}),
			)
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 77000,
					time: 12600000,
					ascend: 680,
				}),
			)
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 84700,
					time: 11700000,
					ascend: 740,
				}),
			)
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 76000,
					time: 13200000,
					ascend: 650,
				}),
			)
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 78000,
					time: 12840000,
					ascend: 690,
				}),
			)
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 80000,
					time: 13500000,
					ascend: 710,
				}),
			);

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Marienplatz Munich",
					},
					target: {
						kind: "duration",
						durationMs: 12600000,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(7);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.durationMs).toBe(12600000);
		expect(payload.routes[0]?.roundCourseTarget).toEqual({
			kind: "duration",
			durationMs: 12600000,
		});
		expect(payload.routes[0]?.routingWarnings).toEqual([]);
	});

	it("searches round-course candidates for climb targets and returns the closest match", async () => {
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
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 60000,
					time: 10800000,
					ascend: 520,
				}),
			)
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 66667,
					time: 12000000,
					ascend: 790,
				}),
			)
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 73333,
					time: 12600000,
					ascend: 1020,
				}),
			)
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 65000,
					time: 11400000,
					ascend: 720,
				}),
			)
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 67000,
					time: 12100000,
					ascend: 780,
				}),
			)
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 69000,
					time: 12300000,
					ascend: 900,
				}),
			);

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Marienplatz Munich",
					},
					target: {
						kind: "ascend",
						ascendMeters: 800,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.ascendMeters).toBe(790);
		expect(payload.routes[0]?.roundCourseTarget).toEqual({
			kind: "ascend",
			ascendMeters: 800,
		});
	});

	it("returns the best successful round-course candidate when some search attempts fail", async () => {
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
			.mockResolvedValueOnce(new Response("upstream error", { status: 500 }))
			.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance: 77000,
					time: 12600000,
				}),
			)
			.mockResolvedValueOnce(new Response("upstream error", { status: 500 }))
			.mockResolvedValueOnce(new Response("upstream error", { status: 500 }))
			.mockResolvedValueOnce(new Response("upstream error", { status: 500 }))
			.mockResolvedValueOnce(new Response("upstream error", { status: 500 }));

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Marienplatz Munich",
					},
					target: {
						kind: "duration",
						durationMs: 12600000,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.durationMs).toBe(12600000);
	});

	it("adds a warning when the closest duration target still misses badly", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
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
		);

		for (const durationMs of [
			9000000, 9300000, 9600000, 9900000, 10200000, 10500000,
		]) {
			fetchMock.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					time: durationMs,
				}),
			);
		}

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Marienplatz Munich",
					},
					target: {
						kind: "duration",
						durationMs: 12600000,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.routingWarnings).toEqual([
			"Requested 3:30 h, but the closest round course came out to 2:55 h.",
		]);
	});

	it("accepts round-course responses even when GraphHopper omits snapped waypoints", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
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
		);

		for (let index = 0; index < 6; index += 1) {
			fetchMock.mockResolvedValueOnce(
				buildRoundCourseResponseWithoutSnappedWaypoints(),
			);
		}

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
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.mode).toBe("round_course");
		expect(payload.routes[0]?.startLabel).toBe("Marienplatz, Munich, Germany");
		expect(payload.routes[0]?.destinationLabel).toBe(
			"Marienplatz, Munich, Germany",
		);
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
		expect(racingbikeTunedRouteRequest.algorithm).toBe("alternative_route");
		expect(racingbikeBaseRouteRequest.profile).toBe("racingbike");
		expect(racingbikeBaseRouteRequest.custom_model).toBeUndefined();
		expect(racingbikeBaseRouteRequest["ch.disable"]).toBeUndefined();
		expect(racingbikeBaseRouteRequest.snap_preventions).toBeUndefined();
		expect(racingbikeBaseRouteRequest.algorithm).toBe("alternative_route");
		expect(bikeTunedRouteRequest.profile).toBe("bike");
		expect(bikeTunedRouteRequest.custom_model).toBeDefined();
		expect(bikeTunedRouteRequest["ch.disable"]).toBe(true);
		expect(bikeTunedRouteRequest.algorithm).toBe("alternative_route");

		await expect(response.json()).resolves.toMatchObject({
			routes: [
				{
					routingProfile: "bike",
					routingStrategy: expect.stringContaining("bike"),
					routingWarnings: [expect.stringContaining("racingbike profile")],
				},
			],
			selectedRouteIndex: 0,
		});
	});
});
