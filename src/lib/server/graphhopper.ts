import { Effect, Result } from "effect";

import type { RouteSuggestion } from "$lib/route-planning";
import {
	runServerEffect,
	readResponseTextEffect,
} from "$lib/server/effect-runtime";
import {
	GraphHopperGeocodeFetchError,
	GraphHopperGeocodePayloadError,
	GraphHopperGeocodeStatusError,
	type GraphHopperGeocodeError,
} from "$lib/server/graphhopper-errors";
import { GraphHopperConfig } from "$lib/server/graphhopper-config";
import {
	GraphHopperReverseGeocodeCache,
	GraphHopperSuggestionCache,
	clearGraphHopperCachesForTests,
} from "$lib/server/graphhopper-cache";
import { GraphHopperLive } from "$lib/server/layers";
import { ServerFetch, TimeoutFetch } from "$lib/server/resilience";

export { clearGraphHopperCachesForTests };

type GeocodeProvider = "default" | "nominatim";

type GeocodeHit = {
	name?: string;
	street?: string;
	housenumber?: string;
	city?: string;
	state?: string;
	country?: string;
	point?: {
		lat?: number;
		lng?: number;
	};
};

type GraphHopperGeocodeResponse = {
	hits?: GeocodeHit[];
};

function fetchGraphHopperGeocodeEffect(
	url: string,
	timeoutMs: number,
	operation: "geocoding" | "reverse geocoding",
	provider: GeocodeProvider,
): Effect.Effect<Response, GraphHopperGeocodeFetchError, TimeoutFetch> {
	return Effect.gen(function* () {
		const timeoutFetch = yield* TimeoutFetch;

		return yield* Effect.mapError(
			timeoutFetch.fetch(url, undefined, timeoutMs),
			(cause) => new GraphHopperGeocodeFetchError(operation, provider, cause),
		);
	});
}

function readGraphHopperGeocodePayloadEffect(
	response: Response,
): Effect.Effect<GraphHopperGeocodeResponse, GraphHopperGeocodePayloadError> {
	return Effect.tryPromise({
		try: () => response.json() as Promise<GraphHopperGeocodeResponse>,
		catch: (cause) => new GraphHopperGeocodePayloadError(cause),
	});
}

function buildResolvedLabel(hit: GeocodeHit): string {
	const primary = [
		hit.name,
		[hit.street, hit.housenumber].filter(Boolean).join(" ").trim(),
	]
		.map((part) => part?.trim())
		.filter(Boolean);
	const secondary = [hit.city, hit.state, hit.country]
		.map((part) => part?.trim())
		.filter(Boolean);

	return [...new Set([...primary, ...secondary])].join(", ");
}

function toSuggestion(
	hit: GeocodeHit,
	fallbackLabel: string,
): RouteSuggestion | null {
	const lat = hit.point?.lat;
	const lng = hit.point?.lng;

	if (
		typeof lat !== "number" ||
		!Number.isFinite(lat) ||
		typeof lng !== "number" ||
		!Number.isFinite(lng)
	) {
		return null;
	}

	return {
		label: buildResolvedLabel(hit) || fallbackLabel,
		point: [lng, lat],
	};
}

function dedupeSuggestions(suggestions: RouteSuggestion[]): RouteSuggestion[] {
	const seen = new Set<string>();

	return suggestions.filter((suggestion) => {
		const key = `${suggestion.label}::${suggestion.point[0]}::${suggestion.point[1]}`;

		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
}

export function suggestLocationsEffect(
	query: string,
	limit = 5,
): Effect.Effect<
	RouteSuggestion[],
	GraphHopperGeocodeError,
	GraphHopperConfig | TimeoutFetch | GraphHopperSuggestionCache
> {
	return Effect.gen(function* () {
		const config = yield* GraphHopperConfig;
		const suggestionCache = yield* GraphHopperSuggestionCache;
		const key = yield* config.apiKey;

		const cacheKey = `${query.trim().toLowerCase()}::${limit}`;
		const cachedSuggestions = yield* suggestionCache.get(cacheKey);

		if (cachedSuggestions) {
			return cachedSuggestions;
		}

		const providers: GeocodeProvider[] = ["nominatim", "default"];
		let lastError: GraphHopperGeocodeError | null = null;

		for (const provider of providers) {
			const searchParams = new URLSearchParams({
				q: query,
				limit: String(limit),
				key,
			});

			if (provider === "nominatim") {
				searchParams.set("provider", provider);
			} else {
				searchParams.set("locale", "en");
			}

			const responseResult = yield* Effect.result(
				fetchGraphHopperGeocodeEffect(
					`${config.apiBaseUrl}/geocode?${searchParams.toString()}`,
					config.geocodeTimeoutMs,
					"geocoding",
					provider,
				),
			);

			if (Result.isFailure(responseResult)) {
				lastError = responseResult.failure;
				console.warn(
					`GraphHopper geocoding request failed using ${provider}. Trying the next provider.`,
					responseResult.failure.cause,
				);
				continue;
			}

			const response = responseResult.success;

			if (!response.ok) {
				const details = yield* readResponseTextEffect(response);
				lastError = new GraphHopperGeocodeStatusError(
					"Geocoding",
					provider,
					response.status,
					details,
				);
				continue;
			}

			const payload = yield* readGraphHopperGeocodePayloadEffect(response);
			const suggestions = dedupeSuggestions(
				(payload.hits ?? [])
					.map((hit) => toSuggestion(hit, query))
					.filter((suggestion): suggestion is RouteSuggestion => !!suggestion),
			).slice(0, limit);

			if (suggestions.length > 0) {
				yield* suggestionCache.set(cacheKey, suggestions);
				return suggestions;
			}
		}

		if (lastError) {
			return yield* Effect.fail(lastError);
		}

		yield* suggestionCache.set(cacheKey, []);
		return [];
	});
}

export async function suggestLocations(
	fetchFn: typeof fetch,
	query: string,
	limit = 5,
): Promise<RouteSuggestion[]> {
	return runServerEffect(
		suggestLocationsEffect(query, limit).pipe(
			Effect.provide(GraphHopperLive),
			Effect.provideService(ServerFetch, { fetch: fetchFn }),
		),
	);
}

export function geocodeLocationEffect(
	query: string,
): Effect.Effect<
	RouteSuggestion | null,
	GraphHopperGeocodeError,
	GraphHopperConfig | TimeoutFetch | GraphHopperSuggestionCache
> {
	return Effect.map(suggestLocationsEffect(query, 1), ([firstSuggestion]) => {
		return firstSuggestion ?? null;
	});
}

export async function geocodeLocation(
	fetchFn: typeof fetch,
	query: string,
): Promise<RouteSuggestion | null> {
	return runServerEffect(
		geocodeLocationEffect(query).pipe(
			Effect.provide(GraphHopperLive),
			Effect.provideService(ServerFetch, { fetch: fetchFn }),
		),
	);
}

export function reverseGeocodeLocationEffect(
	point: [number, number],
): Effect.Effect<
	RouteSuggestion | null,
	GraphHopperGeocodeError,
	GraphHopperConfig | TimeoutFetch | GraphHopperReverseGeocodeCache
> {
	return Effect.gen(function* () {
		const config = yield* GraphHopperConfig;
		const reverseGeocodeCache = yield* GraphHopperReverseGeocodeCache;
		const key = yield* config.apiKey;

		const cacheKey = `${point[0].toFixed(5)}::${point[1].toFixed(5)}`;
		const cachedSuggestion = yield* reverseGeocodeCache.get(cacheKey);

		if (cachedSuggestion !== undefined) {
			return cachedSuggestion;
		}

		const providers: GeocodeProvider[] = ["nominatim", "default"];
		let lastError: GraphHopperGeocodeError | null = null;

		for (const provider of providers) {
			const searchParams = new URLSearchParams({
				key,
				limit: "1",
				point: `${point[1]},${point[0]}`,
				reverse: "true",
			});

			if (provider === "nominatim") {
				searchParams.set("provider", provider);
			} else {
				searchParams.set("locale", "en");
			}

			const responseResult = yield* Effect.result(
				fetchGraphHopperGeocodeEffect(
					`${config.apiBaseUrl}/geocode?${searchParams.toString()}`,
					config.geocodeTimeoutMs,
					"reverse geocoding",
					provider,
				),
			);

			if (Result.isFailure(responseResult)) {
				lastError = responseResult.failure;
				console.warn(
					`GraphHopper reverse geocoding request failed using ${provider}. Trying the next provider.`,
					responseResult.failure.cause,
				);
				continue;
			}

			const response = responseResult.success;

			if (!response.ok) {
				const details = yield* readResponseTextEffect(response);
				lastError = new GraphHopperGeocodeStatusError(
					"Reverse geocoding",
					provider,
					response.status,
					details,
				);
				continue;
			}

			const payload = yield* readGraphHopperGeocodePayloadEffect(response);
			const suggestion = (payload.hits ?? [])
				.map((hit) => toSuggestion(hit, ""))
				.find((candidate): candidate is RouteSuggestion => !!candidate);

			if (suggestion) {
				yield* reverseGeocodeCache.set(cacheKey, suggestion);
				return suggestion;
			}
		}

		if (lastError) {
			return yield* Effect.fail(lastError);
		}

		yield* reverseGeocodeCache.set(cacheKey, null);
		return null;
	});
}

export async function reverseGeocodeLocation(
	fetchFn: typeof fetch,
	point: [number, number],
): Promise<RouteSuggestion | null> {
	return runServerEffect(
		reverseGeocodeLocationEffect(point).pipe(
			Effect.provide(GraphHopperLive),
			Effect.provideService(ServerFetch, { fetch: fetchFn }),
		),
	);
}
