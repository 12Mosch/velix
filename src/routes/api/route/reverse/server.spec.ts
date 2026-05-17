import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({
	env: {
		GRAPHHOPPER_API_KEY: "graphhopper-test-key",
	},
}));

import { env } from "$env/dynamic/private";
import { GET } from "./+server";
import { clearGraphHopperCachesForTests } from "$lib/server/graphhopper";
import { clearRouteRateLimitsForTests } from "$lib/server/route-rate-limits";

let eventId = 0;

function buildEvent(
	url: string,
	fetchMock: typeof fetch,
	clientAddress = `reverse-test-${eventId++}`,
) {
	return {
		url: new URL(url),
		fetch: fetchMock,
		getClientAddress: () => clientAddress,
	} as Parameters<typeof GET>[0];
}

describe("GET /api/route/reverse", () => {
	beforeEach(() => {
		env.GRAPHHOPPER_API_KEY = "graphhopper-test-key";
		clearGraphHopperCachesForTests();
		clearRouteRateLimitsForTests();
	});

	it("rejects out-of-range geographic coordinates before calling GraphHopper", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await GET(
			buildEvent(
				"http://localhost/api/route/reverse?lat=95&lng=181",
				fetchMock,
			),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "A valid lat/lng pair is required.",
		});
	});

	it("rejects missing geographic coordinates before calling GraphHopper", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const missingLatitudeResponse = await GET(
			buildEvent("http://localhost/api/route/reverse?lng=11.5755", fetchMock),
		);
		const missingLongitudeResponse = await GET(
			buildEvent("http://localhost/api/route/reverse?lat=48.1374", fetchMock),
		);

		expect(missingLatitudeResponse.status).toBe(400);
		expect(missingLongitudeResponse.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(missingLatitudeResponse.json()).resolves.toEqual({
			error: "A valid lat/lng pair is required.",
		});
		await expect(missingLongitudeResponse.json()).resolves.toEqual({
			error: "A valid lat/lng pair is required.",
		});
	});

	it("returns the reverse-geocoded label for a clicked point", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
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

		const response = await GET(
			buildEvent(
				"http://localhost/api/route/reverse?lat=48.1374&lng=11.5755",
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain("reverse=true");
		await expect(response.json()).resolves.toEqual({
			label: "Marienplatz, Munich, Germany",
			point: [11.5755, 48.1374],
		});
	});

	it("maps a missing GraphHopper API key to the reverse configuration error", async () => {
		env.GRAPHHOPPER_API_KEY = "";
		const fetchMock = vi.fn<typeof fetch>();

		const response = await GET(
			buildEvent(
				"http://localhost/api/route/reverse?lat=48.1374&lng=11.5755",
				fetchMock,
			),
		);

		expect(response.status).toBe(500);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error:
				"Reverse geocoding is not configured yet. Add GRAPHHOPPER_API_KEY.",
		});
	});

	it("caches repeated reverse geocoding for the same rounded coordinates", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
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

		const firstResponse = await GET(
			buildEvent(
				"http://localhost/api/route/reverse?lat=48.137401&lng=11.575501",
				fetchMock,
			),
		);
		const secondResponse = await GET(
			buildEvent(
				"http://localhost/api/route/reverse?lat=48.137404&lng=11.575504",
				fetchMock,
			),
		);

		expect(firstResponse.status).toBe(200);
		expect(secondResponse.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await expect(secondResponse.json()).resolves.toEqual({
			label: "Marienplatz, Munich, Germany",
			point: [11.575504, 48.137404],
		});
	});

	it("rate-limits reverse geocoding requests before calling GraphHopper", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						hits: [
							{
								name: "Place",
								point: {
									lat: 48.1,
									lng: 11.5,
								},
							},
						],
					}),
				),
			),
		);

		for (let index = 0; index < 60; index += 1) {
			await GET(
				buildEvent(
					`http://localhost/api/route/reverse?lat=48.${index.toString().padStart(4, "0")}&lng=11.5755`,
					fetchMock,
					"limited-client",
				),
			);
		}

		const response = await GET(
			buildEvent(
				"http://localhost/api/route/reverse?lat=48.9999&lng=11.5755",
				fetchMock,
				"limited-client",
			),
		);

		expect(response.status).toBe(429);
		expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(Number(response.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
		expect(fetchMock).toHaveBeenCalledTimes(60);
		await expect(response.json()).resolves.toEqual({
			error: "Too many reverse geocoding requests. Try again soon.",
		});
	});

	it("falls back to a coordinate label when GraphHopper returns no place name", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(JSON.stringify({ hits: [] })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ hits: [] })));

		const response = await GET(
			buildEvent(
				"http://localhost/api/route/reverse?lat=48.1374&lng=11.5755",
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			label: "48.13740, 11.57550",
			point: [11.5755, 48.1374],
		});
	});

	it("tries the default GraphHopper provider after Nominatim rejects reverse geocoding", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("bad request", { status: 400 }))
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
			);

		const response = await GET(
			buildEvent(
				"http://localhost/api/route/reverse?lat=48.1374&lng=11.5755",
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
			"provider=nominatim",
		);
		expect(String(fetchMock.mock.calls[1]?.[0])).toContain("locale=en");
		await expect(response.json()).resolves.toEqual({
			label: "Marienplatz, Munich, Germany",
			point: [11.5755, 48.1374],
		});
	});
});
