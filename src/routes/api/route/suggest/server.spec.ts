import { describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({
	env: {
		GRAPHHOPPER_API_KEY: "graphhopper-test-key",
	},
}));

import { GET } from "./+server";

function buildEvent(url: string, fetchMock: typeof fetch) {
	return {
		url: new URL(url),
		fetch: fetchMock,
	} as Parameters<typeof GET>[0];
}

describe("GET /api/route/suggest", () => {
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
});
