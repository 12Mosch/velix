import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({
	env: {
		GRAPHHOPPER_API_KEY: "graphhopper-test-key",
		RATE_LIMIT_CONVEX_SECRET: "rate-limit-test-secret",
		RATE_LIMIT_HASH_SECRET: "rate-limit-hash-secret",
	},
}));

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_CONVEX_URL: "https://convex.test",
	},
}));

import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { GET } from "./+server";
import { clearGraphHopperCachesForTests } from "$lib/server/graphhopper";
import {
	getGeocodingTextTooLongMessage,
	maxSuggestionQueryLength,
} from "$lib/server/route-endpoint/constants";
import {
	clearRouteRateLimitsForTests,
	installRouteRateLimiterForTests,
	resetRouteRateLimiterForTests,
} from "$lib/server/route-rate-limits";

let eventId = 0;

function buildEvent(
	url: string,
	fetchMock: typeof fetch,
	clientAddress = `suggest-test-${eventId++}`,
) {
	return {
		url: new URL(url),
		fetch: fetchMock,
		getClientAddress: () => clientAddress,
	} as Parameters<typeof GET>[0];
}

describe("GET /api/route/suggest", () => {
	beforeEach(() => {
		env.GRAPHHOPPER_API_KEY = "graphhopper-test-key";
		env.RATE_LIMIT_CONVEX_SECRET = "rate-limit-test-secret";
		env.RATE_LIMIT_HASH_SECRET = "rate-limit-hash-secret";
		publicEnv.PUBLIC_CONVEX_URL = "https://convex.test";
		resetRouteRateLimiterForTests();
		installRouteRateLimiterForTests();
		clearGraphHopperCachesForTests();
		clearRouteRateLimitsForTests();
	});

	it("returns an empty suggestion list for missing or short queries without calling GraphHopper", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const missingQueryResponse = await GET(
			buildEvent("http://localhost/api/route/suggest", fetchMock),
		);
		const shortQueryResponse = await GET(
			buildEvent("http://localhost/api/route/suggest?q=ab", fetchMock),
		);

		expect(fetchMock).not.toHaveBeenCalled();
		await expect(missingQueryResponse.json()).resolves.toEqual({
			suggestions: [],
		});
		await expect(shortQueryResponse.json()).resolves.toEqual({
			suggestions: [],
		});
	});

	it("rejects oversized text queries before calling GraphHopper", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		const query = "a".repeat(maxSuggestionQueryLength + 1);

		const response = await GET(
			buildEvent(`http://localhost/api/route/suggest?q=${query}`, fetchMock),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: getGeocodingTextTooLongMessage(),
		});
	});

	it("maps GraphHopper hits into route suggestions", async () => {
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
						{
							name: "Marienplatz station",
							city: "Munich",
							country: "Germany",
							point: {
								lat: 48.138,
								lng: 11.576,
							},
						},
					],
				}),
			),
		);

		const response = await GET(
			buildEvent("http://localhost/api/route/suggest?q=marien", fetchMock),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
			"provider=nominatim",
		);
		await expect(response.json()).resolves.toEqual({
			suggestions: [
				{
					label: "Marienplatz, Munich, Germany",
					point: [11.5755, 48.1374],
				},
				{
					label: "Marienplatz station, Munich, Germany",
					point: [11.576, 48.138],
				},
			],
		});
	});

	it("maps a missing GraphHopper API key to the suggestion configuration error", async () => {
		env.GRAPHHOPPER_API_KEY = "";
		const fetchMock = vi.fn<typeof fetch>();

		const response = await GET(
			buildEvent("http://localhost/api/route/suggest?q=berlin", fetchMock),
		);

		expect(response.status).toBe(500);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Suggestions are not configured yet. Add GRAPHHOPPER_API_KEY.",
		});
	});

	it("caches repeated GraphHopper suggestions for the same query and limit", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
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

		const firstResponse = await GET(
			buildEvent("http://localhost/api/route/suggest?q=Berlin", fetchMock),
		);
		const secondResponse = await GET(
			buildEvent(
				"http://localhost/api/route/suggest?q=%20berlin%20",
				fetchMock,
			),
		);

		expect(firstResponse.status).toBe(200);
		expect(secondResponse.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await expect(secondResponse.json()).resolves.toEqual({
			suggestions: [
				{
					label: "Berlin, Germany",
					point: [13.405, 52.52],
				},
			],
		});
	});

	it("rate-limits suggestion requests before calling GraphHopper", async () => {
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
					`http://localhost/api/route/suggest?q=place-${index}`,
					fetchMock,
					"limited-client",
				),
			);
		}

		const response = await GET(
			buildEvent(
				"http://localhost/api/route/suggest?q=place-over-limit",
				fetchMock,
				"limited-client",
			),
		);

		expect(response.status).toBe(429);
		expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(Number(response.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
		expect(fetchMock).toHaveBeenCalledTimes(60);
		await expect(response.json()).resolves.toEqual({
			error: "Too many suggestion requests. Try again soon.",
		});
	});

	it("fails closed when shared suggestion rate limiting is not configured", async () => {
		resetRouteRateLimiterForTests();
		env.RATE_LIMIT_CONVEX_SECRET = "";
		const fetchMock = vi.fn<typeof fetch>();

		const response = await GET(
			buildEvent("http://localhost/api/route/suggest?q=marien", fetchMock),
		);

		expect(response.status).toBe(503);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Rate limiting is temporarily unavailable. Try again soon.",
		});
	});

	it("fails closed when the suggestion client address cannot be read", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		const event = buildEvent(
			"http://localhost/api/route/suggest?q=marien",
			fetchMock,
		);
		event.getClientAddress = () => {
			throw new Error("missing address");
		};

		const response = await GET(event);

		expect(response.status).toBe(503);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			error: "Rate limiting is temporarily unavailable. Try again soon.",
		});
	});

	it("returns one suggestion for valid typed coordinates", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await GET(
			buildEvent(
				"http://localhost/api/route/suggest?q=48.1374%2C%2011.5755",
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			suggestions: [
				{
					label: "48.13740, 11.57550",
					point: [11.5755, 48.1374],
				},
			],
		});
	});

	it("returns no suggestions for invalid coordinate-like input without calling GraphHopper", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await GET(
			buildEvent(
				"http://localhost/api/route/suggest?q=91%2C%2011.5755",
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			suggestions: [],
		});
	});

	it("surfaces upstream suggestion failures as a gateway error", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "rate limited" }), {
					status: 429,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "still rate limited" }), {
					status: 429,
				}),
			);

		const response = await GET(
			buildEvent("http://localhost/api/route/suggest?q=berlin", fetchMock),
		);

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toEqual({
			error: "GraphHopper could not fetch location suggestions right now.",
		});
	});

	it("tries the next GraphHopper provider after a fetch failure", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new DOMException("Timed out", "AbortError"))
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

		try {
			const response = await GET(
				buildEvent("http://localhost/api/route/suggest?q=berlin", fetchMock),
			);

			expect(response.status).toBe(200);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
				"provider=nominatim",
			);
			expect(String(fetchMock.mock.calls[1]?.[0])).toContain("locale=en");
			await expect(response.json()).resolves.toEqual({
				suggestions: [
					{
						label: "Berlin, Germany",
						point: [13.405, 52.52],
					},
				],
			});
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("surfaces timed-out suggestion requests as a gateway error", async () => {
		vi.useFakeTimers();
		try {
			const fetchMock = vi.fn<typeof fetch>().mockImplementation(
				(_input, init) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => {
							reject(
								new DOMException("The operation was aborted.", "AbortError"),
							);
						});
					}),
			);

			const responsePromise = GET(
				buildEvent("http://localhost/api/route/suggest?q=berlin", fetchMock),
			);

			await vi.advanceTimersByTimeAsync(8_000);
			const response = await responsePromise;

			expect(response.status).toBe(502);
			await expect(response.json()).resolves.toEqual({
				error: "GraphHopper could not fetch location suggestions right now.",
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
