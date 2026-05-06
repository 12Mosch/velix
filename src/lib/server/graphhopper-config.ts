import { env } from "$env/dynamic/private";
import { Context, Effect, Layer } from "effect";

import { MissingGraphHopperApiKeyError } from "$lib/server/graphhopper-errors";

export class GraphHopperConfig extends Context.Service<
	GraphHopperConfig,
	{
		readonly apiBaseUrl: string;
		readonly geocodeTimeoutMs: number;
		readonly routeTimeoutMs: number;
		readonly apiKey: Effect.Effect<string, MissingGraphHopperApiKeyError>;
	}
>()("GraphHopperConfig") {}

export const GraphHopperConfigLive = Layer.succeed(GraphHopperConfig)({
	apiBaseUrl: "https://graphhopper.com/api/1",
	geocodeTimeoutMs: 4_000,
	routeTimeoutMs: 20_000,
	apiKey: Effect.gen(function* () {
		const key = env.GRAPHHOPPER_API_KEY?.trim();

		if (!key) {
			return yield* Effect.fail(new MissingGraphHopperApiKeyError());
		}

		return key;
	}),
});
