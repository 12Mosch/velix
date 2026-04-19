import { describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({
	env: {
		GRAPHHOPPER_API_KEY: "graphhopper-test-key",
	},
}));

import { POST } from "./+server";

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

describe("POST /api/route", () => {
	it("geocodes both inputs, requests a GraphHopper bike route, and returns normalized data", async () => {
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
				),
			);

		const response = await POST(
			buildEvent(
				{
					startQuery: "Marienplatz Munich",
					destinationQuery: "Schliersee",
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain("provider=nominatim");
		expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("locale=");
		expect(String(fetchMock.mock.calls[1]?.[0])).toContain("provider=nominatim");

		const routeRequest = fetchMock.mock.calls[2];
		expect(routeRequest?.[0]).toBe(
			"https://graphhopper.com/api/1/route?key=graphhopper-test-key",
		);

		const requestOptions = routeRequest?.[1];
		const requestBody = JSON.parse(String(requestOptions?.body));
		expect(requestBody.profile).toBe("bike");
		expect(requestBody.points_encoded).toBe(false);
		expect(requestBody.elevation).toBe(true);
		expect(requestBody.details).toEqual([
			"surface",
			"smoothness",
			"road_class",
			"road_environment",
		]);

		const payload = (await response.json()) as {
			route: {
				startLabel: string;
				destinationLabel: string;
				distanceMeters: number;
				surfaceDetails: Array<{ from: number; to: number; value: string }>;
			};
		};

		expect(payload.route.startLabel).toBe("Marienplatz, Munich, Germany");
		expect(payload.route.destinationLabel).toBe("Schliersee, Germany");
		expect(payload.route.distanceMeters).toBe(61234);
		expect(payload.route.surfaceDetails).toEqual([
			{ from: 0, to: 2, value: "ASPHALT" },
			{ from: 2, to: 3, value: "COMPACTED" },
		]);
	});

	it("validates missing input before calling GraphHopper", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(
			buildEvent(
				{
					startQuery: "",
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
			},
		});
	});

	it("returns field errors when a location cannot be resolved", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(JSON.stringify({ hits: [] })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ hits: [] })))
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
			);

		const response = await POST(
			buildEvent(
				{
					startQuery: "Unknown village",
					destinationQuery: "Berlin",
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toEqual({
			error: "We couldn't resolve one or both locations.",
			fieldErrors: {
				startQuery: "We couldn't resolve that start point.",
			},
		});
	});

	it("falls back to the default geocoder when Nominatim returns 400", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "bad request" }), { status: 400 }),
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
				new Response(
					JSON.stringify({
						paths: [
							{
								distance: 1000,
								time: 120000,
								ascend: 10,
								descend: 8,
								bbox: [12.3731, 51.3397, 13.405, 52.52],
								points: {
									coordinates: [
										[13.405, 52.52, 40],
										[12.3731, 51.3397, 50],
									],
								},
								details: {},
							},
						],
					}),
				),
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
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain("provider=nominatim");
		expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("provider=nominatim");
		expect(String(fetchMock.mock.calls[1]?.[0])).toContain("locale=en");
		expect(String(fetchMock.mock.calls[2]?.[0])).toContain("provider=nominatim");
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
				new Response(JSON.stringify({ message: "rate limited" }), { status: 429 }),
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

	it("retries with a plain bike route when GraphHopper rejects the custom road-bike payload", async () => {
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
				new Response(
					JSON.stringify({
						paths: [
							{
								distance: 190000,
								time: 28000000,
								ascend: 200,
								descend: 180,
								bbox: [12.3731, 51.3397, 13.405, 52.52],
								points: {
									coordinates: [
										[13.405, 52.52, 40],
										[12.3731, 51.3397, 50],
									],
								},
								details: {},
							},
						],
					}),
				),
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
		expect(fetchMock).toHaveBeenCalledTimes(4);

		const tunedRouteRequest = JSON.parse(
			String(fetchMock.mock.calls[2]?.[1]?.body),
		) as Record<string, unknown>;
		const fallbackRouteRequest = JSON.parse(
			String(fetchMock.mock.calls[3]?.[1]?.body),
		) as Record<string, unknown>;

		expect(tunedRouteRequest.custom_model).toBeDefined();
		expect(tunedRouteRequest["ch.disable"]).toBe(true);
		expect(fallbackRouteRequest.custom_model).toBeUndefined();
		expect(fallbackRouteRequest["ch.disable"]).toBeUndefined();
		expect(fallbackRouteRequest.snap_preventions).toBeUndefined();
	});
});
