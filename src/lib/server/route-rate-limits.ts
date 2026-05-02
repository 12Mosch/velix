import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

import { FixedWindowRateLimiter } from "$lib/server/resilience";

const routeLimiter = new FixedWindowRateLimiter(10, 60_000);
const suggestionLimiter = new FixedWindowRateLimiter(60, 60_000);
const reverseLimiter = new FixedWindowRateLimiter(60, 60_000);

function clientAddress(
	event: Pick<RequestEvent, "getClientAddress">,
): string | null {
	try {
		return event.getClientAddress();
	} catch {
		return null;
	}
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
	const address = clientAddress(event);

	if (!address) {
		return null;
	}

	const result = routeLimiter.check(address);

	if (result.allowed) {
		return null;
	}

	return rateLimitResponse(
		"Too many route requests. Try again soon.",
		result.retryAfterSeconds,
	);
}

export function checkSuggestionRateLimit(
	event: Pick<RequestEvent, "getClientAddress">,
): Response | null {
	const address = clientAddress(event);

	if (!address) {
		return null;
	}

	const result = suggestionLimiter.check(address);

	if (result.allowed) {
		return null;
	}

	return rateLimitResponse(
		"Too many suggestion requests. Try again soon.",
		result.retryAfterSeconds,
	);
}

export function checkReverseRateLimit(
	event: Pick<RequestEvent, "getClientAddress">,
): Response | null {
	const address = clientAddress(event);

	if (!address) {
		return null;
	}

	const result = reverseLimiter.check(address);

	if (result.allowed) {
		return null;
	}

	return rateLimitResponse(
		"Too many reverse geocoding requests. Try again soon.",
		result.retryAfterSeconds,
	);
}

export function clearRouteRateLimitsForTests(): void {
	routeLimiter.clear();
	suggestionLimiter.clear();
	reverseLimiter.clear();
}
