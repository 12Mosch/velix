import { json } from "@sveltejs/kit";
import { Effect } from "effect";
import type { RequestHandler } from "./$types";

import { parseCoordinateSearchInput } from "$lib/coordinate-search";
import { runServerEffect } from "$lib/server/effect-runtime";
import { suggestLocationsEffect } from "$lib/server/graphhopper";
import { mapGraphHopperGeocodeError } from "$lib/server/graphhopper-route-errors";
import { ServerLive } from "$lib/server/layers";
import { ServerFetch } from "$lib/server/resilience";
import {
	getGeocodingTextTooLongMessage,
	maxSuggestionQueryLength,
} from "$lib/server/route-endpoint/constants";
import { checkSuggestionRateLimitEffect } from "$lib/server/route-rate-limits";

const minQueryLength = 3;
const maxSuggestions = 5;

export const GET: RequestHandler = async (event) => {
	const { fetch, url } = event;

	const program = Effect.gen(function* () {
		const query = url.searchParams.get("q")?.trim() ?? "";
		const coordinateResult = parseCoordinateSearchInput(query);

		if (coordinateResult.kind === "coordinate") {
			return json({
				suggestions: [
					{
						label: coordinateResult.label,
						point: coordinateResult.point,
					},
				],
			});
		}

		if (coordinateResult.kind === "invalid_coordinate") {
			return json({
				suggestions: [],
			});
		}

		if (query.length < minQueryLength) {
			return json({
				suggestions: [],
			});
		}

		if (query.length > maxSuggestionQueryLength) {
			return json(
				{
					error: getGeocodingTextTooLongMessage(),
				},
				{ status: 400 },
			);
		}

		const rateLimitResponse = yield* checkSuggestionRateLimitEffect(event);

		if (rateLimitResponse) {
			return rateLimitResponse;
		}

		const suggestions = yield* suggestLocationsEffect(query, maxSuggestions);

		return json({
			suggestions,
		});
	});

	return runServerEffect(
		program.pipe(
			Effect.catchTags(
				mapGraphHopperGeocodeError({
					logPrefix: "Failed to fetch GraphHopper suggestions",
					missingKeyMessage:
						"Suggestions are not configured yet. Add GRAPHHOPPER_API_KEY.",
					upstreamMessage:
						"GraphHopper could not fetch location suggestions right now.",
				}),
			),
			Effect.provide(ServerLive),
			Effect.provideService(ServerFetch, { fetch }),
		),
	);
};
