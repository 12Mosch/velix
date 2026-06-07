import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { PlannedRoute } from "$lib/route-planning";
import { attachWindAnalysisEffect } from "$lib/server/route-orchestration";
import { TimeoutFetch, type FetchTimeoutError } from "$lib/server/resilience";

type TimeoutFetchFn = (
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	timeoutMs: number,
) => Effect.Effect<Response, FetchTimeoutError>;

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

function runAttachWind(routes: PlannedRoute[], fetchMock: TimeoutFetchFn) {
	return Effect.runPromise(
		attachWindAnalysisEffect(routes).pipe(
			Effect.provideService(TimeoutFetch, {
				fetch: fetchMock,
			}),
		),
	);
}

function buildBatchWindResponse(input: RequestInfo | URL) {
	const url = new URL(input.toString());
	const count = (url.searchParams.get("latitude") ?? "").split(",").length;

	return new Response(
		JSON.stringify(
			Array.from({ length: count }, () => ({
				current: {
					time: "2026-05-10T10:00",
					wind_speed_10m: 20,
					wind_direction_10m: 0,
				},
			})),
		),
	);
}

describe("attachWindAnalysisEffect", () => {
	it("attaches wind analysis and readiness warnings when weather fetches succeed", async () => {
		const fetchMock = vi.fn((input: RequestInfo | URL) =>
			Effect.succeed(buildBatchWindResponse(input)),
		) as TimeoutFetchFn;

		const [route] = await runAttachWind(
			[
				buildRoute([
					[0, 0],
					[0, 0.01],
				]),
			],
			fetchMock,
		);

		expect(route?.windAnalysis?.source).toBe("open_meteo");
		expect(route?.windAnalysis?.segments).toHaveLength(1);
		expect(route?.routingWarnings).toBeUndefined();
		expect(route?.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: "readiness",
					code: "strong_headwind_exposure",
				}),
			]),
		);
	});

	it("batches sample points for multiple route alternatives into one Open-Meteo request", async () => {
		const fetchMock = vi.fn(
			(
				input: RequestInfo | URL,
				_init: RequestInit | undefined,
				_timeoutMs: number,
			) => Effect.succeed(buildBatchWindResponse(input)),
		);
		const routes = [
			buildRoute([
				[0, 0],
				[0, 0.01],
			]),
			buildRoute([
				[1, 1],
				[1.01, 1],
			]),
			buildRoute([
				[2, 2],
				[2.01, 2.01],
			]),
		];

		const routesWithWind = await runAttachWind(routes, fetchMock);

		expect(fetchMock).toHaveBeenCalledTimes(1);

		const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
		expect(url.searchParams.get("latitude")?.split(",")).toHaveLength(15);
		expect(url.searchParams.get("longitude")?.split(",")).toHaveLength(15);

		expect(routesWithWind).toHaveLength(3);
		for (const route of routesWithWind) {
			expect(route.windAnalysis?.source).toBe("open_meteo");
			expect(route.windAnalysis?.samples).toHaveLength(5);
		}
		expect(routesWithWind.map((route) => route.coordinates)).toEqual(
			routes.map((route) => route.coordinates),
		);
	});

	it("keeps the route and appends a structured provider warning when weather fetches fail", async () => {
		const fetchMock = vi.fn(() =>
			Effect.succeed(new Response("unavailable", { status: 503 })),
		) as TimeoutFetchFn;

		const [route] = await runAttachWind(
			[
				buildRoute([
					[0, 0],
					[0, 0.01],
				]),
			],
			fetchMock,
		);

		expect(route?.windAnalysis).toBeUndefined();
		expect(route?.routingWarnings).toBeUndefined();
		expect(route?.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: "routing_provider",
					code: "wind_analysis_unavailable",
					message:
						"Wind data is temporarily unavailable, so wind analysis was skipped.",
				}),
			]),
		);
	});

	it("applies provider wind warning to every sampled route when the shared Open-Meteo request fails", async () => {
		const fetchMock = vi.fn(() =>
			Effect.succeed(new Response("unavailable", { status: 503 })),
		) as TimeoutFetchFn;

		const routes = await runAttachWind(
			[
				buildRoute([
					[0, 0],
					[0, 0.01],
				]),
				buildRoute([
					[1, 1],
					[1.01, 1],
				]),
			],
			fetchMock,
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		for (const route of routes) {
			expect(route.windAnalysis).toBeUndefined();
			expect(route.warnings).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						category: "routing_provider",
						code: "wind_analysis_unavailable",
					}),
				]),
			);
		}
	});

	it("does not apply provider wind warning to unsampled routes when a mixed shared Open-Meteo request fails", async () => {
		const fetchMock = vi.fn(() =>
			Effect.succeed(new Response("unavailable", { status: 503 })),
		) as TimeoutFetchFn;

		const [sampledRoute, unsampledRoute] = await runAttachWind(
			[
				buildRoute([
					[0, 0],
					[0, 0.01],
				]),
				buildRoute([]),
			],
			fetchMock,
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(sampledRoute?.windAnalysis).toBeUndefined();
		expect(sampledRoute?.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: "routing_provider",
					code: "wind_analysis_unavailable",
				}),
			]),
		);

		expect(unsampledRoute?.windAnalysis).toBeUndefined();
		expect(
			unsampledRoute?.warnings?.some(
				(warning) =>
					warning.category === "routing_provider" &&
					warning.code === "wind_analysis_unavailable",
			),
		).toBe(false);
	});

	it("keeps the route without a provider warning when geometry cannot be analyzed", async () => {
		const fetchMock = vi.fn((input: RequestInfo | URL) =>
			Effect.succeed(buildBatchWindResponse(input)),
		) as TimeoutFetchFn;

		const [route] = await runAttachWind([buildRoute([[0, 0]])], fetchMock);

		expect(route?.windAnalysis).toBeUndefined();
		expect(route?.routingWarnings).toBeUndefined();
		expect(
			route?.warnings?.some(
				(warning) => warning.category === "routing_provider",
			),
		).toBe(false);
		expect(route?.warnings?.map((warning) => warning.code)).toEqual(
			expect.arrayContaining([
				"surface_analysis_unavailable",
				"wind_analysis_unavailable",
			]),
		);
	});

	it("skips Open-Meteo when all routes have empty coordinate arrays", async () => {
		const fetchMock = vi.fn((input: RequestInfo | URL) =>
			Effect.succeed(buildBatchWindResponse(input)),
		) as TimeoutFetchFn;

		const routes = await runAttachWind(
			[buildRoute([]), buildRoute([])],
			fetchMock,
		);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(routes).toHaveLength(2);
		for (const route of routes) {
			expect(route.windAnalysis).toBeUndefined();
			expect(
				route.warnings?.some(
					(warning) => warning.category === "routing_provider",
				),
			).toBe(false);
		}
	});

	it("calculates out-and-back wind segments over mirrored geometry", async () => {
		const fetchMock = vi.fn((input: RequestInfo | URL) =>
			Effect.succeed(buildBatchWindResponse(input)),
		) as TimeoutFetchFn;
		const outAndBackRoute: PlannedRoute = {
			...buildRoute([
				[0, 0],
				[0, 0.01],
				[0, 0],
			]),
			mode: "out_and_back",
		};

		const [route] = await runAttachWind([outAndBackRoute], fetchMock);

		expect(route?.windAnalysis?.segments).toHaveLength(2);
		expect(
			route?.windAnalysis?.segments.map((segment) => segment.bucket),
		).toEqual(["headwind", "tailwind"]);
	});
});
