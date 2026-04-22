import { env } from "$env/dynamic/private";

import type { RouteSuggestion } from "$lib/route-planning";

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

		const response = await fetchFn(
			`${graphHopperApiBaseUrl}/geocode?${searchParams.toString()}`,
		);

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
			return suggestions;
		}
	}

	if (lastError) {
		throw lastError;
	}

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

		const response = await fetchFn(
			`${graphHopperApiBaseUrl}/geocode?${searchParams.toString()}`,
		);

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
			return suggestion;
		}
	}

	if (lastError) {
		throw lastError;
	}

	return null;
}
