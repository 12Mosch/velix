import { Effect } from "effect";

type FetchFn = typeof fetch;

type CacheEntry<Value> = {
	expiresAt: number;
	value: Value;
};

type RateLimitEntry = {
	count: number;
	resetAt: number;
};

export type RateLimitResult =
	| {
			allowed: true;
	  }
	| {
			allowed: false;
			retryAfterSeconds: number;
	  };

export function fetchWithTimeoutEffect(
	fetchFn: FetchFn,
	input: Parameters<FetchFn>[0],
	init: Parameters<FetchFn>[1] = {},
	timeoutMs: number,
): Effect.Effect<Response, unknown> {
	return Effect.tryPromise({
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
				return await fetchFn(input, {
					...init,
					signal: controller.signal,
				});
			} finally {
				clearTimeout(timeout);
				signal.removeEventListener("abort", abort);
			}
		},
		catch: (cause) => cause,
	});
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
		return Effect.sync(() => {
			const entry = this.#entries.get(key);
			const now = Date.now();

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
		return Effect.sync(() => {
			if (this.#entries.has(key)) {
				this.#entries.delete(key);
			}

			this.#entries.set(key, {
				expiresAt: Date.now() + this.ttlMs,
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

export class FixedWindowRateLimiter {
	readonly #entries = new Map<string, RateLimitEntry>();

	constructor(
		readonly maxRequests: number,
		readonly windowMs: number,
	) {}

	#pruneExpired(now: number): void {
		for (const [key, entry] of this.#entries) {
			if (entry.resetAt <= now) {
				this.#entries.delete(key);
			}
		}
	}

	checkEffect(key: string): Effect.Effect<RateLimitResult> {
		return Effect.sync(() => {
			const now = Date.now();
			this.#pruneExpired(now);
			const entry = this.#entries.get(key);

			if (!entry) {
				this.#entries.set(key, {
					count: 1,
					resetAt: now + this.windowMs,
				});
				return { allowed: true };
			}

			if (entry.count >= this.maxRequests) {
				return {
					allowed: false,
					retryAfterSeconds: Math.max(
						1,
						Math.ceil((entry.resetAt - now) / 1000),
					),
				};
			}

			entry.count += 1;
			return { allowed: true };
		});
	}

	check(key: string): RateLimitResult {
		return Effect.runSync(this.checkEffect(key));
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
