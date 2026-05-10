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
	it("attaches wind analysis when weather fetches succeed", async () => {
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
	});

	it("keeps the route and appends a warning when weather fetches fail", async () => {
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
		expect(route?.routingWarnings).toEqual([
			"Wind data is temporarily unavailable, so wind analysis was skipped.",
		]);
	});

	it("keeps the route without a provider warning when geometry cannot be analyzed", async () => {
		const fetchMock = vi.fn((input: RequestInfo | URL) =>
			Effect.succeed(buildBatchWindResponse(input)),
		) as TimeoutFetchFn;

		const [route] = await runAttachWind([buildRoute([[0, 0]])], fetchMock);

		expect(route?.windAnalysis).toBeUndefined();
		expect(route?.routingWarnings).toBeUndefined();
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
