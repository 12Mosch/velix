import { Clock, Context, Effect, Layer } from "effect";

type FetchFn = typeof fetch;

type CacheEntry<Value> = {
	expiresAt: number;
	value: Value;
};

export class FetchTimeoutError extends Error {
	readonly _tag = "FetchTimeoutError";

	constructor(readonly cause: unknown) {
		super("Fetch request failed or timed out");
	}
}

export class ServerFetch extends Context.Service<
	ServerFetch,
	{
		readonly fetch: FetchFn;
	}
>()("ServerFetch") {}

export class TimeoutFetch extends Context.Service<
	TimeoutFetch,
	{
		readonly fetch: (
			input: RequestInfo | URL,
			init: RequestInit | undefined,
			timeoutMs: number,
		) => Effect.Effect<Response, FetchTimeoutError>;
	}
>()("TimeoutFetch") {}

export const TimeoutFetchLive = Layer.effect(TimeoutFetch)(
	Effect.gen(function* () {
		const serverFetch = yield* ServerFetch;

		return {
			fetch: (input, init, timeoutMs) =>
				Effect.tryPromise({
					try: async (signal) => {
						const controller = new AbortController();
						const timeout = setTimeout(() => controller.abort(), timeoutMs);
						const abort = () => controller.abort();

						if (signal.aborted) {
							controller.abort();
						} else {
							signal.addEventListener("abort", abort, { once: true });
						}

						try {
							return await serverFetch.fetch(input, {
								...init,
								signal: controller.signal,
							});
						} finally {
							clearTimeout(timeout);
							signal.removeEventListener("abort", abort);
						}
					},
					catch: (cause) => new FetchTimeoutError(cause),
				}),
		};
	}),
);

export function fetchWithTimeoutEffect(
	fetchFn: FetchFn,
	input: Parameters<FetchFn>[0],
	init: Parameters<FetchFn>[1] = {},
	timeoutMs: number,
): Effect.Effect<Response, FetchTimeoutError> {
	return Effect.gen(function* () {
		const timeoutFetch = yield* TimeoutFetch;
		return yield* timeoutFetch.fetch(input, init, timeoutMs);
	}).pipe(
		Effect.provide(TimeoutFetchLive),
		Effect.provideService(ServerFetch, { fetch: fetchFn }),
	);
}

export function fetchWithTimeout(
	fetchFn: FetchFn,
	input: Parameters<FetchFn>[0],
	init: Parameters<FetchFn>[1] = {},
	timeoutMs: number,
): Promise<Response> {
	return Effect.runPromise(
		fetchWithTimeoutEffect(fetchFn, input, init, timeoutMs),
	);
}

export class TtlCache<Value> {
	readonly #entries = new Map<string, CacheEntry<Value>>();

	constructor(
		readonly ttlMs: number,
		readonly maxEntries: number,
	) {}

	getEffect(key: string): Effect.Effect<Value | undefined> {
		return Effect.gen({ self: this }, function* () {
			const entry = this.#entries.get(key);
			const now = yield* Clock.currentTimeMillis;

			if (!entry) {
				return undefined;
			}

			if (entry.expiresAt <= now) {
				this.#entries.delete(key);
				return undefined;
			}

			// Refresh insertion order for live entries so max-size eviction behaves
			// like a small LRU cache.
			this.#entries.delete(key);
			this.#entries.set(key, entry);
			return entry.value;
		});
	}

	get(key: string): Value | undefined {
		return Effect.runSync(this.getEffect(key));
	}

	setEffect(key: string, value: Value): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			const now = yield* Clock.currentTimeMillis;

			if (this.#entries.has(key)) {
				this.#entries.delete(key);
			}

			this.#entries.set(key, {
				expiresAt: now + this.ttlMs,
				value,
			});

			while (this.#entries.size > this.maxEntries) {
				const oldestKey = this.#entries.keys().next().value;

				if (typeof oldestKey !== "string") {
					break;
				}

				this.#entries.delete(oldestKey);
			}
		});
	}

	set(key: string, value: Value): void {
		Effect.runSync(this.setEffect(key, value));
	}

	clearEffect(): Effect.Effect<void> {
		return Effect.sync(() => {
			this.#entries.clear();
		});
	}

	clear(): void {
		Effect.runSync(this.clearEffect());
	}
}

export type TtlCacheService<Value> = {
	readonly get: (key: string) => Effect.Effect<Value | undefined>;
	readonly set: (key: string, value: Value) => Effect.Effect<void>;
	readonly clear: Effect.Effect<void>;
};

export function makeTtlCache<Value>(options: {
	readonly ttlMs: number;
	readonly maxEntries: number;
}): Effect.Effect<TtlCacheService<Value>> {
	return Effect.sync(
		() => new TtlCache<Value>(options.ttlMs, options.maxEntries),
	).pipe(
		Effect.map((cache) => ({
			get: (key: string) => cache.getEffect(key),
			set: (key: string, value: Value) => cache.setEffect(key, value),
			clear: cache.clearEffect(),
		})),
	);
}
