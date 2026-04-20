import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import {
	missingGraphHopperApiKeyMessage,
	suggestLocations,
} from "$lib/server/graphhopper";

const minQueryLength = 3;
const maxSuggestions = 5;

export const GET: RequestHandler = async ({ fetch, url }) => {
	const query = url.searchParams.get("q")?.trim() ?? "";

	if (query.length < minQueryLength) {
		return json({
			suggestions: [],
		});
	}

	try {
		const suggestions = await suggestLocations(fetch, query, maxSuggestions);

		return json({
			suggestions,
		});
	} catch (error) {
		console.error("Failed to fetch GraphHopper suggestions", error);

		if (
			error instanceof Error &&
			error.message === missingGraphHopperApiKeyMessage
		) {
			return json(
				{
					error: "Suggestions are not configured yet. Add GRAPHHOPPER_API_KEY.",
				},
				{ status: 500 },
			);
		}

		return json(
			{
				error: "GraphHopper could not fetch location suggestions right now.",
			},
			{ status: 502 },
		);
	}
};
