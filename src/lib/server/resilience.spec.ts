import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Fiber } from "effect";

import {
	ServerFetch,
	TimeoutFetch,
	TimeoutFetchLive,
	fetchWithTimeoutEffect,
	makeFixedWindowRateLimiter,
	makeTtlCache,
} from "$lib/server/resilience";

function timeoutFetchProgram(
	fetchFn: typeof fetch,
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	timeoutMs: number,
) {
	return Effect.gen(function* () {
		const timeoutFetch = yield* TimeoutFetch;
		return yield* timeoutFetch.fetch(input, init, timeoutMs);
	}).pipe(
		Effect.provide(TimeoutFetchLive),
		Effect.provideService(ServerFetch, { fetch: fetchFn }),
	);
}

describe("TimeoutFetchLive", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("passes an abort signal", async () => {
		const fetchFn = vi.fn(async (_input, init) => {
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			return new Response("ok");
		}) satisfies typeof fetch;

		await expect(
			Effect.runPromise(timeoutFetchProgram(fetchFn, "/fast", undefined, 50)),
		).resolves.toBeInstanceOf(Response);
		expect(fetchFn).toHaveBeenCalledWith(
			"/fast",
			expect.objectContaining({
				signal: expect.any(AbortSignal),
			}),
		);
	});

	it("aborts the request signal when the timeout expires", async () => {
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
			timeoutFetchProgram(fetchFn, "/slow", undefined, 50),
		);

		await vi.advanceTimersByTimeAsync(50);

		await expect(responsePromise).resolves.toBeInstanceOf(Response);
		expect(requestSignal?.aborted).toBe(true);
	});

	it("aborts the request signal when interrupted", async () => {
		vi.useFakeTimers();
		let requestSignal: AbortSignal | undefined;
		let fetchStarted: (() => void) | undefined;
		const fetchStartedPromise = new Promise<void>((resolve) => {
			fetchStarted = resolve;
		});
		const fetchFn = vi.fn(async (_input, init) => {
			requestSignal = init?.signal;
			fetchStarted?.();

			await new Promise<void>(() => {});
			return new Response("unreachable");
		}) satisfies typeof fetch;

		const fiber = Effect.runFork(
			timeoutFetchProgram(fetchFn, "/interrupt", undefined, 1_000),
		);

		await fetchStartedPromise;
		await Effect.runPromise(Fiber.interrupt(fiber));

		expect(requestSignal?.aborted).toBe(true);
	});

	it("cleans up timeout and abort listeners", async () => {
		vi.useFakeTimers();
		const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
		const addEventListenerSpy = vi.spyOn(
			AbortSignal.prototype,
			"addEventListener",
		);
		const removeEventListenerSpy = vi.spyOn(
			AbortSignal.prototype,
			"removeEventListener",
		);
		const fetchFn = vi.fn(
			async () => new Response("ok"),
		) satisfies typeof fetch;

		await Effect.runPromise(
			timeoutFetchProgram(fetchFn, "/cleanup", undefined, 50),
		);

		expect(clearTimeoutSpy).toHaveBeenCalled();
		expect(addEventListenerSpy).toHaveBeenCalledWith(
			"abort",
			expect.any(Function),
			{ once: true },
		);
		expect(removeEventListenerSpy).toHaveBeenCalledWith(
			"abort",
			expect.any(Function),
		);
	});
});

describe("fetchWithTimeoutEffect", () => {
	it("provides the timeout fetch compatibility wrapper", async () => {
		const fetchFn = vi.fn(
			async () => new Response("ok"),
		) satisfies typeof fetch;

		await expect(
			Effect.runPromise(
				fetchWithTimeoutEffect(fetchFn, "/compat", undefined, 50),
			),
		).resolves.toBeInstanceOf(Response);
	});
});

describe("makeTtlCache", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns live entries", async () => {
		const cache = await Effect.runPromise(
			makeTtlCache<string>({ ttlMs: 1_000, maxEntries: 2 }),
		);

		await Effect.runPromise(cache.set("a", "value"));

		await expect(Effect.runPromise(cache.get("a"))).resolves.toBe("value");
	});

	it("removes expired entries", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const cache = await Effect.runPromise(
			makeTtlCache<string>({ ttlMs: 1_000, maxEntries: 2 }),
		);

		await Effect.runPromise(cache.set("expired", "stale"));
		vi.setSystemTime(1_001);

		await expect(
			Effect.runPromise(cache.get("expired")),
		).resolves.toBeUndefined();
	});

	it("refreshes insertion order on get", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const cache = await Effect.runPromise(
			makeTtlCache<string>({ ttlMs: 1_000, maxEntries: 2 }),
		);

		await Effect.runPromise(cache.set("a", "a"));
		await Effect.runPromise(cache.set("b", "b"));
		await Effect.runPromise(cache.get("a"));
		await Effect.runPromise(cache.set("c", "c"));

		await expect(Effect.runPromise(cache.get("a"))).resolves.toBe("a");
		await expect(Effect.runPromise(cache.get("b"))).resolves.toBeUndefined();
		await expect(Effect.runPromise(cache.get("c"))).resolves.toBe("c");
	});

	it("evicts the oldest live entry past max size", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const cache = await Effect.runPromise(
			makeTtlCache<string>({ ttlMs: 1_000, maxEntries: 2 }),
		);

		await Effect.runPromise(cache.set("a", "a"));
		await Effect.runPromise(cache.set("b", "b"));
		await Effect.runPromise(cache.set("c", "c"));

		await expect(Effect.runPromise(cache.get("a"))).resolves.toBeUndefined();
		await expect(Effect.runPromise(cache.get("b"))).resolves.toBe("b");
		await expect(Effect.runPromise(cache.get("c"))).resolves.toBe("c");
	});

	it("clears all entries", async () => {
		const cache = await Effect.runPromise(
			makeTtlCache<string>({ ttlMs: 1_000, maxEntries: 2 }),
		);

		await Effect.runPromise(cache.set("a", "a"));
		await Effect.runPromise(cache.clear);

		await expect(Effect.runPromise(cache.get("a"))).resolves.toBeUndefined();
	});
});

describe("makeFixedWindowRateLimiter", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows requests within the window", async () => {
		const limiter = await Effect.runPromise(
			makeFixedWindowRateLimiter({ maxRequests: 2, windowMs: 1_000 }),
		);

		await expect(Effect.runPromise(limiter.check("client"))).resolves.toEqual({
			allowed: true,
		});
		await expect(Effect.runPromise(limiter.check("client"))).resolves.toEqual({
			allowed: true,
		});
	});

	it("rejects after max requests", async () => {
		const limiter = await Effect.runPromise(
			makeFixedWindowRateLimiter({ maxRequests: 1, windowMs: 1_000 }),
		);

		await Effect.runPromise(limiter.check("client"));

		await expect(Effect.runPromise(limiter.check("client"))).resolves.toEqual({
			allowed: false,
			retryAfterSeconds: 1,
		});
	});

	it("reports retry-after seconds", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const limiter = await Effect.runPromise(
			makeFixedWindowRateLimiter({ maxRequests: 1, windowMs: 2_500 }),
		);

		await Effect.runPromise(limiter.check("client"));
		vi.setSystemTime(1_001);

		await expect(Effect.runPromise(limiter.check("client"))).resolves.toEqual({
			allowed: false,
			retryAfterSeconds: 2,
		});
	});

	it("prunes expired buckets when checking another key", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const limiter = await Effect.runPromise(
			makeFixedWindowRateLimiter({ maxRequests: 1, windowMs: 1_000 }),
		);

		await expect(Effect.runPromise(limiter.check("first"))).resolves.toEqual({
			allowed: true,
		});
		await expect(Effect.runPromise(limiter.check("first"))).resolves.toEqual({
			allowed: false,
			retryAfterSeconds: 1,
		});

		vi.setSystemTime(1_001);

		await expect(Effect.runPromise(limiter.check("second"))).resolves.toEqual({
			allowed: true,
		});
		await expect(Effect.runPromise(limiter.check("first"))).resolves.toEqual({
			allowed: true,
		});
	});

	it("clears state", async () => {
		const limiter = await Effect.runPromise(
			makeFixedWindowRateLimiter({ maxRequests: 1, windowMs: 1_000 }),
		);

		await Effect.runPromise(limiter.check("client"));
		await Effect.runPromise(limiter.clear);

		await expect(Effect.runPromise(limiter.check("client"))).resolves.toEqual({
			allowed: true,
		});
	});
});
