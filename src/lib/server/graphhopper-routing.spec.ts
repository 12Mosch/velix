import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	GraphHopperRouteCacheLive,
	clearGraphHopperCachesForTests,
} from "$lib/server/graphhopper-cache";
import { GraphHopperConfig } from "$lib/server/graphhopper-config";
import { GraphHopperRouteStatusError } from "$lib/server/graphhopper-errors";
import { requestRoutesEffect } from "$lib/server/graphhopper-routing";
import {
	GraphHopperRouteCallSubject,
	GraphHopperRouteRateLimitExceededError,
	RouteRateLimitLive,
	clearRouteRateLimitsForTests,
	installRouteRateLimiterForTests,
	resetRouteRateLimiterForTests,
} from "$lib/server/route-rate-limits";
import { ServerFetch, TimeoutFetchLive } from "$lib/server/resilience";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function buildRouteResponse(offset = 0): Response {
	return new Response(
		JSON.stringify({
			paths: [
				{
					distance: 10_000 + offset,
					time: 1_800_000,
					ascend: 100,
					descend: 100,
					bbox: [11.55, 48.08, 11.69, 48.17],
					points: {
						coordinates: [
							[11.5755, 48.1374, 520],
							[11.6 + offset / 100_000, 48.12, 600],
						],
					},
					snapped_waypoints: {
						coordinates: [
							[11.5755, 48.1374, 520],
							[11.6, 48.12, 600],
						],
					},
					details: {
						surface: [[0, 1, "ASPHALT"]],
						smoothness: [[0, 1, "GOOD"]],
					},
				},
			],
		}),
	);
}

function runRequest(fetchMock: FetchMock, pointOffset = 0) {
	return Effect.runPromise(
		requestRoutesEffect(
			[
				[11.5755, 48.1374],
				[11.6 + pointOffset / 1000, 48.12],
			],
			{
				mode: "point_to_point",
			},
		).pipe(
			Effect.provide(
				Layer.mergeAll(GraphHopperRouteCacheLive, RouteRateLimitLive),
			),
			Effect.provideService(GraphHopperRouteCallSubject, {
				subject: "graphhopper-routing-test",
			}),
			Effect.provide(TimeoutFetchLive),
			Effect.provideService(ServerFetch, { fetch: fetchMock }),
			Effect.provideService(GraphHopperConfig, {
				apiBaseUrl: "https://graphhopper.test/api/1",
				geocodeTimeoutMs: 4000,
				routeTimeoutMs: 20_000,
				apiKey: Effect.succeed("graphhopper-test-key"),
			}),
		),
	);
}

describe("GraphHopper routing POST boundary", () => {
	beforeEach(() => {
		installRouteRateLimiterForTests();
		clearRouteRateLimitsForTests();
		clearGraphHopperCachesForTests();
	});

	afterEach(() => {
		resetRouteRateLimiterForTests();
	});

	it("caches identical successful route POST bodies before consuming another quota slot", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(buildRouteResponse()),
		);

		for (let index = 0; index < 11; index += 1) {
			await expect(runRequest(fetchMock)).resolves.toMatchObject({
				routes: [expect.objectContaining({ distanceMeters: 10_000 })],
			});
		}

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not cache failed GraphHopper status responses", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response("bad profile", { status: 500 })),
		);

		await expect(runRequest(fetchMock)).rejects.toBeInstanceOf(
			GraphHopperRouteStatusError,
		);
		await expect(runRequest(fetchMock)).rejects.toBeInstanceOf(
			GraphHopperRouteStatusError,
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("charges each uncached fallback POST before the next routing strategy", async () => {
		let callNumber = 0;
		const fetchMock = vi.fn<typeof fetch>(() => {
			callNumber += 1;

			if (callNumber % 2 === 1) {
				return Promise.resolve(
					new Response("custom model rejected", { status: 400 }),
				);
			}

			return Promise.resolve(buildRouteResponse(callNumber));
		});

		for (let index = 0; index < 5; index += 1) {
			await expect(runRequest(fetchMock, index)).resolves.toMatchObject({
				routes: [expect.objectContaining({ source: { kind: "graphhopper" } })],
			});
		}

		await expect(runRequest(fetchMock, 99)).rejects.toBeInstanceOf(
			GraphHopperRouteRateLimitExceededError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(10);
	});
});
