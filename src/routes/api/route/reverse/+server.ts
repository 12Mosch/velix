import { json } from "@sveltejs/kit";
import { Effect } from "effect";
import type { RequestHandler } from "./$types";

import { formatCoordinateLabel } from "$lib/coordinate-search";
import { runServerEffect } from "$lib/server/effect-runtime";
import { reverseGeocodeLocationEffect } from "$lib/server/graphhopper";
import { mapGraphHopperGeocodeError } from "$lib/server/graphhopper-route-errors";
import type { GraphHopperGeocodeError } from "$lib/server/graphhopper-errors";
import { checkReverseRateLimit } from "$lib/server/route-rate-limits";

export const GET: RequestHandler = async (event) => {
	const { fetch, url } = event;
	const latitude = Number(url.searchParams.get("lat"));
	const longitude = Number(url.searchParams.get("lng"));
	let program: Effect.Effect<Response, GraphHopperGeocodeError>;

	if (
		!Number.isFinite(latitude) ||
		!Number.isFinite(longitude) ||
		latitude < -90 ||
		latitude > 90 ||
		longitude < -180 ||
		longitude > 180
	) {
		program = Effect.succeed(
			json(
				{
					error: "A valid lat/lng pair is required.",
				},
				{ status: 400 },
			),
		);
	} else {
		const point: [number, number] = [longitude, latitude];

		program = Effect.gen(function* () {
			const rateLimitResponse = yield* Effect.sync(() =>
				checkReverseRateLimit(event),
			);

			if (rateLimitResponse) {
				return rateLimitResponse;
			}

			const suggestion = yield* reverseGeocodeLocationEffect(fetch, point);

			return json({
				label: suggestion?.label || formatCoordinateLabel(point),
				point,
			});
		});
	}

	return runServerEffect(
		Effect.catchTags(
			program,
			mapGraphHopperGeocodeError({
				logPrefix: "Failed to reverse geocode GraphHopper location",
				missingKeyMessage:
					"Reverse geocoding is not configured yet. Add GRAPHHOPPER_API_KEY.",
				upstreamMessage:
					"GraphHopper could not label that map location right now.",
			}),
		),
	);
};
