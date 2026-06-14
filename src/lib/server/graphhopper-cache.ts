import { Context, Effect, Layer } from "effect";

import type { RouteSuggestion } from "$lib/route-planning";
import { makeTtlCache, type TtlCacheService } from "$lib/server/resilience";

const geocodeCacheTtlMs = 10 * 60 * 1_000;
const maxGeocodeCacheEntries = 250;
const routeCacheTtlMs = 10 * 60 * 1_000;
const maxRouteCacheEntries = 250;

export class GraphHopperSuggestionCache extends Context.Service<
	GraphHopperSuggestionCache,
	TtlCacheService<RouteSuggestion[]>
>()("GraphHopperSuggestionCache") {}

export class GraphHopperReverseGeocodeCache extends Context.Service<
	GraphHopperReverseGeocodeCache,
	TtlCacheService<RouteSuggestion | null>
>()("GraphHopperReverseGeocodeCache") {}

export class GraphHopperRouteCache extends Context.Service<
	GraphHopperRouteCache,
	TtlCacheService<unknown>
>()("GraphHopperRouteCache") {}

let suggestionCache: TtlCacheService<RouteSuggestion[]> | undefined;
let reverseGeocodeCache: TtlCacheService<RouteSuggestion | null> | undefined;
let routeCache: TtlCacheService<unknown> | undefined;

export const GraphHopperSuggestionCacheLive = Layer.effect(
	GraphHopperSuggestionCache,
)(
	Effect.suspend(() => {
		if (suggestionCache) {
			return Effect.succeed(suggestionCache);
		}

		return makeTtlCache<RouteSuggestion[]>({
			ttlMs: geocodeCacheTtlMs,
			maxEntries: maxGeocodeCacheEntries,
		}).pipe(
			Effect.tap((cache) =>
				Effect.sync(() => {
					suggestionCache = cache;
				}),
			),
		);
	}),
);
export const GraphHopperReverseGeocodeCacheLive = Layer.effect(
	GraphHopperReverseGeocodeCache,
)(
	Effect.suspend(() => {
		if (reverseGeocodeCache) {
			return Effect.succeed(reverseGeocodeCache);
		}

		return makeTtlCache<RouteSuggestion | null>({
			ttlMs: geocodeCacheTtlMs,
			maxEntries: maxGeocodeCacheEntries,
		}).pipe(
			Effect.tap((cache) =>
				Effect.sync(() => {
					reverseGeocodeCache = cache;
				}),
			),
		);
	}),
);

export const GraphHopperRouteCacheLive = Layer.effect(GraphHopperRouteCache)(
	Effect.suspend(() => {
		if (routeCache) {
			return Effect.succeed(routeCache);
		}

		return makeTtlCache<unknown>({
			ttlMs: routeCacheTtlMs,
			maxEntries: maxRouteCacheEntries,
		}).pipe(
			Effect.tap((cache) =>
				Effect.sync(() => {
					routeCache = cache;
				}),
			),
		);
	}),
);

export function clearGraphHopperCachesForTests(): void {
	Effect.runSync(
		Effect.gen(function* () {
			if (suggestionCache) {
				yield* suggestionCache.clear;
			}

			if (reverseGeocodeCache) {
				yield* reverseGeocodeCache.clear;
			}

			if (routeCache) {
				yield* routeCache.clear;
			}
		}),
	);
}
