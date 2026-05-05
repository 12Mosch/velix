import { env } from "$env/dynamic/private";
import { Effect, Result } from "effect";

import type {
	PlannedRoute,
	ResolvedRouteSpatialConstraint,
	RoundCourseTarget,
	RouteCoordinate,
	RouteDetailInterval,
	RouteMode,
} from "$lib/route-planning";
import {
	runServerEffect,
	readResponseTextEffect,
} from "$lib/server/effect-runtime";
import {
	GraphHopperRouteFetchError,
	GraphHopperRoutePayloadError,
	GraphHopperRouteStatusError,
	MissingGraphHopperApiKeyError,
	type GraphHopperRouteBoundaryError,
} from "$lib/server/graphhopper-errors";
import { fetchWithTimeout } from "$lib/server/resilience";

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

type GraphHopperPriorityRule = {
	if?: string;
	else?: string;
	multiply_by: string;
};

type GraphHopperCustomModel = {
	priority: GraphHopperPriorityRule[];
	distance_influence: number;
	areas?: {
		type: "FeatureCollection";
		features: Array<{
			type: "Feature";
			id: string;
			properties: Record<string, never>;
			geometry: {
				type: "Polygon";
				coordinates: [number, number][][];
			};
		}>;
	};
};

type GraphHopperRouteRequestBody = {
	profile: "bike" | "racingbike";
	points: [number, number][];
	points_encoded: false;
	elevation: true;
	instructions: false;
	calc_points: true;
	details: typeof routeDetailKeys;
	snap_preventions?: string[];
	"ch.disable"?: true;
	custom_model?: GraphHopperCustomModel;
	algorithm?: "round_trip" | "alternative_route";
	"round_trip.distance"?: number;
	"round_trip.seed"?: number;
	"alternative_route.max_paths"?: number;
	"alternative_route.max_weight_factor"?: number;
	"alternative_route.max_share_factor"?: number;
};

type GraphHopperProfile = GraphHopperRouteRequestBody["profile"];

type RouteRequestStrategy = {
	profile: GraphHopperProfile;
	useCustomModel: boolean;
	routingStrategy: string;
	routingWarnings: string[];
};

export type RouteRequestOptions = {
	mode: RouteMode;
	roundTripDistanceMeters?: number;
	roundTripSeed?: number;
	roundCourseTarget?: RoundCourseTarget;
	spatialConstraint?: ResolvedRouteSpatialConstraint;
	alternativeMaxPaths?: number;
	alternativeMaxWeightFactor?: number;
	alternativeMaxShareFactor?: number;
};

type NormalizedGraphHopperRoute = {
	route: PlannedRoute;
	snappedWaypoints: RouteCoordinate[];
};

export type RouteRequestResult = {
	routes: PlannedRoute[];
	snappedWaypointSets: RouteCoordinate[][];
};

const graphHopperApiBaseUrl = "https://graphhopper.com/api/1";
const routeTimeoutMs = 20_000;
const routeDetailKeys = [
	"surface",
	"smoothness",
	"road_class",
	"road_environment",
	"road_access",
	"bike_network",
] as const;

const roadBikePriorityRules: GraphHopperPriorityRule[] = [
	{
		if: "road_access == PRIVATE",
		multiply_by: "0",
	},
	{
		if: "road_environment == FERRY || road_environment == TUNNEL",
		multiply_by: "0.05",
	},
	{
		if: "road_class == TRACK || road_class == PATH || road_class == FOOTWAY || road_class == STEPS",
		multiply_by: "0.02",
	},
	{
		if: "road_class == TRUNK || road_class == PRIMARY",
		multiply_by: "0.3",
	},
	{
		if: "road_class == LIVING_STREET || road_class == RESIDENTIAL || road_class == SERVICE",
		multiply_by: "0.7",
	},
	{
		if: "surface == DIRT || surface == GROUND || surface == GRAVEL || surface == SAND || surface == MUD || surface == GRASS || surface == EARTH || surface == UNPAVED",
		multiply_by: "0.02",
	},
	{
		if: "surface == COBBLESTONE || surface == SETT || surface == UNHEWN_COBBLESTONE || surface == PAVING_STONES",
		multiply_by: "0.2",
	},
	{
		if: "smoothness == BAD || smoothness == VERY_BAD || smoothness == HORRIBLE || smoothness == VERY_HORRIBLE || smoothness == IMPASSABLE",
		multiply_by: "0.1",
	},
];

const routeRequestStrategies: RouteRequestStrategy[] = [
	{
		profile: "racingbike",
		useCustomModel: true,
		routingStrategy:
			"GraphHopper racingbike with asphalt-first, lower-traffic road-bike tuning.",
		routingWarnings: [],
	},
	{
		profile: "racingbike",
		useCustomModel: false,
		routingStrategy: "GraphHopper racingbike base profile.",
		routingWarnings: [
			"Advanced paved-road tuning was unavailable, so the built-in racingbike profile was used.",
		],
	},
	{
		profile: "bike",
		useCustomModel: true,
		routingStrategy:
			"GraphHopper bike with asphalt-first, lower-traffic road-bike tuning.",
		routingWarnings: [
			"GraphHopper did not accept the racingbike profile for this route, so tuned bike routing was used instead.",
		],
	},
	{
		profile: "bike",
		useCustomModel: false,
		routingStrategy: "GraphHopper default bike profile.",
		routingWarnings: [
			"Advanced road-bike routing was unavailable for this route, so GraphHopper's default bike profile was used.",
		],
	},
];

function getGraphHopperRouteApiKeyEffect(): Effect.Effect<
	string,
	MissingGraphHopperApiKeyError
> {
	return Effect.gen(function* () {
		const key = env.GRAPHHOPPER_API_KEY?.trim();

		if (!key) {
			return yield* Effect.fail(new MissingGraphHopperApiKeyError());
		}

		return key;
	});
}

function buildRoadBikeCustomModel(
	spatialConstraint?: ResolvedRouteSpatialConstraint,
): GraphHopperCustomModel {
	const priority: GraphHopperPriorityRule[] = spatialConstraint
		? [
				{
					if: "in_route_constraint",
					multiply_by: "1",
				},
				{
					else: "",
					multiply_by:
						spatialConstraint.enforcement === "strict" ? "0" : "0.08",
				},
				...roadBikePriorityRules,
			]
		: [...roadBikePriorityRules];

	return {
		priority,
		distance_influence: 55,
		...(spatialConstraint
			? {
					areas: {
						type: "FeatureCollection" as const,
						features: [
							{
								type: "Feature" as const,
								id: "route_constraint",
								properties: {},
								geometry: {
									type: "Polygon" as const,
									coordinates: [spatialConstraint.polygon],
								},
							},
						],
					},
				}
			: {}),
	};
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

function normalizeGraphHopperPath(
	path: GraphHopperPath,
	points: [number, number][],
	options: RouteRequestOptions,
	selectedStrategy: RouteRequestStrategy,
): NormalizedGraphHopperRoute | null {
	const coordinates = path.points?.coordinates;
	const snappedWaypoints = path.snapped_waypoints?.coordinates;
	const bbox = path.bbox;
	const normalizedSnappedWaypoints =
		snappedWaypoints && snappedWaypoints.length === points.length
			? snappedWaypoints
			: points.map((point): RouteCoordinate => [point[0], point[1]]);

	if (
		!bbox ||
		bbox.length < 4 ||
		!coordinates ||
		coordinates.length < 2 ||
		typeof path.distance !== "number" ||
		typeof path.time !== "number" ||
		typeof path.ascend !== "number" ||
		typeof path.descend !== "number"
	) {
		return null;
	}

	return {
		route: {
			mode: options.mode,
			source: {
				kind: "graphhopper",
			},
			startLabel: "",
			destinationLabel: "",
			roundCourseTarget:
				options.mode === "round_course" ? options.roundCourseTarget : undefined,
			spatialConstraint: options.spatialConstraint,
			routingProfile: selectedStrategy.profile,
			routingStrategy: selectedStrategy.routingStrategy,
			routingWarnings: [...selectedStrategy.routingWarnings],
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
		snappedWaypoints: normalizedSnappedWaypoints,
	};
}

function readRoutePayloadEffect(
	response: Response,
): Effect.Effect<GraphHopperRouteResponse, GraphHopperRoutePayloadError> {
	return Effect.tryPromise({
		try: () => response.json() as Promise<GraphHopperRouteResponse>,
		catch: (cause) => new GraphHopperRoutePayloadError(cause),
	});
}

function sendRouteRequestEffect(
	fetchFn: typeof fetch,
	routeUrl: string,
	body: GraphHopperRouteRequestBody,
): Effect.Effect<
	GraphHopperRouteResponse,
	| GraphHopperRouteFetchError
	| GraphHopperRouteStatusError
	| GraphHopperRoutePayloadError
> {
	return Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			try: () =>
				fetchWithTimeout(
					fetchFn,
					routeUrl,
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
						},
						body: JSON.stringify(body),
					},
					routeTimeoutMs,
				),
			catch: (cause) => new GraphHopperRouteFetchError(cause),
		});

		if (!response.ok) {
			const details = yield* readResponseTextEffect(response);
			return yield* Effect.fail(
				new GraphHopperRouteStatusError(response.status, details),
			);
		}

		return yield* readRoutePayloadEffect(response);
	});
}

export function requestRoutesEffect(
	fetchFn: typeof fetch,
	points: [number, number][],
	options: RouteRequestOptions,
): Effect.Effect<RouteRequestResult, GraphHopperRouteBoundaryError> {
	return Effect.gen(function* () {
		const key = yield* getGraphHopperRouteApiKeyEffect();

		const routeUrl = `${graphHopperApiBaseUrl}/route?key=${encodeURIComponent(key)}`;
		function buildRouteRequestBody(
			strategy: RouteRequestStrategy,
		): GraphHopperRouteRequestBody {
			const requestBody: GraphHopperRouteRequestBody = {
				profile: strategy.profile,
				points,
				points_encoded: false,
				elevation: true,
				instructions: false,
				calc_points: true,
				details: routeDetailKeys,
			};

			if (strategy.useCustomModel) {
				requestBody.snap_preventions = ["ferry", "tunnel"];
				requestBody["ch.disable"] = true;
				requestBody.custom_model = buildRoadBikeCustomModel(
					options.spatialConstraint,
				);
			}

			if (options.mode === "round_course") {
				requestBody.algorithm = "round_trip";
				requestBody["round_trip.distance"] = Math.round(
					options.roundTripDistanceMeters ?? 0,
				);

				if (typeof options.roundTripSeed === "number") {
					requestBody["round_trip.seed"] = options.roundTripSeed;
				}
			} else if ((options.alternativeMaxPaths ?? 1) > 1) {
				requestBody.algorithm = "alternative_route";
				requestBody["alternative_route.max_paths"] =
					options.alternativeMaxPaths;
				requestBody["alternative_route.max_weight_factor"] =
					options.alternativeMaxWeightFactor;
				requestBody["alternative_route.max_share_factor"] =
					options.alternativeMaxShareFactor;
			}

			return requestBody;
		}

		let payload: GraphHopperRouteResponse | null = null;
		let selectedStrategy: RouteRequestStrategy | null = null;
		let lastError: GraphHopperRouteBoundaryError | null = null;
		const strategies = options.spatialConstraint
			? routeRequestStrategies.filter((strategy) => strategy.useCustomModel)
			: routeRequestStrategies;

		for (const strategy of strategies) {
			const routeResult = yield* Effect.result(
				sendRouteRequestEffect(
					fetchFn,
					routeUrl,
					buildRouteRequestBody(strategy),
				),
			);

			if (Result.isSuccess(routeResult)) {
				payload = routeResult.success;
				selectedStrategy = strategy;
				break;
			}

			const error = routeResult.failure;
			const message = error.message;

			if (message.includes("Too many points for Routing API")) {
				return yield* Effect.fail(error);
			}

			if (
				error._tag !== "GraphHopperRouteStatusError" ||
				error.status !== 400
			) {
				return yield* Effect.fail(error);
			}

			lastError = error;
			console.warn(
				`GraphHopper rejected ${strategy.profile}${strategy.useCustomModel ? " with road-bike tuning" : " routing"}. Trying the next routing strategy.`,
				error,
			);
		}

		if (!payload || !selectedStrategy) {
			return yield* Effect.fail(
				lastError instanceof Error
					? lastError
					: new Error("GraphHopper did not accept any routing strategy"),
			);
		}

		const normalizedRoutes = (payload.paths ?? [])
			.map((path) =>
				normalizeGraphHopperPath(path, points, options, selectedStrategy),
			)
			.filter((route): route is NormalizedGraphHopperRoute => route !== null);

		if (normalizedRoutes.length === 0) {
			return yield* Effect.fail(
				new Error("GraphHopper route response was incomplete"),
			);
		}

		return {
			routes: normalizedRoutes.map(({ route }) => route),
			snappedWaypointSets: normalizedRoutes.map(
				({ snappedWaypoints }) => snappedWaypoints,
			),
		};
	});
}

export async function requestRoutes(
	fetchFn: typeof fetch,
	points: [number, number][],
	options: RouteRequestOptions,
): Promise<RouteRequestResult> {
	return runServerEffect(requestRoutesEffect(fetchFn, points, options));
}
