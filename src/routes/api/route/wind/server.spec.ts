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

import type {
	PlannedRoute,
	RouteApiError,
	RouteWindApiSuccess,
} from "$lib/route-planning";
import { clearGraphHopperCachesForTests } from "$lib/server/graphhopper";
import { POST } from "./+server";

function buildRoute(coordinates: PlannedRoute["coordinates"]): PlannedRoute {
	return {
		mode: "point_to_point",
		source: { kind: "graphhopper" },
		startLabel: "Start",
		destinationLabel: "Finish",
		waypoints: [],
		bounds: [0, 0, 1, 1],
		distanceMeters: 1000,
		durationMs: 120000,
		ascendMeters: 10,
		descendMeters: 10,
		coordinates,
		surfaceDetails: [],
		smoothnessDetails: [],
	};
}

function buildEvent(body: unknown, fetchMock: typeof fetch) {
	return {
		request: new Request("http://localhost/api/route/wind", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		}),
		fetch: fetchMock,
		getClientAddress: () => "route-wind-test",
	} as Parameters<typeof POST>[0];
}

function buildBatchWindResponse(input: RequestInfo | URL) {
	const url = new URL(input.toString());
	const latitudes = (url.searchParams.get("latitude") ?? "")
		.split(",")
		.filter(Boolean);

	return new Response(
		JSON.stringify(
			latitudes.map((_, index) => ({
				current: {
					time: `2026-05-10T10:0${index}`,
					wind_speed_10m: 20 + index,
					wind_direction_10m: 0,
				},
			})),
		),
	);
}

describe("POST /api/route/wind", () => {
	beforeEach(() => {
		clearGraphHopperCachesForTests();
	});

	it("attaches wind analysis and recomputes wind-dependent analyses", async () => {
		const fetchMock = vi.fn<typeof fetch>((input) =>
			Promise.resolve(buildBatchWindResponse(input)),
		);

		const response = await POST(
			buildEvent(
				{
					route: buildRoute([
						[0, 0],
						[0, 0.01],
					]),
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as RouteWindApiSuccess;
		expect(payload.route.windAnalysis?.source).toBe("open_meteo");
		expect(payload.route.windAnalysis?.samples).toHaveLength(5);
		expect(payload.route.routeQuality?.subscores.windExposure.available).toBe(
			true,
		);
		expect(payload.route.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: "readiness",
					code: "strong_headwind_exposure",
				}),
			]),
		);
	});

	it("returns a usable route with a provider warning when Open-Meteo fails", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response("unavailable", { status: 503 })),
		);

		const response = await POST(
			buildEvent(
				{
					route: buildRoute([
						[0, 0],
						[0, 0.01],
					]),
				},
				fetchMock,
			),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as RouteWindApiSuccess;
		expect(payload.route.windAnalysis).toBeUndefined();
		expect(payload.route.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: "routing_provider",
					code: "wind_analysis_unavailable",
				}),
			]),
		);
	});

	it("rejects invalid wind payloads", async () => {
		const fetchMock = vi.fn<typeof fetch>();

		const response = await POST(buildEvent({ route: "invalid" }, fetchMock));

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		const payload = (await response.json()) as RouteApiError;
		expect(payload.error).toBe("Invalid wind route request payload.");
	});

	it("reuses cached rounded sample forecasts for repeated routes", async () => {
		const fetchMock = vi.fn<typeof fetch>((input) =>
			Promise.resolve(buildBatchWindResponse(input)),
		);
		const route = buildRoute([
			[0, 0],
			[0, 0.01],
		]);

		await POST(buildEvent({ route }, fetchMock));
		await POST(buildEvent({ route }, fetchMock));

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
