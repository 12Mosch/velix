import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import {
	fetchWithTimeoutEffect,
	FixedWindowRateLimiter,
	TtlCache,
} from "$lib/server/resilience";

describe("fetchWithTimeoutEffect", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("passes an abort signal and aborts it when the timeout expires", async () => {
		vi.useFakeTimers();
		let requestSignal: AbortSignal | undefined;
		const fetchFn = vi.fn(async (_input, init) => {
			requestSignal = init?.signal;

			await new Promise<void>((resolve) => {
				requestSignal?.addEventListener("abort", () => resolve(), {
					once: true,
				});
			});

			return new Response("aborted");
		}) satisfies typeof fetch;

		const responsePromise = Effect.runPromise(
			fetchWithTimeoutEffect(fetchFn, "/slow", undefined, 50),
		);

		await vi.advanceTimersByTimeAsync(50);

		await expect(responsePromise).resolves.toBeInstanceOf(Response);
		expect(fetchFn).toHaveBeenCalledWith(
			"/slow",
			expect.objectContaining({
				signal: expect.any(AbortSignal),
			}),
		);
		expect(requestSignal?.aborted).toBe(true);
	});
});

describe("TtlCache", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("deletes expired entries instead of returning or refreshing them", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const cache = new TtlCache<string>(1_000, 2);

		cache.set("expired", "stale");
		vi.setSystemTime(1_001);

		expect(cache.get("expired")).toBeUndefined();

		cache.set("fresh-a", "a");
		cache.set("fresh-b", "b");
		cache.set("fresh-c", "c");

		expect(cache.get("expired")).toBeUndefined();
		expect(cache.get("fresh-a")).toBeUndefined();
		expect(cache.get("fresh-b")).toBe("b");
		expect(cache.get("fresh-c")).toBe("c");
	});
});

describe("FixedWindowRateLimiter", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("prunes expired buckets when checking a different key", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const limiter = new FixedWindowRateLimiter(1, 1_000);

		expect(limiter.check("first")).toEqual({ allowed: true });
		expect(limiter.check("first")).toEqual({
			allowed: false,
			retryAfterSeconds: 1,
		});

		vi.setSystemTime(1_001);

		expect(limiter.check("second")).toEqual({ allowed: true });
		expect(limiter.check("first")).toEqual({ allowed: true });
	});
});
