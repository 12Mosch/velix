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

describe("GET /api/route/reverse", () => {
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
});
