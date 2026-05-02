import { env } from "$env/dynamic/private";

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

export async function suggestLocations(
	fetchFn: typeof fetch,
	query: string,
	limit = 5,
): Promise<RouteSuggestion[]> {
	const key = env.GRAPHHOPPER_API_KEY?.trim();

	if (!key) {
		throw new Error(missingGraphHopperApiKeyMessage);
	}

	const cacheKey = `${query.trim().toLowerCase()}::${limit}`;
	const cachedSuggestions = suggestionCache.get(cacheKey);

	if (cachedSuggestions) {
		return cachedSuggestions;
	}

	const providers: GeocodeProvider[] = ["nominatim", "default"];
	let lastError: Error | null = null;

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

		let response: Response;

		try {
			response = await fetchWithTimeout(
				fetchFn,
				`${graphHopperApiBaseUrl}/geocode?${searchParams.toString()}`,
				undefined,
				geocodeTimeoutMs,
			);
		} catch (error) {
			lastError =
				error instanceof Error
					? error
					: new Error(`Geocoding failed using ${provider}`);
			console.warn(
				`GraphHopper geocoding request failed using ${provider}. Trying the next provider.`,
				error,
			);
			continue;
		}

		if (!response.ok) {
			const details = await response.text();
			lastError = new Error(
				`Geocoding failed with status ${response.status} using ${provider}${
					details ? `: ${details}` : ""
				}`,
			);
			continue;
		}

		const payload = (await response.json()) as GraphHopperGeocodeResponse;
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
		throw lastError;
	}

	suggestionCache.set(cacheKey, []);
	return [];
}

export async function geocodeLocation(
	fetchFn: typeof fetch,
	query: string,
): Promise<RouteSuggestion | null> {
	const [firstSuggestion] = await suggestLocations(fetchFn, query, 1);
	return firstSuggestion ?? null;
}

export async function reverseGeocodeLocation(
	fetchFn: typeof fetch,
	point: [number, number],
): Promise<RouteSuggestion | null> {
	const key = env.GRAPHHOPPER_API_KEY?.trim();

	if (!key) {
		throw new Error(missingGraphHopperApiKeyMessage);
	}

	const cacheKey = `${point[0].toFixed(5)}::${point[1].toFixed(5)}`;
	const cachedSuggestion = reverseGeocodeCache.get(cacheKey);

	if (cachedSuggestion !== undefined) {
		return cachedSuggestion;
	}

	const providers: GeocodeProvider[] = ["nominatim", "default"];
	let lastError: Error | null = null;

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

		let response: Response;

		try {
			response = await fetchWithTimeout(
				fetchFn,
				`${graphHopperApiBaseUrl}/geocode?${searchParams.toString()}`,
				undefined,
				geocodeTimeoutMs,
			);
		} catch (error) {
			lastError =
				error instanceof Error
					? error
					: new Error(`Reverse geocoding failed using ${provider}`);
			console.warn(
				`GraphHopper reverse geocoding request failed using ${provider}. Trying the next provider.`,
				error,
			);
			continue;
		}

		if (!response.ok) {
			const details = await response.text();
			lastError = new Error(
				`Reverse geocoding failed with status ${response.status} using ${provider}${
					details ? `: ${details}` : ""
				}`,
			);
			continue;
		}

		const payload = (await response.json()) as GraphHopperGeocodeResponse;
		const suggestion = (payload.hits ?? [])
			.map((hit) => toSuggestion(hit, ""))
			.find((candidate): candidate is RouteSuggestion => !!candidate);

		if (suggestion) {
			reverseGeocodeCache.set(cacheKey, suggestion);
			return suggestion;
		}
	}

	if (lastError) {
		throw lastError;
	}

	reverseGeocodeCache.set(cacheKey, null);
	return null;
}

export function clearGraphHopperCachesForTests(): void {
	suggestionCache.clear();
	reverseGeocodeCache.clear();
}
