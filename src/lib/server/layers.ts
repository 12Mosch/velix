import { Layer } from "effect";

import {
	GraphHopperReverseGeocodeCacheLive,
	GraphHopperRouteCacheLive,
	GraphHopperSuggestionCacheLive,
} from "$lib/server/graphhopper-cache";
import { GraphHopperConfigLive } from "$lib/server/graphhopper-config";
import { OpenMeteoWindForecastCacheLive } from "$lib/server/open-meteo";
import { RouteRateLimitLive } from "$lib/server/route-rate-limits";
import { TimeoutFetchLive } from "$lib/server/resilience";

export const GraphHopperLive = Layer.mergeAll(
	GraphHopperConfigLive,
	TimeoutFetchLive,
	GraphHopperSuggestionCacheLive,
	GraphHopperReverseGeocodeCacheLive,
	GraphHopperRouteCacheLive,
);

export const ServerLive = Layer.mergeAll(
	GraphHopperLive,
	OpenMeteoWindForecastCacheLive,
	RouteRateLimitLive,
);
