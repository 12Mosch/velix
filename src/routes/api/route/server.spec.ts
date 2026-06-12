import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({
	env: {
		GRAPHHOPPER_API_KEY: "graphhopper-test-key",
	},
}));

import { env } from "$env/dynamic/private";
import { POST } from "./+server";
import type {
	RouteApiError,
	RouteApiSuccess,
	RouteWarning,
} from "$lib/route-planning";
import { clearGraphHopperCachesForTests } from "$lib/server/graphhopper";
import { clearRouteRateLimitsForTests } from "$lib/server/route-rate-limits";

let eventId = 0;
const windUnavailableWarning =
	"Wind data is temporarily unavailable, so wind analysis was skipped.";

function expectWarnings(
	warnings: RouteWarning[] | undefined,
	expected: Array<Record<string, unknown>>,
) {
	expect(warnings).toEqual(
		expect.arrayContaining(
			expected.map((warning) => expect.objectContaining(warning)),
		),
	);
}

function buildEvent(
	body: unknown,
	fetchMock: typeof fetch,
	clientAddress = `route-test-${eventId++}`,
	headers: Record<string, string> = {},
) {
	return {
		request: new Request("http://localhost/api/route", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...headers,
			},
			body: JSON.stringify(body),
		}),
		fetch: fetchMock,
		getClientAddress: () => clientAddress,
	} as Parameters<typeof POST>[0];
}

function buildRawEvent(
	body: BodyInit,
	fetchMock: typeof fetch,
	clientAddress = `route-test-${eventId++}`,
	headers: Record<string, string> = {},
) {
	const requestInit: RequestInit & { duplex?: "half" } = {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...headers,
		},
		body,
	};

	if (body instanceof ReadableStream) {
		requestInit.duplex = "half";
	}

	return {
		request: new Request("http://localhost/api/route", requestInit),
		fetch: fetchMock,
		getClientAddress: () => clientAddress,
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
					instructions: [
						{
							distance: 250,
							time: 60000,
							text: "Continue onto Start Road",
							sign: 0,
							interval: [0, 1],
						},
						{
							distance: 980,
							time: 180000,
							text: "Turn right onto Main Street",
							sign: 2,
							interval: [1, 2],
						},
						{
							distance: Number.NaN,
							time: 1000,
							text: "Broken cue",
							sign: 2,
							interval: [2, 2],
						},
						{
							distance: -5,
							time: 1000,
							text: "Negative distance cue",
							sign: 2,
							interval: [1, 2],
						},
						{
							distance: 5,
							time: -1000,
							text: "Negative time cue",
							sign: 2,
							interval: [1, 2],
						},
						{
							distance: 5,
							time: 1000,
							text: "Reversed interval cue",
							sign: 2,
							interval: [2, 1],
						},
					],
					snapped_waypoints: {
						coordinates: points,
					},
					details: {
						surface: [
							[0, 2, "ASPHALT"],
							[2, 3, "COMPACTED"],
						],
						smoothness: [[0, 3, "GOOD"]],
						road_class: [[0, 3, "TERTIARY"]],
						road_environment: [[0, 3, "ROAD"]],
						road_access: [[0, 3, "YES"]],
						bike_network: [[0, 3, "LOCAL"]],
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
						road_class: [[0, 3, "TERTIARY"]],
						road_environment: [[0, 3, "ROAD"]],
						road_access: [[0, 3, "YES"]],
						bike_network: [[0, 3, "LOCAL"]],
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
						road_class: [[0, 3, "TERTIARY"]],
						road_environment: [[0, 3, "ROAD"]],
						road_access: [[0, 3, "YES"]],
						bike_network: [[0, 3, "LOCAL"]],
					},
				},
			],
		}),
	);
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function getFetchCallUrl(input: Parameters<typeof fetch>[0]): string {
	if (input instanceof Request) {
		return input.url;
	}

	if (input instanceof URL) {
		return input.toString();
	}

	return String(input);
}

function getNonWeatherFetchCalls(fetchMock: FetchMock) {
	return fetchMock.mock.calls.filter(
		(call) => !getFetchCallUrl(call[0]).includes("api.open-meteo.com"),
	);
}

function getRoundTripRequestedDistances(fetchMock: FetchMock): number[] {
	return getNonWeatherFetchCalls(fetchMock)
		.map((call) => {
			const body = call[1]?.body;

			if (!body) {
				return null;
			}

			const requestBody = JSON.parse(String(body));

			return requestBody.algorithm === "round_trip"
				? requestBody["round_trip.distance"]
				: null;
		})
		.filter((distance): distance is number => typeof distance === "number");
}

describe("POST /api/route", () => {
	beforeEach(() => {
		env.GRAPHHOPPER_API_KEY = "graphhopper-test-key";
		clearGraphHopperCachesForTests();
		clearRouteRateLimitsForTests();
	});

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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(1);
		const routeRequest = fetchMock.mock.calls[0];
		const requestBody = JSON.parse(String(routeRequest?.[1]?.body));
		expect(requestBody.points).toEqual([
			[11.5755, 48.1374],
			[11.7581, 47.7123],
			[11.8598, 47.7362],
		]);
		expect(requestBody.instructions).toBe(true);
		expect(requestBody.algorithm).toBe("alternative_route");
		expect(requestBody["alternative_route.max_paths"]).toBe(3);
		expect(requestBody["alternative_route.max_weight_factor"]).toBe(1.4);
		expect(requestBody["alternative_route.max_share_factor"]).toBe(0.6);
	});

	it("normalizes GraphHopper instructions and drops malformed rows", async () => {
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
					destination: {
						label: "Schliersee, Germany",
						point: [11.8598, 47.7362],
					},
				},
				fetchMock,
			),
		);
		const payload = (await response.json()) as RouteApiSuccess;
		const instructions = payload.routes[0]?.instructions ?? [];

		expect(response.status).toBe(200);
		expect(instructions).toHaveLength(2);
		expect(instructions[0]).toMatchObject({
			text: "Continue onto Start Road",
			sign: 0,
			type: "continue",
			segmentDistanceMeters: 250,
			segmentTimeMs: 60000,
			distanceFromStartMeters: 0,
			interval: [0, 1],
			coordinateIndex: 0,
			coordinate: [11.5755, 48.1374, 520],
		});
		expect(instructions[1]).toMatchObject({
			text: "Turn right onto Main Street",
			sign: 2,
			type: "right",
			segmentDistanceMeters: 980,
			segmentTimeMs: 180000,
			distanceFromStartMeters: 250,
			interval: [1, 2],
			coordinateIndex: 1,
			coordinate: [11.7, 48.02, 575],
		});
	});

	it("passes an abort signal to GraphHopper route requests", async () => {
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
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
	});

	it("maps a missing GraphHopper API key to the routing configuration error", async () => {
		env.GRAPHHOPPER_API_KEY = "";
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
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(500);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Routing is not configured yet. Add GRAPHHOPPER_API_KEY.",
		});
	});

	it("rate-limits route requests before geocoding or routing", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
			Promise.resolve(
				buildRouteResponse([
					[11.5756, 48.1375, 522],
					[11.8597, 47.7361, 784],
				]),
			),
		);
		const body = {
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
		};

		for (let index = 0; index < 10; index += 1) {
			await POST(buildEvent(body, fetchMock, "limited-client"));
		}

		const response = await POST(buildEvent(body, fetchMock, "limited-client"));

		expect(response.status).toBe(429);
		expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(Number(response.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(10);
		await expect(response.json()).resolves.toEqual({
			error: "Too many route requests. Try again soon.",
		});
	});

	it("accepts typed coordinate labels for point-to-point start and destination", async () => {
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
						label: "48.1374, 11.5755",
					},
					waypoints: [],
					destination: {
						label: "47.7362 11.8598",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("geocode");
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.points).toEqual([
			[11.5755, 48.1374],
			[11.8598, 47.7362],
		]);

		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.startLabel).toBe("48.13740, 11.57550");
		expect(payload.routes[0]?.destinationLabel).toBe("47.73620, 11.85980");
	});

	it("accepts coordinate-only point-to-point start and destination", async () => {
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
						point: [11.5755, 48.1374],
					},
					destination: {
						point: [11.8598, 47.7362],
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("geocode");
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.points).toEqual([
			[11.5755, 48.1374],
			[11.8598, 47.7362],
		]);
	});

	it("rejects impossible structured start coordinates before routing", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "point_to_point",
					start: {
						point: [181, 48.1374],
					},
					destination: {
						point: [11.8598, 47.7362],
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Invalid route request payload.",
		});
	});

	it("accepts coordinate-only point-to-point waypoints", async () => {
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("geocode");
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.points).toEqual([
			[11.5755, 48.1374],
			[11.7581, 47.7123],
			[11.8598, 47.7362],
		]);
	});

	it("rejects impossible structured waypoint coordinates before routing", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "point_to_point",
					start: {
						point: [11.5755, 48.1374],
					},
					waypoints: [
						{
							point: [11.7581, -91],
						},
					],
					destination: {
						point: [11.8598, 47.7362],
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Invalid route request payload.",
		});
	});

	it("rejects excessive waypoint arrays before scanning coordinates", async () => {
		const invalidWaypoint = {
			point: [11.7581, -91],
		};
		const waypoints = [
			invalidWaypoint,
			{ point: [11.76, 47.72] },
			{ point: [11.77, 47.73] },
			{ point: [11.78, 47.74] },
		];
		const cases = [
			{
				mode: "point_to_point",
				payload: {
					mode: "point_to_point",
					start: {
						point: [11.5755, 48.1374],
					},
					waypoints,
					destination: {
						point: [11.8598, 47.7362],
					},
				},
			},
			{
				mode: "out_and_back",
				payload: {
					mode: "out_and_back",
					start: {
						point: [11.5755, 48.1374],
					},
					waypoints,
					turnaround: {
						point: [11.8598, 47.7362],
					},
				},
			},
			{
				mode: "round_course",
				payload: {
					mode: "round_course",
					start: {
						point: [11.5755, 48.1374],
					},
					waypoints,
					target: {
						kind: "distance",
						distanceMeters: 50000,
					},
				},
			},
		];

		for (const testCase of cases) {
			const fetchMock = vi.fn<typeof fetch>();
			const response = await POST(buildEvent(testCase.payload, fetchMock));

			expect(response.status, testCase.mode).toBe(400);
			expect(fetchMock, testCase.mode).not.toHaveBeenCalled();
			await expect(response.json()).resolves.toEqual({
				error: "You can add up to 3 waypoints per route.",
				fieldErrors: {
					waypointQueries: [
						"You can add up to 3 waypoints per route.",
						"You can add up to 3 waypoints per route.",
						"You can add up to 3 waypoints per route.",
						"You can add up to 3 waypoints per route.",
					],
				},
			});
		}
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(1);
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

	it("sends road avoidances through GraphHopper custom-model areas", async () => {
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
					avoidances: [
						{
							kind: "road_segment",
							centerline: [
								[11.6, 48.1],
								[11.61, 48.11],
							],
							bufferMeters: 35,
						},
					],
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(1);
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody["ch.disable"]).toBe(true);
		expect(requestBody.custom_model.areas.features[0]).toMatchObject({
			id: "avoid_road_0",
			geometry: {
				type: "Polygon",
			},
		});
		expect(requestBody.custom_model.priority[0]).toEqual({
			if: "in_avoid_road_0",
			multiply_by: "0",
		});

		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.avoidances?.[0]).toMatchObject({
			kind: "road_segment",
			label: "Avoided road 1",
			centerline: [
				[11.6, 48.1],
				[11.61, 48.11],
			],
			bufferMeters: 35,
		});
		expect(payload.routes[0]?.avoidances?.[0]?.polygon.at(-1)).toEqual(
			payload.routes[0]?.avoidances?.[0]?.polygon[0],
		);
	});

	it("combines spatial constraints and road avoidances in one custom model", async () => {
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
						center: { label: "Oberland", point: [11.72, 47.93] },
						radiusMeters: 90000,
						enforcement: "strict",
					},
					avoidances: [
						{
							kind: "road_segment",
							centerline: [
								[11.6, 48.1],
								[11.61, 48.11],
							],
							bufferMeters: 35,
						},
					],
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		const areaIds = requestBody.custom_model.areas.features.map(
			(feature: { id: string }) => feature.id,
		);
		expect(areaIds).toEqual(
			expect.arrayContaining(["route_constraint", "avoid_road_0"]),
		);
		expect(requestBody.custom_model.priority).toEqual(
			expect.arrayContaining([
				{ if: "in_avoid_road_0", multiply_by: "0" },
				{ if: "in_route_constraint", multiply_by: "1" },
				{ else: "", multiply_by: "0" },
			]),
		);
	});

	it("accepts typed coordinates for an area constraint center without geocoding", async () => {
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
							label: "lat: 48.0000 lng: 11.7000",
						},
						radiusMeters: 90000,
						enforcement: "preferred",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("geocode");
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.spatialConstraint).toMatchObject({
			kind: "area",
			label: "48.00000, 11.70000",
			center: [11.7, 48],
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(2);
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
			error:
				"Corridor constraints are available for point-to-point and out-and-back routes.",
			fieldErrors: {
				spatialConstraint:
					"Corridor constraints are available for point-to-point and out-and-back routes.",
			},
		});
	});

	it("does not reject strict round-course areas based on target circumference", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockImplementation(() =>
				Promise.resolve(buildRoundCourseResponse([11.5756, 48.1375, 522])),
			);

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

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalled();
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(2);
		const requestProfiles = fetchMock.mock.calls.map((call) => {
			const body = JSON.parse(String(call[1]?.body));
			expect(body.custom_model).toBeDefined();
			return body.profile;
		});
		expect(requestProfiles).toEqual(["racingbike", "bike"]);
	});

	it("does not fall back to unconstrained GraphHopper strategies for active avoidances", async () => {
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
					avoidances: [
						{
							kind: "road_segment",
							centerline: [
								[11.6, 48.1],
								[11.61, 48.11],
							],
							bufferMeters: 35,
						},
					],
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(502);
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(2);
		const routingCalls = fetchMock.mock.calls.filter((call) => {
			const url = getFetchCallUrl(call[0]);
			return !url.includes("api.open-meteo.com") && url.includes("/route");
		});
		for (const call of routingCalls) {
			const body = JSON.parse(String(call[1]?.body));
			expect(body.custom_model).toBeDefined();
			expect(body.custom_model.priority[0]).toEqual({
				if: "in_avoid_road_0",
				multiply_by: "0",
			});
		}
	});

	it("returns a validation error for malformed road avoidance input", async () => {
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
					avoidances: [
						{
							kind: "road_segment",
							centerline: [[11.6, 48.1]],
							bufferMeters: 35,
						},
					],
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toMatchObject({
			fieldErrors: {
				avoidances: "Choose a valid road segment to avoid.",
			},
		});
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(1);
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
		expect(route?.instructions).toHaveLength(2);
		expect(route?.instructions?.[1]).toMatchObject({
			text: "Turn right onto Main Street",
			type: "right",
			coordinateIndex: 1,
			coordinate: [11.7, 48.02, 575],
		});
		expect(route?.surfaceDetails).toEqual([
			{ from: 0, to: 2, value: "ASPHALT" },
			{ from: 2, to: 3, value: "COMPACTED" },
			{ from: 3, to: 4, value: "COMPACTED" },
			{ from: 4, to: 6, value: "ASPHALT" },
		]);
		expect(route?.roadClassDetails).toEqual([
			{ from: 0, to: 3, value: "TERTIARY" },
			{ from: 3, to: 6, value: "TERTIARY" },
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
			error: "Enter a turnaround point.",
			fieldErrors: {
				destinationQuery: "Enter a turnaround point.",
			},
		});
	});

	it("accepts coordinate-only out-and-back start and turnaround", async () => {
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
						point: [11.5755, 48.1374],
					},
					turnaround: {
						point: [11.8598, 47.7362],
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("geocode");
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(2);
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(4);
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
		expect(route?.routingWarnings).toBeUndefined();
		expectWarnings(route?.warnings, [
			{
				category: "routing_provider",
				code: "wind_analysis_unavailable",
				message: windUnavailableWarning,
			},
		]);
		expect(route?.surfaceDetails).toEqual([
			{ from: 0, to: 2, value: "ASPHALT" },
			{ from: 2, to: 3, value: "COMPACTED" },
		]);
		expect(route?.roadClassDetails).toEqual([
			{ from: 0, to: 3, value: "TERTIARY" },
		]);
		expect(route?.roadEnvironmentDetails).toEqual([
			{ from: 0, to: 3, value: "ROAD" },
		]);
		expect(route?.roadAccessDetails).toEqual([
			{ from: 0, to: 3, value: "YES" },
		]);
		expect(route?.bikeNetworkDetails).toEqual([
			{ from: 0, to: 3, value: "LOCAL" },
		]);
		expect(route?.routeQuality?.overallScore).not.toBeNull();
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
			error: "Enter a start point.",
			fieldErrors: {
				startQuery: "Enter a start point.",
				waypointQueries: ["Enter a waypoint or remove this stop.", ""],
			},
		});
	});

	it("keeps empty structured stops invalid while accepting coordinate-only waypoints", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "point_to_point",
					start: {},
					waypoints: [
						{},
						{
							point: [11.7581, 47.7123],
						},
					],
					destination: {
						point: [11.8598, 47.7362],
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Enter a start point.",
			fieldErrors: {
				startQuery: "Enter a start point.",
				waypointQueries: ["Enter a waypoint or remove this stop.", ""],
			},
		});
	});

	it("rejects non-object JSON payloads as invalid route requests", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(buildEvent("not an object", fetchMock));

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Invalid route request payload.",
		});
	});

	it("rejects oversized route request bodies before parsing JSON", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent({}, fetchMock, undefined, {
				"content-length": String(128 * 1024 + 1),
			}),
		);

		expect(response.status).toBe(413);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Route request payload is too large.",
		});
	});

	it("rejects oversized streamed route request bodies without content-length", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		const chunk = new TextEncoder().encode(" ".repeat(64 * 1024));
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(chunk);
			},
		});

		const response = await POST(buildRawEvent(body, fetchMock));

		expect(response.status).toBe(413);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Route request payload is too large.",
		});
	});

	it("keeps invalid spatial constraints on the field-error path", async () => {
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
						kind: "triangle",
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Choose an area or corridor constraint.",
			fieldErrors: {
				spatialConstraint: "Choose an area or corridor constraint.",
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(7);
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
		expect(payload.roundCourseCandidateErrors).toBeUndefined();
	});

	it("accepts coordinate-only round-course starts", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockImplementation(() =>
				Promise.resolve(buildRoundCourseResponse([11.5756, 48.1375, 522])),
			);

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						point: [11.5755, 48.1374],
					},
					target: {
						kind: "distance",
						distanceMeters: 50000,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(6);
		expect(
			fetchMock.mock.calls.every(
				(call) => !String(call[0]).includes("geocode"),
			),
		).toBe(true);
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.points).toEqual([[11.5755, 48.1374]]);
	});

	it("validates the minimum target distance for round-course requests", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Munich",
					},
					requestedDistanceMeters: 9999,
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Enter a target distance.",
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
			error: "Enter a target time.",
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
			error: "Enter a target climb.",
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(7);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.durationMs).toBe(12600000);
		expect(payload.routes[0]?.roundCourseTarget).toEqual({
			kind: "duration",
			durationMs: 12600000,
		});
		expect(payload.routes[0]?.trainingSuitability).toBeUndefined();
		expect(payload.routes[0]?.routingWarnings).toBeUndefined();
		expectWarnings(payload.routes[0]?.warnings, [
			{
				category: "routing_provider",
				code: "wind_analysis_unavailable",
				message: windUnavailableWarning,
			},
		]);
	});

	it("uses workout target distance and adjusted duration for round-course candidates", async () => {
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

		for (const distance of [45000, 59000, 75000, 58500, 60000, 61500]) {
			fetchMock.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					distance,
					time: 9990000,
					ascend: 600,
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
						kind: "workout",
						durationMs: 2 * 60 * 60 * 1000,
						distanceMeters: 60000,
						estimatedSpeedMetersPerHour: 30000,
						weightedIntensity: 0.9,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(getRoundTripRequestedDistances(fetchMock).slice(0, 3)).toEqual([
			45000, 60000, 75000,
		]);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.durationMs).toBe(7326000);
		expect(payload.routes[0]?.durationMs).not.toBe(9990000);
		expect(payload.routes[0]?.roundCourseTarget).toEqual({
			kind: "workout",
			durationMs: 7200000,
			distanceMeters: 60000,
			estimatedSpeedMetersPerHour: 30000,
			weightedIntensity: 0.9,
		});
		expect(payload.routes[0]?.trainingSuitability?.overallScore).not.toBeNull();
		expect(
			payload.routes[0]?.trainingSuitability?.subscores.durationMatch.label,
		).toBe("Duration match");
	});

	it("runs a third adaptive duration search round only when the first two rounds miss badly", async () => {
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
			7200000, 7800000, 8400000, 9000000, 9300000, 9600000, 12000000, 12600000,
			13200000,
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
		expect(getRoundTripRequestedDistances(fetchMock)).toEqual([
			57750, 77000, 96250, 129938, 144375, 158813, 187597, 208441, 220000,
		]);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.durationMs).toBe(12600000);
		expect(payload.routes[0]?.routingWarnings).toBeUndefined();
		expectWarnings(payload.routes[0]?.warnings, [
			{
				category: "routing_provider",
				code: "wind_analysis_unavailable",
				message: windUnavailableWarning,
			},
		]);
	});

	it("stops duration target search after two rounds when a candidate is close enough", async () => {
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
			9000000, 10800000, 13500000, 11100000, 11900000, 12300000,
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(7);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.durationMs).toBe(12300000);
		expect(payload.routes[0]?.routingWarnings).toBeUndefined();
		expectWarnings(payload.routes[0]?.warnings, [
			{
				category: "routing_provider",
				code: "wind_analysis_unavailable",
				message: windUnavailableWarning,
			},
		]);
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

	it("interpolates climb target searches between under and over ascent candidates", async () => {
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

		for (const ascendMeters of [600, 750, 900, 760, 800, 840]) {
			fetchMock.mockResolvedValueOnce(
				buildRoundCourseResponse([11.5756, 48.1375, 522], {
					ascend: ascendMeters,
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
						kind: "ascend",
						ascendMeters: 800,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(getRoundTripRequestedDistances(fetchMock)).toEqual([
			50000, 66667, 83333, 65000, 72222, 79444,
		]);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.ascendMeters).toBe(800);
	});

	it("skips duplicate clamped round-course distances", async () => {
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

		for (const durationMs of [900000, 900000, 900000, 900000]) {
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
						durationMs: 15 * 60 * 1000,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const requestedDistances = getRoundTripRequestedDistances(fetchMock);
		expect(requestedDistances).toEqual([10000, 12500, 10000, 11000]);
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(5);
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
		expect(payload.roundCourseCandidateErrors).toEqual([
			{
				roundIndex: 0,
				candidateIndex: 0,
				sequence: 0,
				requestedDistanceMeters: 57750,
				seed: 11,
				errorTag: "GraphHopperRouteStatusError",
				message: "Routing failed with status 500: upstream error",
				status: 500,
			},
			{
				roundIndex: 0,
				candidateIndex: 2,
				sequence: 2,
				requestedDistanceMeters: 96250,
				seed: 73,
				errorTag: "GraphHopperRouteStatusError",
				message: "Routing failed with status 500: upstream error",
				status: 500,
			},
			{
				roundIndex: 1,
				candidateIndex: 0,
				sequence: 3,
				requestedDistanceMeters: 69300,
				seed: 109,
				errorTag: "GraphHopperRouteStatusError",
				message: "Routing failed with status 500: upstream error",
				status: 500,
			},
			{
				roundIndex: 1,
				candidateIndex: 1,
				sequence: 4,
				requestedDistanceMeters: 77000,
				seed: 149,
				errorTag: "GraphHopperRouteStatusError",
				message: "Routing failed with status 500: upstream error",
				status: 500,
			},
			{
				roundIndex: 1,
				candidateIndex: 2,
				sequence: 5,
				requestedDistanceMeters: 84700,
				seed: 191,
				errorTag: "GraphHopperRouteStatusError",
				message: "Routing failed with status 500: upstream error",
				status: 500,
			},
		]);
	});

	it("returns round-course candidate diagnostics when every candidate fails", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		for (let index = 0; index < 9; index += 1) {
			fetchMock.mockResolvedValueOnce(
				new Response("upstream error", { status: 500 }),
			);
		}

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Start",
						point: [11.5755, 48.1374],
					},
					target: {
						kind: "distance",
						distanceMeters: 50000,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(502);
		const payload = (await response.json()) as RouteApiError;
		expect(payload.error).toBe(
			"GraphHopper could not generate a round course right now.",
		);
		expect(payload.roundCourseCandidateErrors).toHaveLength(9);
		expect(payload.roundCourseCandidateErrors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					roundIndex: 0,
					candidateIndex: 0,
					sequence: 0,
					requestedDistanceMeters: 45000,
					seed: 11,
					errorTag: "GraphHopperRouteStatusError",
					message: "Routing failed with status 500: upstream error",
					status: 500,
				}),
				expect.objectContaining({
					roundIndex: 2,
					candidateIndex: 2,
					sequence: 8,
					seed: 331,
					errorTag: "GraphHopperRouteStatusError",
					message: "Routing failed with status 500: upstream error",
					status: 500,
				}),
			]),
		);
		expect(
			payload.roundCourseCandidateErrors?.[8]?.requestedDistanceMeters,
		).toBeCloseTo(55000);
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
			9000000, 9300000, 9600000, 9900000, 10200000, 10500000, 9900000, 10200000,
			10400000,
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
		expect(payload.routes[0]?.routingWarnings).toBeUndefined();
		expectWarnings(payload.routes[0]?.warnings, [
			{
				category: "routing_provider",
				code: "routing_profile_fallback",
				message:
					"Requested 3:30 h, but the closest round course came out to 2:55 h.",
			},
			{
				category: "routing_provider",
				code: "wind_analysis_unavailable",
				message: windUnavailableWarning,
			},
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
				waypointQueries: [
					"You can add up to 3 waypoints per route.",
					"You can add up to 3 waypoints per route.",
					"You can add up to 3 waypoints per route.",
					"You can add up to 3 waypoints per route.",
				],
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(4);
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
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(5);

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

		const fallbackPayload = (await response.json()) as RouteApiSuccess;
		expect(fallbackPayload).toMatchObject({
			routes: [
				{
					routingProfile: "bike",
					routingStrategy: expect.stringContaining("bike"),
				},
			],
			selectedRouteIndex: 0,
		});
		expect(fallbackPayload.routes[0]?.routingWarnings).toBeUndefined();
		expectWarnings(fallbackPayload.routes[0]?.warnings, [
			{
				category: "routing_provider",
				code: "routing_profile_fallback",
				message: expect.stringContaining("racingbike profile"),
			},
			{
				category: "routing_provider",
				code: "wind_analysis_unavailable",
				message: windUnavailableWarning,
			},
		]);
	});

	it("routes out-and-back shaping waypoints before mirroring the outbound path", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			buildRouteResponse([
				[11.5755, 48.1374, 520],
				[11.7581, 47.7123, 734],
				[11.8598, 47.7362, 785],
			]),
		);

		const response = await POST(
			buildEvent(
				{
					mode: "out_and_back",
					start: {
						label: "Start",
						point: [11.5755, 48.1374],
					},
					waypoints: [
						{
							label: "Shaper",
							point: [11.7581, 47.7123],
						},
					],
					turnaround: {
						label: "Turnaround",
						point: [11.8598, 47.7362],
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.points).toEqual([
			[11.5755, 48.1374],
			[11.7581, 47.7123],
			[11.8598, 47.7362],
		]);

		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.mode).toBe("out_and_back");
		expect(
			payload.routes[0]?.waypoints.map((waypoint) => waypoint.label),
		).toEqual(["Shaper", "Turnaround"]);
		expect(payload.routes[0]?.coordinates).toHaveLength(5);
	});

	it("routes shaped round courses as closed loops and keeps the target as metadata", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			buildRouteResponse([
				[11.5755, 48.1374, 520],
				[11.7581, 47.7123, 734],
				[11.5755, 48.1374, 520],
			]),
		);

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "Start",
						point: [11.5755, 48.1374],
					},
					waypoints: [
						{
							label: "Shaper",
							point: [11.7581, 47.7123],
						},
					],
					target: {
						kind: "distance",
						distanceMeters: 50000,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.points).toEqual([
			[11.5755, 48.1374],
			[11.7581, 47.7123],
			[11.5755, 48.1374],
		]);
		expect(requestBody.algorithm).toBe("alternative_route");

		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]).toMatchObject({
			mode: "round_course",
			roundCourseTarget: {
				kind: "distance",
				distanceMeters: 50000,
			},
			waypoints: [
				{
					label: "Shaper",
					coordinate: [11.7581, 47.7123, 734],
				},
			],
		});
		expect(payload.routes[0]?.routingWarnings).toBeUndefined();
		expectWarnings(payload.routes[0]?.warnings, [
			{
				category: "routing_provider",
				code: "routing_profile_fallback",
				message:
					"Manual shaping points make the round-course target best-effort.",
			},
			{
				category: "routing_provider",
				code: "wind_analysis_unavailable",
				message: windUnavailableWarning,
			},
		]);
		expect(payload.roundCourseCandidateErrors).toBeUndefined();
	});

	it("accepts typed coordinate labels for round-course starts and shaping waypoints", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			buildRouteResponse([
				[11.5755, 48.1374, 520],
				[11.7581, 47.7123, 734],
				[11.5755, 48.1374, 520],
			]),
		);

		const response = await POST(
			buildEvent(
				{
					mode: "round_course",
					start: {
						label: "48.1374, 11.5755",
					},
					waypoints: [
						{
							label: "lng: 11.7581 lat: 47.7123",
						},
					],
					target: {
						kind: "distance",
						distanceMeters: 50000,
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(getNonWeatherFetchCalls(fetchMock)).toHaveLength(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("geocode");
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.points).toEqual([
			[11.5755, 48.1374],
			[11.7581, 47.7123],
			[11.5755, 48.1374],
		]);

		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]).toMatchObject({
			mode: "round_course",
			startLabel: "48.13740, 11.57550",
			destinationLabel: "48.13740, 11.57550",
			waypoints: [
				{
					label: "47.71230, 11.75810",
					coordinate: [11.7581, 47.7123, 734],
				},
			],
		});
	});

	it("filters manual editing locks down to non-negative segment indexes", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
			buildRouteResponse([
				[11.5755, 48.1374, 520],
				[11.8598, 47.7362, 785],
			]),
		);

		const response = await POST(
			buildEvent(
				{
					mode: "point_to_point",
					start: {
						label: "Start",
						point: [11.5755, 48.1374],
					},
					waypoints: [],
					destination: {
						label: "Destination",
						point: [11.8598, 47.7362],
					},
					manualEditing: {
						lockedSegmentIndexes: [-1, 0, 2],
					},
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as RouteApiSuccess;
		expect(payload.routes[0]?.manualEditing).toEqual({
			lockedSegmentIndexes: [0, 2],
		});
	});
});
