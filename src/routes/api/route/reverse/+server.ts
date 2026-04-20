import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import {
	missingGraphHopperApiKeyMessage,
	reverseGeocodeLocation,
} from "$lib/server/graphhopper";

function formatCoordinateLabel(point: [number, number]) {
	return `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
}

export const GET: RequestHandler = async ({ fetch, url }) => {
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

	try {
		const suggestion = await reverseGeocodeLocation(fetch, point);

		return json({
			label: suggestion?.label || formatCoordinateLabel(point),
			point,
		});
	} catch (error) {
		console.error("Failed to reverse geocode GraphHopper location", error);

		if (
			error instanceof Error &&
			error.message === missingGraphHopperApiKeyMessage
		) {
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
