import { json } from "@sveltejs/kit";
import { Effect } from "effect";
import type { RequestEvent } from "@sveltejs/kit";

import { FixedWindowRateLimiter } from "$lib/server/resilience";

const routeLimiter = new FixedWindowRateLimiter(10, 60_000);
const suggestionLimiter = new FixedWindowRateLimiter(60, 60_000);
const reverseLimiter = new FixedWindowRateLimiter(60, 60_000);

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
	return Effect.runSync(checkRouteRateLimitEffect(event));
}

export function checkRouteRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<Response | null> {
	return checkRateLimitEffect(
		event,
		routeLimiter,
		"Too many route requests. Try again soon.",
	);
}

export function checkSuggestionRateLimit(
	event: Pick<RequestEvent, "getClientAddress">,
): Response | null {
	return Effect.runSync(checkSuggestionRateLimitEffect(event));
}

export function checkSuggestionRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<Response | null> {
	return checkRateLimitEffect(
		event,
		suggestionLimiter,
		"Too many suggestion requests. Try again soon.",
	);
}

export function checkReverseRateLimit(
	event: Pick<RequestEvent, "getClientAddress">,
): Response | null {
	return Effect.runSync(checkReverseRateLimitEffect(event));
}

export function checkReverseRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<Response | null> {
	return checkRateLimitEffect(
		event,
		reverseLimiter,
		"Too many reverse geocoding requests. Try again soon.",
	);
}

function checkRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
	limiter: FixedWindowRateLimiter,
	error: string,
): Effect.Effect<Response | null> {
	return Effect.gen(function* () {
		const address = yield* clientAddressEffect(event);

		if (!address) {
			return null;
		}

		const result = yield* limiter.checkEffect(address);

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
		yield* routeLimiter.clearEffect();
		yield* suggestionLimiter.clearEffect();
		yield* reverseLimiter.clearEffect();
	});
}
