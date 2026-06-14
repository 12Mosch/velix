import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoundCourseTarget } from "$lib/route-planning";
import {
	GraphHopperRouteCacheLive,
	clearGraphHopperCachesForTests,
} from "$lib/server/graphhopper-cache";
import { GraphHopperConfig } from "$lib/server/graphhopper-config";
import {
	GraphHopperRouteCallSubject,
	RouteRateLimitLive,
	clearRouteRateLimitsForTests,
	installRouteRateLimiterForTests,
	resetRouteRateLimiterForTests,
} from "$lib/server/route-rate-limits";
import { ServerFetch, TimeoutFetchLive } from "$lib/server/resilience";

import { searchRoundCourseCandidateRoutesEffect } from "./round-course-candidates";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

type DeferredResponse = {
	resolve: (response: Response) => void;
};

function buildRoundCourseResponse(
	offset: number,
	options: {
		distance?: number;
		time?: number;
		ascend?: number;
	} = {},
): Response {
	return new Response(
		JSON.stringify({
			paths: [
				{
					distance: options.distance ?? 50_000 + offset * 1000,
					time: options.time ?? 7_200_000 + offset * 60_000,
					ascend: options.ascend ?? 500 + offset * 25,
					descend: options.ascend ?? 500 + offset * 25,
					bbox: [11.55, 48.08, 11.69, 48.17],
					points: {
						coordinates: [
							[11.5755, 48.1374, 520],
							[11.6 + offset / 1000, 48.12, 600],
							[11.5755, 48.1374, 520],
						],
					},
					snapped_waypoints: {
						coordinates: [[11.5755, 48.1374, 520]],
					},
					details: {
						surface: [[0, 2, "ASPHALT"]],
						smoothness: [[0, 2, "GOOD"]],
					},
				},
			],
		}),
	);
}

function runSearch(
	target: RoundCourseTarget,
	fetchMock: FetchMock,
	desiredCount = 3,
) {
	return Effect.runPromise(
		searchRoundCourseCandidateRoutesEffect(
			[11.5755, 48.1374],
			target,
			undefined,
			undefined,
			desiredCount,
		).pipe(
			Effect.provide(
				Layer.mergeAll(GraphHopperRouteCacheLive, RouteRateLimitLive),
			),
			Effect.provideService(GraphHopperRouteCallSubject, {
				subject: "round-course-candidate-test",
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

function waitFor(assertion: () => boolean): Promise<void> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		const poll = () => {
			if (assertion()) {
				resolve();
				return;
			}

			if (Date.now() - startedAt > 1000) {
				reject(new Error("Timed out waiting for assertion"));
				return;
			}

			setTimeout(poll, 0);
		};

		poll();
	});
}

function getRequestBodies(
	fetchMock: FetchMock,
): Array<Record<string, unknown>> {
	return fetchMock.mock.calls.map((call) =>
		JSON.parse(String(call[1]?.body)),
	) as Array<Record<string, unknown>>;
}

describe("searchRoundCourseCandidateRoutesEffect", () => {
	beforeEach(() => {
		installRouteRateLimiterForTests();
		clearRouteRateLimitsForTests();
		clearGraphHopperCachesForTests();
	});

	afterEach(() => {
		resetRouteRateLimiterForTests();
	});

	it("caps concurrent GraphHopper route calls", async () => {
		let activeRequests = 0;
		let maxActiveRequests = 0;
		let responseOffset = 0;
		const deferredResponses: DeferredResponse[] = [];
		const fetchMock = vi.fn<typeof fetch>((_input, _init) => {
			activeRequests += 1;
			maxActiveRequests = Math.max(maxActiveRequests, activeRequests);

			return new Promise<Response>((resolve) => {
				deferredResponses.push({
					resolve: (response) => {
						activeRequests -= 1;
						resolve(response);
					},
				});
			});
		});

		const searchPromise = runSearch(
			{
				kind: "distance",
				distanceMeters: 50_000,
			},
			fetchMock,
		);

		await waitFor(() => deferredResponses.length === 2);
		expect(activeRequests).toBe(2);
		expect(maxActiveRequests).toBe(2);

		while (deferredResponses.length > 0 || fetchMock.mock.calls.length < 6) {
			const pending = deferredResponses.splice(0);
			for (const deferred of pending) {
				responseOffset += 1;
				deferred.resolve(buildRoundCourseResponse(responseOffset));
			}

			if (fetchMock.mock.calls.length < 6) {
				await waitFor(() => deferredResponses.length > 0);
			}
		}

		const result = await searchPromise;
		expect(result.routes).toHaveLength(3);
		expect(maxActiveRequests).toBe(2);
	});

	it("stops scheduling within a round after enough viable candidates", async () => {
		let responseOffset = 0;
		const fetchMock = vi.fn<typeof fetch>(() => {
			responseOffset += 1;
			return Promise.resolve(buildRoundCourseResponse(responseOffset));
		});

		const result = await runSearch(
			{
				kind: "distance",
				distanceMeters: 50_000,
			},
			fetchMock,
			1,
		);

		const requestBodies = getRequestBodies(fetchMock);

		expect(result.routes).toHaveLength(1);
		expect(requestBodies.map((body) => body["round_trip.seed"])).toEqual([
			11, 37, 109, 149,
		]);
		expect(requestBodies.some((body) => body["round_trip.seed"] === 73)).toBe(
			false,
		);
	});
});
