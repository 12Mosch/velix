import { json } from "@sveltejs/kit";
import { Effect } from "effect";

import type { GraphHopperGeocodeError } from "$lib/server/graphhopper-errors";

type GraphHopperGeocodeErrorCases = {
	[K in GraphHopperGeocodeError["_tag"]]: (
		error: Extract<GraphHopperGeocodeError, { _tag: K }>,
	) => Effect.Effect<Response>;
};

type GraphHopperGeocodeErrorOptions = {
	logPrefix: string;
	missingKeyMessage: string;
	upstreamMessage: string;
};

export function mapGraphHopperGeocodeError({
	logPrefix,
	missingKeyMessage,
	upstreamMessage,
}: GraphHopperGeocodeErrorOptions): GraphHopperGeocodeErrorCases {
	const graphHopper502Handler = (
		error: Exclude<
			GraphHopperGeocodeError,
			{ _tag: "MissingGraphHopperApiKeyError" }
		>,
	) =>
		Effect.sync(() => {
			console.error(logPrefix, error);

			return json(
				{
					error: upstreamMessage,
				},
				{ status: 502 },
			);
		});

	return {
		MissingGraphHopperApiKeyError: (error) =>
			Effect.sync(() => {
				console.error(logPrefix, error);

				return json(
					{
						error: missingKeyMessage,
					},
					{ status: 500 },
				);
			}),
		GraphHopperGeocodeFetchError: graphHopper502Handler,
		GraphHopperGeocodeStatusError: graphHopper502Handler,
		GraphHopperGeocodePayloadError: graphHopper502Handler,
	};
}
