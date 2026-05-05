import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { formatCoordinateLabel } from "$lib/coordinate-search";
import { reverseGeocodeLocation } from "$lib/server/graphhopper";
import { isMissingGraphHopperApiKeyError } from "$lib/server/graphhopper-errors";
import { checkReverseRateLimit } from "$lib/server/route-rate-limits";

export const GET: RequestHandler = async (event) => {
	const { fetch, url } = event;
	const latitude = Number(url.searchParams.get("lat"));
	const longitude = Number(url.searchParams.get("lng"));

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
	const rateLimitResponse = checkReverseRateLimit(event);

	if (rateLimitResponse) {
		return rateLimitResponse;
	}

	try {
		const suggestion = await reverseGeocodeLocation(fetch, point);

		return json({
			label: suggestion?.label || formatCoordinateLabel(point),
			point,
		});
	} catch (error) {
		console.error("Failed to reverse geocode GraphHopper location", error);

		if (isMissingGraphHopperApiKeyError(error)) {
			return json(
				{
					error:
						"Reverse geocoding is not configured yet. Add GRAPHHOPPER_API_KEY.",
				},
				{ status: 500 },
			);
		}

		return json(
			{
				error: "GraphHopper could not label that map location right now.",
			},
			{ status: 502 },
		);
	}
};
