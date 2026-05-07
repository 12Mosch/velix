import { json } from "@sveltejs/kit";
import { Effect } from "effect";
import type { RequestHandler } from "./$types";

import { formatCoordinateLabel } from "$lib/coordinate-search";
import { runServerEffect } from "$lib/server/effect-runtime";
import { reverseGeocodeLocationEffect } from "$lib/server/graphhopper";
import { mapGraphHopperGeocodeError } from "$lib/server/graphhopper-route-errors";
import { ServerLive } from "$lib/server/layers";
import { ServerFetch } from "$lib/server/resilience";
import { checkReverseRateLimitEffect } from "$lib/server/route-rate-limits";

export const GET: RequestHandler = async (event) => {
	const { fetch, url } = event;

	const program = Effect.gen(function* () {
		const latitudeParam = url.searchParams.get("lat");
		const longitudeParam = url.searchParams.get("lng");
		const latitude =
			latitudeParam === null ? Number.NaN : Number(latitudeParam);
		const longitude =
			longitudeParam === null ? Number.NaN : Number(longitudeParam);

		if (
			!Number.isFinite(latitude) ||
			!Number.isFinite(longitude) ||
			latitude < -90 ||
			latitude > 90 ||
			longitude < -180 ||
			longitude > 180
		) {
			return json(
				{
					error: "A valid lat/lng pair is required.",
				},
				{ status: 400 },
			);
		}

		const point: [number, number] = [longitude, latitude];

		const rateLimitResponse = yield* checkReverseRateLimitEffect(event);

		if (rateLimitResponse) {
			return rateLimitResponse;
		}

		const suggestion = yield* reverseGeocodeLocationEffect(point);

		return json({
			label: suggestion?.label || formatCoordinateLabel(point),
			point,
		});
	});

	return runServerEffect(
		program.pipe(
			Effect.catchTags(
				mapGraphHopperGeocodeError({
					logPrefix: "Failed to reverse geocode GraphHopper location",
					missingKeyMessage:
						"Reverse geocoding is not configured yet. Add GRAPHHOPPER_API_KEY.",
					upstreamMessage:
						"GraphHopper could not label that map location right now.",
				}),
			),
			Effect.provide(ServerLive),
			Effect.provideService(ServerFetch, { fetch }),
		),
	);
};
