import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import type {
	PlannedRoute,
	RouteApiError,
	RouteCoordinate,
	RouteDetailInterval,
	RouteWaypoint,
} from "$lib/route-planning";
import {
	geocodeLocation,
	graphHopperApiBaseUrl,
	missingGraphHopperApiKeyMessage,
} from "$lib/server/graphhopper";

type GraphHopperPath = {
	bbox?: number[];
	distance?: number;
	time?: number;
	ascend?: number;
	descend?: number;
	points?: {
		coordinates?: RouteCoordinate[];
	};
	snapped_waypoints?: {
		coordinates?: RouteCoordinate[];
	};
	details?: Record<string, Array<[number, number, string]>>;
};

type GraphHopperRouteResponse = {
	paths?: GraphHopperPath[];
};

type GraphHopperRouteRequestBody = {
	profile: "bike";
	points: [number, number][];
	points_encoded: false;
	elevation: true;
	instructions: false;
	calc_points: true;
	details: ["surface", "smoothness", "road_class", "road_environment"];
	snap_preventions?: string[];
	"ch.disable"?: true;
	custom_model?: typeof roadBikeCustomModel;
};

const maxRoutePoints = 5;
const maxWaypoints = maxRoutePoints - 2;

type StopField = "startQuery" | "destinationQuery" | "waypointQueries";
type RouteStop = {
	kind: "start" | "waypoint" | "destination";
	query: string;
	field: StopField;
	index?: number;
	label?: string;
	point?: [number, number];
};

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

async function requestRoute(
	fetchFn: typeof fetch,
	points: [number, number][],
): Promise<{
	route: PlannedRoute;
	snappedWaypoints: RouteCoordinate[];
}> {
	const key = env.GRAPHHOPPER_API_KEY?.trim();

	if (!key) {
		throw new Error(missingGraphHopperApiKeyMessage);
	}

	const routeUrl = `${graphHopperApiBaseUrl}/route?key=${encodeURIComponent(key)}`;
	const preferredRequestBody: GraphHopperRouteRequestBody = {
		profile: "bike",
		points,
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
		points,
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
	const snappedWaypoints = path?.snapped_waypoints?.coordinates;
	const bbox = path?.bbox;

	if (
		!path ||
		!bbox ||
		bbox.length < 4 ||
		!coordinates ||
		coordinates.length < 2 ||
		!snappedWaypoints ||
		snappedWaypoints.length !== points.length ||
		typeof path.distance !== "number" ||
		typeof path.time !== "number" ||
		typeof path.ascend !== "number" ||
		typeof path.descend !== "number"
	) {
		throw new Error("GraphHopper route response was incomplete");
	}

	return {
		route: {
			startLabel: "",
			destinationLabel: "",
			waypoints: [],
			bounds: [bbox[0], bbox[1], bbox[2], bbox[3]],
			distanceMeters: path.distance,
			durationMs: path.time,
			ascendMeters: path.ascend,
			descendMeters: path.descend,
			coordinates,
			surfaceDetails: normalizeDetailIntervals(path.details?.surface),
			smoothnessDetails: normalizeDetailIntervals(path.details?.smoothness),
		},
		snappedWaypoints,
	};
}

export const POST: RequestHandler = async ({ fetch, request }) => {
	let payload: {
		startQuery?: string;
		waypointQueries?: string[];
		destinationQuery?: string;
	};

	try {
		payload = (await request.json()) as {
			startQuery?: string;
			destinationQuery?: string;
		};
	} catch {
		return errorResponse(400, "Invalid route request payload.");
	}

	const startQuery = payload.startQuery?.trim() ?? "";
	const waypointQueries = Array.isArray(payload.waypointQueries)
		? payload.waypointQueries.map((query) =>
				typeof query === "string" ? query.trim() : "",
			)
		: [];
	const destinationQuery = payload.destinationQuery?.trim() ?? "";
	const fieldErrors: RouteApiError["fieldErrors"] = {};

	if (waypointQueries.length > maxWaypoints) {
		fieldErrors.waypointQueries = waypointQueries.map(() => "");
		return errorResponse(
			400,
			`You can add up to ${maxWaypoints} waypoints per route.`,
			fieldErrors,
		);
	}

	if (!startQuery) {
		fieldErrors.startQuery = "Enter a start point.";
	}

	const waypointFieldErrors = waypointQueries.map((query) =>
		query ? null : "Enter a waypoint or remove this stop.",
	);

	if (waypointFieldErrors.some((error) => !!error)) {
		fieldErrors.waypointQueries = waypointFieldErrors.map(
			(error) => error ?? "",
		);
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
		const stops: RouteStop[] = [
			{ kind: "start", query: startQuery, field: "startQuery" },
			...waypointQueries.map((query, index) => ({
				kind: "waypoint" as const,
				query,
				field: "waypointQueries" as const,
				index,
			})),
			{
				kind: "destination",
				query: destinationQuery,
				field: "destinationQuery",
			},
		];

		const resolvedStops = await Promise.all(
			stops.map(async (stop) => {
				const resolved = await geocodeLocation(fetch, stop.query);
				return resolved
					? {
							...stop,
							label: resolved.label,
							point: resolved.point,
						}
					: stop;
			}),
		);

		const unresolvedWaypoints = waypointQueries.map(() => "");

		for (const stop of resolvedStops) {
			if (stop.label && stop.point) {
				continue;
			}

			if (stop.field === "startQuery") {
				fieldErrors.startQuery = "We couldn't resolve that start point.";
				continue;
			}

			if (stop.field === "destinationQuery") {
				fieldErrors.destinationQuery = "We couldn't resolve that destination.";
				continue;
			}

			if (typeof stop.index === "number") {
				unresolvedWaypoints[stop.index] = "We couldn't resolve that waypoint.";
			}
		}

		if (unresolvedWaypoints.some((error) => error.length > 0)) {
			fieldErrors.waypointQueries = unresolvedWaypoints;
		}

		if (
			fieldErrors.startQuery ||
			fieldErrors.destinationQuery ||
			fieldErrors.waypointQueries
		) {
			return errorResponse(
				422,
				"We couldn't resolve one or more locations.",
				fieldErrors,
			);
		}

		const routePoints = resolvedStops.map(
			(stop) => stop.point as [number, number],
		);
		const { route, snappedWaypoints } = await requestRoute(fetch, routePoints);

		route.startLabel = resolvedStops[0]?.label ?? "";
		route.destinationLabel =
			resolvedStops[resolvedStops.length - 1]?.label ?? "";
		route.waypoints = resolvedStops.slice(1, -1).map(
			(stop, index): RouteWaypoint => ({
				label: stop.label ?? stop.query,
				coordinate:
					snappedWaypoints[index + 1] ?? (stop.point as [number, number]),
			}),
		);

		return json({
			route,
		});
	} catch (error) {
		console.error("Failed to generate GraphHopper route", error);

		if (
			error instanceof Error &&
			error.message === missingGraphHopperApiKeyMessage
		) {
			return errorResponse(
				500,
				"Routing is not configured yet. Add GRAPHHOPPER_API_KEY.",
			);
		}

		if (
			error instanceof Error &&
			error.message.includes("Too many points for Routing API")
		) {
			return errorResponse(
				400,
				`Your current routing plan allows up to ${maxRoutePoints} total route points (${maxWaypoints} waypoints plus start and destination).`,
			);
		}

		return errorResponse(
			502,
			"GraphHopper could not generate a route right now.",
		);
	}
};
