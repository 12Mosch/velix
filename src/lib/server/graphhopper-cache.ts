import { Context, Effect, Layer } from "effect";

import type { RouteSuggestion } from "$lib/route-planning";
import { makeTtlCache, type TtlCacheService } from "$lib/server/resilience";

const geocodeCacheTtlMs = 10 * 60 * 1_000;
const maxGeocodeCacheEntries = 250;

export class GraphHopperSuggestionCache extends Context.Service<
	GraphHopperSuggestionCache,
	TtlCacheService<RouteSuggestion[]>
>()("GraphHopperSuggestionCache") {}

export class GraphHopperReverseGeocodeCache extends Context.Service<
	GraphHopperReverseGeocodeCache,
	TtlCacheService<RouteSuggestion | null>
>()("GraphHopperReverseGeocodeCache") {}

const suggestionCache = Effect.runSync(
	makeTtlCache<RouteSuggestion[]>({
		ttlMs: geocodeCacheTtlMs,
		maxEntries: maxGeocodeCacheEntries,
	}),
);
const reverseGeocodeCache = Effect.runSync(
	makeTtlCache<RouteSuggestion | null>({
		ttlMs: geocodeCacheTtlMs,
		maxEntries: maxGeocodeCacheEntries,
	}),
);

export const GraphHopperSuggestionCacheLive = Layer.succeed(
	GraphHopperSuggestionCache,
)(suggestionCache);
export const GraphHopperReverseGeocodeCacheLive = Layer.succeed(
	GraphHopperReverseGeocodeCache,
)(reverseGeocodeCache);

export function clearGraphHopperCachesForTests(): void {
	Effect.runSync(
		Effect.gen(function* () {
			yield* suggestionCache.clear;
			yield* reverseGeocodeCache.clear;
		}),
	);
}
