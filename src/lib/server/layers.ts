import { Layer } from "effect";

import {
	GraphHopperReverseGeocodeCacheLive,
	GraphHopperSuggestionCacheLive,
} from "$lib/server/graphhopper-cache";
import { GraphHopperConfigLive } from "$lib/server/graphhopper-config";
import { RouteRateLimitLive } from "$lib/server/route-rate-limits";
import { TimeoutFetchLive } from "$lib/server/resilience";

export const GraphHopperLive = Layer.mergeAll(
	GraphHopperConfigLive,
	TimeoutFetchLive,
	GraphHopperSuggestionCacheLive,
	GraphHopperReverseGeocodeCacheLive,
);

export const ServerLive = Layer.mergeAll(GraphHopperLive, RouteRateLimitLive);
