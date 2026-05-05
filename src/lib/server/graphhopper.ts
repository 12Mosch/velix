import { env } from "$env/dynamic/private";
import { Effect, Result } from "effect";

import type { RouteSuggestion } from "$lib/route-planning";
import { fetchWithTimeout, TtlCache } from "$lib/server/resilience";

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

export const graphHopperApiBaseUrl = "https://graphhopper.com/api/1";
export const missingGraphHopperApiKeyMessage = "Missing GRAPHHOPPER_API_KEY";

const geocodeTimeoutMs = 4_000;
const geocodeCacheTtlMs = 10 * 60 * 1_000;
const maxGeocodeCacheEntries = 250;
const suggestionCache = new TtlCache<RouteSuggestion[]>(
	geocodeCacheTtlMs,
	maxGeocodeCacheEntries,
);
const reverseGeocodeCache = new TtlCache<RouteSuggestion | null>(
	geocodeCacheTtlMs,
	maxGeocodeCacheEntries,
);

class MissingGraphHopperApiKeyError extends Error {
	readonly _tag = "MissingGraphHopperApiKeyError";

	constructor() {
		super(missingGraphHopperApiKeyMessage);
	}
}

class GraphHopperGeocodeFetchError extends Error {
	readonly _tag = "GraphHopperGeocodeFetchError";

	constructor(
		readonly operation: "geocoding" | "reverse geocoding",
		readonly provider: GeocodeProvider,
		readonly cause: unknown,
	) {
		super(
			cause instanceof Error
				? cause.message
				: `${operation[0]?.toUpperCase()}${operation.slice(1)} failed using ${provider}`,
		);
	}
}

class GraphHopperGeocodeStatusError extends Error {
	readonly _tag = "GraphHopperGeocodeStatusError";

	constructor(
		operation: "Geocoding" | "Reverse geocoding",
		readonly provider: GeocodeProvider,
		readonly status: number,
		details: string,
	) {
		super(
			`${operation} failed with status ${status} using ${provider}${
				details ? `: ${details}` : ""
			}`,
		);
	}
}

class GraphHopperGeocodePayloadError extends Error {
	readonly _tag = "GraphHopperGeocodePayloadError";

	constructor(readonly cause: unknown) {
		super("GraphHopper geocode response was not valid JSON");
	}
}

type GraphHopperGeocodeError =
	| MissingGraphHopperApiKeyError
	| GraphHopperGeocodeFetchError
	| GraphHopperGeocodeStatusError
	| GraphHopperGeocodePayloadError;

function getGraphHopperApiKeyEffect(): Effect.Effect<
	string,
	MissingGraphHopperApiKeyError
> {
	return Effect.gen(function* () {
		const key = env.GRAPHHOPPER_API_KEY?.trim();

		if (!key) {
			return yield* Effect.fail(new MissingGraphHopperApiKeyError());
		}

		return key;
	});
}

function fetchGraphHopperGeocodeEffect(
	fetchFn: typeof fetch,
	url: string,
	operation: "geocoding" | "reverse geocoding",
	provider: GeocodeProvider,
): Effect.Effect<Response, GraphHopperGeocodeFetchError> {
	return Effect.tryPromise({
		try: () => fetchWithTimeout(fetchFn, url, undefined, geocodeTimeoutMs),
		catch: (cause) =>
			new GraphHopperGeocodeFetchError(operation, provider, cause),
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

function readResponseTextEffect(response: Response): Effect.Effect<string> {
	return Effect.tryPromise(() => response.text());
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

function suggestLocationsEffect(
	fetchFn: typeof fetch,
	query: string,
	limit = 5,
): Effect.Effect<RouteSuggestion[], GraphHopperGeocodeError> {
	return Effect.gen(function* () {
		const key = yield* getGraphHopperApiKeyEffect();

		const cacheKey = `${query.trim().toLowerCase()}::${limit}`;
		const cachedSuggestions = suggestionCache.get(cacheKey);

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
					fetchFn,
					`${graphHopperApiBaseUrl}/geocode?${searchParams.toString()}`,
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
				suggestionCache.set(cacheKey, suggestions);
				return suggestions;
			}
		}

		if (lastError) {
			return yield* Effect.fail(lastError);
		}

		suggestionCache.set(cacheKey, []);
		return [];
	});
}

export async function suggestLocations(
	fetchFn: typeof fetch,
	query: string,
	limit = 5,
): Promise<RouteSuggestion[]> {
	return Effect.runPromise(suggestLocationsEffect(fetchFn, query, limit));
}

export async function geocodeLocation(
	fetchFn: typeof fetch,
	query: string,
): Promise<RouteSuggestion | null> {
	const [firstSuggestion] = await suggestLocations(fetchFn, query, 1);
	return firstSuggestion ?? null;
}

function reverseGeocodeLocationEffect(
	fetchFn: typeof fetch,
	point: [number, number],
): Effect.Effect<RouteSuggestion | null, GraphHopperGeocodeError> {
	return Effect.gen(function* () {
		const key = yield* getGraphHopperApiKeyEffect();

		const cacheKey = `${point[0].toFixed(5)}::${point[1].toFixed(5)}`;
		const cachedSuggestion = reverseGeocodeCache.get(cacheKey);

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
					fetchFn,
					`${graphHopperApiBaseUrl}/geocode?${searchParams.toString()}`,
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
				reverseGeocodeCache.set(cacheKey, suggestion);
				return suggestion;
			}
		}

		if (lastError) {
			return yield* Effect.fail(lastError);
		}

		reverseGeocodeCache.set(cacheKey, null);
		return null;
	});
}

export async function reverseGeocodeLocation(
	fetchFn: typeof fetch,
	point: [number, number],
): Promise<RouteSuggestion | null> {
	return Effect.runPromise(reverseGeocodeLocationEffect(fetchFn, point));
}

export function clearGraphHopperCachesForTests(): void {
	suggestionCache.clear();
	reverseGeocodeCache.clear();
}
