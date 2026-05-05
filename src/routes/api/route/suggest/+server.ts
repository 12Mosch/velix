import { json } from "@sveltejs/kit";
import { Effect } from "effect";
import type { RequestHandler } from "./$types";

import { parseCoordinateSearchInput } from "$lib/coordinate-search";
import { runServerEffect } from "$lib/server/effect-runtime";
import { suggestLocationsEffect } from "$lib/server/graphhopper";
import { mapGraphHopperGeocodeError } from "$lib/server/graphhopper-route-errors";
import type { GraphHopperGeocodeError } from "$lib/server/graphhopper-errors";
import { checkSuggestionRateLimitEffect } from "$lib/server/route-rate-limits";

const minQueryLength = 3;
const maxSuggestions = 5;

export const GET: RequestHandler = async (event) => {
	const { fetch, url } = event;
	const query = url.searchParams.get("q")?.trim() ?? "";
	const coordinateResult = parseCoordinateSearchInput(query);
	let program: Effect.Effect<Response, GraphHopperGeocodeError>;

	if (coordinateResult.kind === "coordinate") {
		program = Effect.succeed(
			json({
				suggestions: [
					{
						label: coordinateResult.label,
						point: coordinateResult.point,
					},
				],
			}),
		);
	} else if (coordinateResult.kind === "invalid_coordinate") {
		program = Effect.succeed(
			json({
				suggestions: [],
			}),
		);
	} else if (query.length < minQueryLength) {
		program = Effect.succeed(
			json({
				suggestions: [],
			}),
		);
	} else {
		program = Effect.gen(function* () {
			const rateLimitResponse = yield* checkSuggestionRateLimitEffect(event);

			if (rateLimitResponse) {
				return rateLimitResponse;
			}

			const suggestions = yield* suggestLocationsEffect(
				fetch,
				query,
				maxSuggestions,
			);

			return json({
				suggestions,
			});
		});
	}

	return runServerEffect(
		Effect.catchTags(
			program,
			mapGraphHopperGeocodeError({
				logPrefix: "Failed to fetch GraphHopper suggestions",
				missingKeyMessage:
					"Suggestions are not configured yet. Add GRAPHHOPPER_API_KEY.",
				upstreamMessage:
					"GraphHopper could not fetch location suggestions right now.",
			}),
		),
	);
};
