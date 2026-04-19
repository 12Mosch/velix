import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import type {
	PlannedRoute,
	RouteApiError,
	RouteCoordinate,
	RouteDetailInterval,
} from "$lib/route-planning";

type GeocodeHit = {
	name?: string;
	street?: string;
	housenumber?: string;
	city?: string;
	state?: string;
	country?: string;
	point?: {
		lat?: number;
		lng?: number;
	};
};

type GraphHopperGeocodeResponse = {
	hits?: GeocodeHit[];
};

type GraphHopperPath = {
	bbox?: number[];
	distance?: number;
	time?: number;
	ascend?: number;
	descend?: number;
	points?: {
		coordinates?: RouteCoordinate[];
	};
	details?: Record<string, Array<[number, number, string]>>;
};

type GraphHopperRouteResponse = {
	paths?: GraphHopperPath[];
};

type GraphHopperRouteRequestBody = {
	profile: "bike";
	points: [[number, number], [number, number]];
	points_encoded: false;
	elevation: true;
	instructions: false;
	calc_points: true;
	details: ["surface", "smoothness", "road_class", "road_environment"];
	snap_preventions?: string[];
	"ch.disable"?: true;
	custom_model?: typeof roadBikeCustomModel;
};

const graphHopperApiBaseUrl = "https://graphhopper.com/api/1";

type GeocodeProvider = "default" | "nominatim";

const roadBikeCustomModel = {
	priority: [
		{
			if: "road_environment == FERRY || road_environment == TUNNEL",
			multiply_by: "0.1",
		},
		{
			if: "road_class == TRACK || road_class == PATH || road_class == FOOTWAY || road_class == STEPS",
			multiply_by: "0.15",
		},
		{
			if: "surface == DIRT || surface == GROUND || surface == GRAVEL || surface == SAND || surface == MUD || surface == GRASS",
			multiply_by: "0.15",
		},
		{
			if: "surface == COBBLESTONE || surface == SETT || surface == UNHEWN_COBBLESTONE || surface == PAVING_STONES",
			multiply_by: "0.45",
		},
		{
			if: "smoothness == BAD || smoothness == VERY_BAD || smoothness == HORRIBLE || smoothness == VERY_HORRIBLE || smoothness == IMPASSABLE",
			multiply_by: "0.2",
		},
	],
	distance_influence: 45,
} as const;

function errorResponse(
	status: number,
	error: string,
	fieldErrors?: RouteApiError["fieldErrors"],
) {
	return json(
		{
			error,
			fieldErrors,
		},
		{ status },
	);
}

function normalizeDetailIntervals(
	detail: Array<[number, number, string]> | undefined,
): RouteDetailInterval[] {
	if (!detail) {
		return [];
	}

	return detail
		.filter((interval) => interval.length >= 3)
		.map(([from, to, value]) => ({
			from,
			to,
			value,
		}));
}

function buildResolvedLabel(hit: GeocodeHit): string {
	const primary = [
		hit.name,
		[hit.street, hit.housenumber].filter(Boolean).join(" ").trim(),
	]
		.map((part) => part?.trim())
		.filter(Boolean);
	const secondary = [hit.city, hit.state, hit.country]
		.map((part) => part?.trim())
		.filter(Boolean);

	return [...new Set([...primary, ...secondary])].join(", ");
}

async function geocodeLocation(
	fetchFn: typeof fetch,
	query: string,
): Promise<{ label: string; point: [number, number] } | null> {
	const key = env.GRAPHHOPPER_API_KEY?.trim();

	if (!key) {
		throw new Error("Missing GRAPHHOPPER_API_KEY");
	}

	const providers: GeocodeProvider[] = ["nominatim", "default"];
	let lastError: Error | null = null;

	for (const provider of providers) {
		const searchParams = new URLSearchParams({
			q: query,
			limit: "1",
			key,
		});

		if (provider === "nominatim") {
			searchParams.set("provider", provider);
		} else {
			searchParams.set("locale", "en");
		}

		const response = await fetchFn(
			`${graphHopperApiBaseUrl}/geocode?${searchParams.toString()}`,
		);

		if (!response.ok) {
			const details = await response.text();
			lastError = new Error(
				`Geocoding failed with status ${response.status} using ${provider}${
					details ? `: ${details}` : ""
				}`,
			);
			continue;
		}

		const payload = (await response.json()) as GraphHopperGeocodeResponse;
		const hit = payload.hits?.[0];
		const lat = hit?.point?.lat;
		const lng = hit?.point?.lng;

		if (
			!hit ||
			typeof lat !== "number" ||
			!Number.isFinite(lat) ||
			typeof lng !== "number" ||
			!Number.isFinite(lng)
		) {
			continue;
		}

		return {
			label: buildResolvedLabel(hit) || query,
			point: [lng, lat],
		};
	}

	if (lastError) {
		throw lastError;
	}

	return null;
}

async function requestRoute(
	fetchFn: typeof fetch,
	start: [number, number],
	destination: [number, number],
): Promise<PlannedRoute> {
	const key = env.GRAPHHOPPER_API_KEY?.trim();

	if (!key) {
		throw new Error("Missing GRAPHHOPPER_API_KEY");
	}

	const routeUrl = `${graphHopperApiBaseUrl}/route?key=${encodeURIComponent(key)}`;
	const preferredRequestBody: GraphHopperRouteRequestBody = {
		profile: "bike",
		points: [start, destination],
		points_encoded: false,
		elevation: true,
		instructions: false,
		calc_points: true,
		details: ["surface", "smoothness", "road_class", "road_environment"],
		snap_preventions: ["ferry", "tunnel"],
		"ch.disable": true,
		custom_model: roadBikeCustomModel,
	};
	const fallbackRequestBody: GraphHopperRouteRequestBody = {
		profile: "bike",
		points: [start, destination],
		points_encoded: false,
		elevation: true,
		instructions: false,
		calc_points: true,
		details: ["surface", "smoothness", "road_class", "road_environment"],
	};

	async function sendRouteRequest(body: GraphHopperRouteRequestBody) {
		const response = await fetchFn(routeUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const details = await response.text();
			throw new Error(
				`Routing failed with status ${response.status}${details ? `: ${details}` : ""}`,
			);
		}

		return (await response.json()) as GraphHopperRouteResponse;
	}

	let payload: GraphHopperRouteResponse;

	try {
		payload = await sendRouteRequest(preferredRequestBody);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		if (!message.includes("Routing failed with status 400")) {
			throw error;
		}

		console.warn(
			"GraphHopper rejected the road-bike tuning. Retrying with the plain bike profile.",
			error,
		);
		payload = await sendRouteRequest(fallbackRequestBody);
	}

	const path = payload.paths?.[0];
	const coordinates = path?.points?.coordinates;
	const bbox = path?.bbox;

	if (
		!path ||
		!bbox ||
		bbox.length < 4 ||
		!coordinates ||
		coordinates.length < 2 ||
		typeof path.distance !== "number" ||
		typeof path.time !== "number" ||
		typeof path.ascend !== "number" ||
		typeof path.descend !== "number"
	) {
		throw new Error("GraphHopper route response was incomplete");
	}

	return {
		startLabel: "",
		destinationLabel: "",
		bounds: [bbox[0], bbox[1], bbox[2], bbox[3]],
		distanceMeters: path.distance,
		durationMs: path.time,
		ascendMeters: path.ascend,
		descendMeters: path.descend,
		coordinates,
		surfaceDetails: normalizeDetailIntervals(path.details?.surface),
		smoothnessDetails: normalizeDetailIntervals(path.details?.smoothness),
	};
}

export const POST: RequestHandler = async ({ fetch, request }) => {
	let payload: { startQuery?: string; destinationQuery?: string };

	try {
		payload = (await request.json()) as {
			startQuery?: string;
			destinationQuery?: string;
		};
	} catch {
		return errorResponse(400, "Invalid route request payload.");
	}

	const startQuery = payload.startQuery?.trim() ?? "";
	const destinationQuery = payload.destinationQuery?.trim() ?? "";
	const fieldErrors: RouteApiError["fieldErrors"] = {};

	if (!startQuery) {
		fieldErrors.startQuery = "Enter a start point.";
	}

	if (!destinationQuery) {
		fieldErrors.destinationQuery = "Enter a destination.";
	}

	if (Object.keys(fieldErrors).length > 0) {
		return errorResponse(
			400,
			"Start and destination are required.",
			fieldErrors,
		);
	}

	try {
		const start = await geocodeLocation(fetch, startQuery);
		const destination = await geocodeLocation(fetch, destinationQuery);

		if (!start || !destination) {
			return errorResponse(422, "We couldn't resolve one or both locations.", {
				...(start
					? {}
					: { startQuery: "We couldn't resolve that start point." }),
				...(destination
					? {}
					: { destinationQuery: "We couldn't resolve that destination." }),
			});
		}

		const route = await requestRoute(fetch, start.point, destination.point);
		route.startLabel = start.label;
		route.destinationLabel = destination.label;

		return json({
			route,
		});
	} catch (error) {
		console.error("Failed to generate GraphHopper route", error);

		if (
			error instanceof Error &&
			error.message === "Missing GRAPHHOPPER_API_KEY"
		) {
			return errorResponse(
				500,
				"Routing is not configured yet. Add GRAPHHOPPER_API_KEY.",
			);
		}

		return errorResponse(
			502,
			"GraphHopper could not generate a route right now.",
		);
	}
};
