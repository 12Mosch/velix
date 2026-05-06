import { json } from "@sveltejs/kit";
import { Context, Effect, Layer } from "effect";
import type { RequestEvent } from "@sveltejs/kit";

import {
	makeFixedWindowRateLimiter,
	type FixedWindowRateLimiterService,
} from "$lib/server/resilience";

export class RouteRateLimiter extends Context.Service<
	RouteRateLimiter,
	FixedWindowRateLimiterService
>()("RouteRateLimiter") {}

export class SuggestionRateLimiter extends Context.Service<
	SuggestionRateLimiter,
	FixedWindowRateLimiterService
>()("SuggestionRateLimiter") {}

export class ReverseGeocodeRateLimiter extends Context.Service<
	ReverseGeocodeRateLimiter,
	FixedWindowRateLimiterService
>()("ReverseGeocodeRateLimiter") {}

const routeLimiter = Effect.runSync(
	makeFixedWindowRateLimiter({ maxRequests: 10, windowMs: 60_000 }),
);
const suggestionLimiter = Effect.runSync(
	makeFixedWindowRateLimiter({ maxRequests: 60, windowMs: 60_000 }),
);
const reverseLimiter = Effect.runSync(
	makeFixedWindowRateLimiter({ maxRequests: 60, windowMs: 60_000 }),
);

export const RouteRateLimiterLive =
	Layer.succeed(RouteRateLimiter)(routeLimiter);
export const SuggestionRateLimiterLive = Layer.succeed(SuggestionRateLimiter)(
	suggestionLimiter,
);
export const ReverseGeocodeRateLimiterLive = Layer.succeed(
	ReverseGeocodeRateLimiter,
)(reverseLimiter);

export const RouteRateLimitLive = Layer.mergeAll(
	RouteRateLimiterLive,
	SuggestionRateLimiterLive,
	ReverseGeocodeRateLimiterLive,
);

function clientAddressEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<string | null> {
	return Effect.catchDefect(
		Effect.sync(() => event.getClientAddress()),
		() => Effect.succeed(null),
	);
}

function rateLimitResponse(error: string, retryAfterSeconds: number): Response {
	return json(
		{ error },
		{
			status: 429,
			headers: {
				"Retry-After": String(retryAfterSeconds),
			},
		},
	);
}

export function checkRouteRateLimit(
	event: Pick<RequestEvent, "getClientAddress">,
): Response | null {
	return Effect.runSync(
		checkRouteRateLimitEffect(event).pipe(Effect.provide(RouteRateLimitLive)),
	);
}

export function checkRouteRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<Response | null, never, RouteRateLimiter> {
	return Effect.gen(function* () {
		const limiter = yield* RouteRateLimiter;
		return yield* checkRateLimitEffect(
			event,
			limiter,
			"Too many route requests. Try again soon.",
		);
	});
}

export function checkSuggestionRateLimit(
	event: Pick<RequestEvent, "getClientAddress">,
): Response | null {
	return Effect.runSync(
		checkSuggestionRateLimitEffect(event).pipe(
			Effect.provide(RouteRateLimitLive),
		),
	);
}

export function checkSuggestionRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<Response | null, never, SuggestionRateLimiter> {
	return Effect.gen(function* () {
		const limiter = yield* SuggestionRateLimiter;
		return yield* checkRateLimitEffect(
			event,
			limiter,
			"Too many suggestion requests. Try again soon.",
		);
	});
}

export function checkReverseRateLimit(
	event: Pick<RequestEvent, "getClientAddress">,
): Response | null {
	return Effect.runSync(
		checkReverseRateLimitEffect(event).pipe(Effect.provide(RouteRateLimitLive)),
	);
}

export function checkReverseRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<Response | null, never, ReverseGeocodeRateLimiter> {
	return Effect.gen(function* () {
		const limiter = yield* ReverseGeocodeRateLimiter;
		return yield* checkRateLimitEffect(
			event,
			limiter,
			"Too many reverse geocoding requests. Try again soon.",
		);
	});
}

function checkRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
	limiter: FixedWindowRateLimiterService,
	error: string,
): Effect.Effect<Response | null> {
	return Effect.gen(function* () {
		const address = yield* clientAddressEffect(event);

		if (!address) {
			return null;
		}

		const result = yield* limiter.check(address);

		if (result.allowed) {
			return null;
		}

		return rateLimitResponse(error, result.retryAfterSeconds);
	});
}

export function clearRouteRateLimitsForTests(): void {
	Effect.runSync(clearRouteRateLimitsForTestsEffect());
}

export function clearRouteRateLimitsForTestsEffect(): Effect.Effect<void> {
	return Effect.gen(function* () {
		yield* routeLimiter.clear;
		yield* suggestionLimiter.clear;
		yield* reverseLimiter.clear;
	});
}
