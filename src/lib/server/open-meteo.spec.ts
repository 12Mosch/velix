import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
	fetchOpenMeteoWindEffect,
	openMeteoTestExports,
	OpenMeteoWindError,
} from "$lib/server/open-meteo";
import { TimeoutFetch, type FetchTimeoutError } from "$lib/server/resilience";

type TimeoutFetchFn = (
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	timeoutMs: number,
) => Effect.Effect<Response, FetchTimeoutError>;

function runWithFetch(fetchMock: TimeoutFetchFn) {
	return Effect.runPromise(
		fetchOpenMeteoWindEffect([11.5755, 48.1374]).pipe(
			Effect.provideService(TimeoutFetch, {
				fetch: fetchMock,
			}),
		),
	);
}

describe("fetchOpenMeteoWindEffect", () => {
	it("builds the expected Open-Meteo URL", () => {
		const url = new URL(
			openMeteoTestExports.buildOpenMeteoWindUrl([[11.5755, 48.1374]]),
		);

		expect(url.origin + url.pathname).toBe(
			"https://api.open-meteo.com/v1/forecast",
		);
		expect(url.searchParams.get("latitude")).toBe("48.1374");
		expect(url.searchParams.get("longitude")).toBe("11.5755");
		expect(url.searchParams.get("current")).toBe(
			"wind_speed_10m,wind_direction_10m",
		);
		expect(url.searchParams.get("wind_speed_unit")).toBe("kmh");
		expect(url.searchParams.get("timezone")).toBe("UTC");
	});

	it("parses a valid current wind payload", async () => {
		const fetchMock = vi.fn().mockReturnValue(
			Effect.succeed(
				new Response(
					JSON.stringify({
						current: {
							time: "2026-05-10T10:00",
							wind_speed_10m: 17.5,
							wind_direction_10m: 270,
						},
					}),
				),
			),
		);

		await expect(runWithFetch(fetchMock)).resolves.toEqual({
			speedKmh: 17.5,
			directionDegrees: 270,
			forecastTime: "2026-05-10T10:00",
		});
		expect(fetchMock.mock.calls[0]?.[0]).toContain(
			"https://api.open-meteo.com/v1/forecast?",
		);
		expect(fetchMock.mock.calls[0]?.[2]).toBe(
			openMeteoTestExports.openMeteoTimeoutMs,
		);
	});

	it("fails cleanly on non-OK responses", async () => {
		const fetchMock = vi
			.fn()
			.mockReturnValue(Effect.succeed(new Response("nope", { status: 503 })));

		await expect(runWithFetch(fetchMock)).rejects.toBeInstanceOf(
			OpenMeteoWindError,
		);
	});

	it("fails cleanly on malformed payloads", async () => {
		const fetchMock = vi
			.fn()
			.mockReturnValue(
				Effect.succeed(new Response(JSON.stringify({ current: {} }))),
			);

		await expect(runWithFetch(fetchMock)).rejects.toBeInstanceOf(
			OpenMeteoWindError,
		);
	});
});
