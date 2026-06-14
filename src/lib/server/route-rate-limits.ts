import { createHmac } from "node:crypto";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { json } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { Clock, Context, Effect, Layer } from "effect";
import type { RequestEvent } from "@sveltejs/kit";

import { api } from "../../convex/_generated/api";

type PaidUpstreamRateLimitBucket =
	| "route"
	| "suggestion"
	| "reverse"
	| "graphhopper_route";

type PaidUpstreamRateLimitResult =
	| {
			allowed: true;
	  }
	| {
			allowed: false;
			retryAfterSeconds: number;
	  };

type PaidUpstreamRateLimiterService = {
	readonly check: (
		bucket: PaidUpstreamRateLimitBucket,
		subject: string,
	) => Effect.Effect<
		PaidUpstreamRateLimitResult,
		PaidUpstreamRateLimitUnavailableError
	>;
	readonly clear: Effect.Effect<void>;
};

class PaidUpstreamRateLimitUnavailableError extends Error {
	readonly _tag = "PaidUpstreamRateLimitUnavailableError";

	constructor(message = "Paid upstream rate limiting is unavailable.") {
		super(message);
	}
}

export class GraphHopperRouteRateLimitUnavailableError extends Error {
	readonly _tag = "GraphHopperRouteRateLimitUnavailableError";

	constructor(message = "Paid route-call rate limiting is unavailable.") {
		super(message);
	}
}

export class GraphHopperRouteRateLimitExceededError extends Error {
	readonly _tag = "GraphHopperRouteRateLimitExceededError";

	constructor(readonly retryAfterSeconds: number) {
		super("Too many GraphHopper route requests. Try again soon.");
	}
}

export class PaidUpstreamRateLimiter extends Context.Service<
	PaidUpstreamRateLimiter,
	PaidUpstreamRateLimiterService
>()("PaidUpstreamRateLimiter") {}

export class GraphHopperRouteCallSubject extends Context.Service<
	GraphHopperRouteCallSubject,
	{
		readonly subject: string;
	}
>()("GraphHopperRouteCallSubject") {}

const routeLimits: Record<
	PaidUpstreamRateLimitBucket,
	{ maxRequests: number; windowMs: number }
> = {
	route: { maxRequests: 10, windowMs: 60_000 },
	suggestion: { maxRequests: 60, windowMs: 60_000 },
	reverse: { maxRequests: 60, windowMs: 60_000 },
	graphhopper_route: { maxRequests: 10, windowMs: 60_000 },
};

const convexCheckTimeoutMs = 2_000;

let testRateLimiter: PaidUpstreamRateLimiterService | null = null;

function getConvexUrl(): string | null {
	const url = publicEnv.PUBLIC_CONVEX_URL?.trim();
	return url ? url : null;
}

function getConvexSecret(): string | null {
	const secret = privateEnv.RATE_LIMIT_CONVEX_SECRET?.trim();
	return secret ? secret : null;
}

function getHashSecret(): string | null {
	const hashSecret = privateEnv.RATE_LIMIT_HASH_SECRET?.trim();

	if (hashSecret) {
		return hashSecret;
	}

	const graphHopperApiKey = privateEnv.GRAPHHOPPER_API_KEY?.trim();
	return graphHopperApiKey ? graphHopperApiKey : null;
}

function hashSubject(subject: string): string {
	const secret = getHashSecret();

	if (!secret) {
		throw new PaidUpstreamRateLimitUnavailableError(
			"Rate limit hash secret is missing.",
		);
	}

	return createHmac("sha256", secret).update(subject).digest("hex");
}

function withTimeout<A>(promise: Promise<A>, timeoutMs: number): Promise<A> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() =>
				reject(
					new PaidUpstreamRateLimitUnavailableError(
						"Convex rate limit check timed out.",
					),
				),
			timeoutMs,
		);

		promise.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(error) => {
				clearTimeout(timeout);
				reject(error);
			},
		);
	});
}

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

function rateLimitUnavailableResponse(): Response {
	return json(
		{
			error: "Rate limiting is temporarily unavailable. Try again soon.",
		},
		{ status: 503 },
	);
}

export function graphHopperRouteRateLimitUnavailableResponse(): Response {
	return rateLimitUnavailableResponse();
}

export function graphHopperRouteRateLimitResponse(
	retryAfterSeconds: number,
): Response {
	return rateLimitResponse(
		"Too many GraphHopper route requests. Try again soon.",
		retryAfterSeconds,
	);
}

const PaidUpstreamRateLimiterLive = Layer.succeed(PaidUpstreamRateLimiter)({
	check: (bucket, subject) =>
		Effect.tryPromise({
			try: async () => {
				if (testRateLimiter) {
					return await Effect.runPromise(
						testRateLimiter.check(bucket, subject),
					);
				}

				const convexUrl = getConvexUrl();
				const secret = getConvexSecret();

				if (!convexUrl || !secret) {
					throw new PaidUpstreamRateLimitUnavailableError(
						"Convex rate limit configuration is missing.",
					);
				}

				const client = new ConvexHttpClient(convexUrl, {
					logger: false,
				});

				return await withTimeout(
					client.mutation(api.paidUpstreamRateLimits.check, {
						bucket,
						subjectHash: hashSubject(subject),
						secret,
					}),
					convexCheckTimeoutMs,
				);
			},
			catch: (cause) =>
				cause instanceof PaidUpstreamRateLimitUnavailableError
					? cause
					: new PaidUpstreamRateLimitUnavailableError(),
		}),
	clear: Effect.sync(() => undefined),
});

export const RouteRateLimitLive = PaidUpstreamRateLimiterLive;

export function checkRouteRateLimit(
	event: Pick<RequestEvent, "getClientAddress">,
): Promise<Response | null> {
	return Effect.runPromise(
		checkRouteRateLimitEffect(event).pipe(Effect.provide(RouteRateLimitLive)),
	);
}

export function checkRouteRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<Response | null, never, PaidUpstreamRateLimiter> {
	return checkRateLimitEffect(
		event,
		"route",
		"Too many route requests. Try again soon.",
	);
}

export function getGraphHopperRouteCallSubjectEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<string, GraphHopperRouteRateLimitUnavailableError> {
	return Effect.gen(function* () {
		const address = yield* clientAddressEffect(event);

		if (!address) {
			return yield* Effect.fail(
				new GraphHopperRouteRateLimitUnavailableError(
					"Client address is unavailable.",
				),
			);
		}

		return address;
	});
}

export function chargeGraphHopperRouteCallEffect(): Effect.Effect<
	void,
	| GraphHopperRouteRateLimitUnavailableError
	| GraphHopperRouteRateLimitExceededError,
	PaidUpstreamRateLimiter | GraphHopperRouteCallSubject
> {
	return Effect.gen(function* () {
		const limiter = yield* PaidUpstreamRateLimiter;
		const { subject } = yield* GraphHopperRouteCallSubject;
		const result = yield* limiter
			.check("graphhopper_route", subject)
			.pipe(
				Effect.mapError(
					(error) =>
						new GraphHopperRouteRateLimitUnavailableError(error.message),
				),
			);

		if (!result.allowed) {
			return yield* Effect.fail(
				new GraphHopperRouteRateLimitExceededError(result.retryAfterSeconds),
			);
		}
	});
}

export function checkSuggestionRateLimit(
	event: Pick<RequestEvent, "getClientAddress">,
): Promise<Response | null> {
	return Effect.runPromise(
		checkSuggestionRateLimitEffect(event).pipe(
			Effect.provide(RouteRateLimitLive),
		),
	);
}

export function checkSuggestionRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<Response | null, never, PaidUpstreamRateLimiter> {
	return checkRateLimitEffect(
		event,
		"suggestion",
		"Too many suggestion requests. Try again soon.",
	);
}

export function checkReverseRateLimit(
	event: Pick<RequestEvent, "getClientAddress">,
): Promise<Response | null> {
	return Effect.runPromise(
		checkReverseRateLimitEffect(event).pipe(Effect.provide(RouteRateLimitLive)),
	);
}

export function checkReverseRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
): Effect.Effect<Response | null, never, PaidUpstreamRateLimiter> {
	return checkRateLimitEffect(
		event,
		"reverse",
		"Too many reverse geocoding requests. Try again soon.",
	);
}

function checkRateLimitEffect(
	event: Pick<RequestEvent, "getClientAddress">,
	bucket: PaidUpstreamRateLimitBucket,
	error: string,
): Effect.Effect<Response | null, never, PaidUpstreamRateLimiter> {
	return Effect.gen(function* () {
		const address = yield* clientAddressEffect(event);

		if (!address) {
			return rateLimitUnavailableResponse();
		}

		const limiter = yield* PaidUpstreamRateLimiter;
		const result = yield* limiter
			.check(bucket, address)
			.pipe(Effect.catch(() => Effect.succeed(null)));

		if (!result) {
			return rateLimitUnavailableResponse();
		}

		if (result.allowed) {
			return null;
		}

		return rateLimitResponse(error, result.retryAfterSeconds);
	});
}

function createTestRateLimiter(): PaidUpstreamRateLimiterService {
	const entries = new Map<
		string,
		{
			count: number;
			resetAtMs: number;
		}
	>();

	return {
		check: (bucket, subject) =>
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis;
				const limit = routeLimits[bucket];
				const key = `${bucket}:${subject}`;
				const entry = entries.get(key);

				if (!entry || entry.resetAtMs <= now) {
					entries.set(key, {
						count: 1,
						resetAtMs: now + limit.windowMs,
					});
					return { allowed: true };
				}

				if (entry.count >= limit.maxRequests) {
					return {
						allowed: false,
						retryAfterSeconds: Math.max(
							1,
							Math.ceil((entry.resetAtMs - now) / 1000),
						),
					};
				}

				entry.count += 1;
				return { allowed: true };
			}),
		clear: Effect.sync(() => {
			entries.clear();
		}),
	};
}

export function installRouteRateLimiterForTests(): void {
	testRateLimiter = createTestRateLimiter();
}

export function clearRouteRateLimitsForTests(): void {
	Effect.runSync(clearRouteRateLimitsForTestsEffect());
}

export function clearRouteRateLimitsForTestsEffect(): Effect.Effect<void> {
	return Effect.gen(function* () {
		if (testRateLimiter) {
			yield* testRateLimiter.clear;
		}
	});
}

export function resetRouteRateLimiterForTests(): void {
	testRateLimiter = null;
}
