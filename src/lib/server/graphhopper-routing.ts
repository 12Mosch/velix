import { Effect, Result } from "effect";

import type {
	PlannedRoute,
	ResolvedRouteAvoidance,
	ResolvedRouteSpatialConstraint,
	RoundCourseTarget,
	RouteCoordinate,
	RouteDetailInterval,
	RouteInstruction,
	RouteMode,
	RouteWarning,
} from "$lib/route-planning";
import { mapGraphHopperSignToInstructionType } from "$lib/route-planning";
import {
	runServerEffect,
	readResponseTextEffect,
} from "$lib/server/effect-runtime";
import {
	GraphHopperRouteIncompleteError,
	GraphHopperRouteFetchError,
	GraphHopperRoutePayloadError,
	GraphHopperRouteStatusError,
	GraphHopperRouteStrategyError,
	type GraphHopperRouteBoundaryError,
} from "$lib/server/graphhopper-errors";
import { GraphHopperConfig } from "$lib/server/graphhopper-config";
import { GraphHopperLive } from "$lib/server/layers";
import { ServerFetch, TimeoutFetch } from "$lib/server/resilience";

type GraphHopperPath = {
	bbox?: number[];
	distance?: number;
	time?: number;
	ascend?: number;
	descend?: number;
	points?: {
		coordinates?: RouteCoordinate[];
	};
	instructions?: Array<{
		distance?: number;
		time?: number;
		text?: string;
		sign?: number;
		interval?: [number, number] | number[];
	}>;
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
	instructions: true;
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
	avoidances?: ResolvedRouteAvoidance[];
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

function routingWarningsAsProviderWarnings(
	routingWarnings: string[],
): RouteWarning[] {
	return routingWarnings.map((message) => ({
		category: "routing_provider",
		code: "routing_profile_fallback",
		severity: "info",
		title: "Routing fallback",
		message,
	}));
}

function buildRoadBikeCustomModel(
	spatialConstraint?: ResolvedRouteSpatialConstraint,
	avoidances: ResolvedRouteAvoidance[] = [],
): GraphHopperCustomModel {
	const avoidancePriorityRules = avoidances.map((_, index) => ({
		if: `in_avoid_road_${index}`,
		multiply_by: "0",
	}));
	const priority: GraphHopperPriorityRule[] = spatialConstraint
		? [
				...avoidancePriorityRules,
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
		: [...avoidancePriorityRules, ...roadBikePriorityRules];
	const areaFeatures: NonNullable<GraphHopperCustomModel["areas"]>["features"] =
		[
			...(spatialConstraint
				? [
						{
							type: "Feature" as const,
							id: "route_constraint",
							properties: {},
							geometry: {
								type: "Polygon" as const,
								coordinates: [spatialConstraint.polygon],
							},
						},
					]
				: []),
			...avoidances.map((avoidance, index) => ({
				type: "Feature" as const,
				id: `avoid_road_${index}`,
				properties: {},
				geometry: {
					type: "Polygon" as const,
					coordinates: [avoidance.polygon],
				},
			})),
		];

	return {
		priority,
		distance_influence: 55,
		...(areaFeatures.length > 0
			? {
					areas: {
						type: "FeatureCollection" as const,
						features: areaFeatures,
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

function normalizeGraphHopperInstructions(
	instructions: GraphHopperPath["instructions"],
	coordinates: RouteCoordinate[],
): RouteInstruction[] {
	if (!instructions || coordinates.length === 0) {
		return [];
	}

	let distanceFromStartMeters = 0;
	const maxCoordinateIndex = coordinates.length - 1;
	const normalizedInstructions: RouteInstruction[] = [];

	for (const instruction of instructions) {
		const text = instruction.text?.trim();
		const { sign, distance, time, interval } = instruction;

		if (
			!text ||
			!Number.isFinite(sign) ||
			!Number.isFinite(distance) ||
			(distance as number) < 0 ||
			!Number.isFinite(time) ||
			(time as number) < 0 ||
			!Array.isArray(interval) ||
			interval.length < 2 ||
			!Number.isFinite(interval[0]) ||
			!Number.isFinite(interval[1])
		) {
			continue;
		}

		const truncatedStart = Math.trunc(interval[0]);
		const truncatedEnd = Math.trunc(interval[1]);

		if (truncatedStart > truncatedEnd) {
			continue;
		}

		const coordinateIndex = Math.min(
			maxCoordinateIndex,
			Math.max(0, truncatedStart),
		);
		const coordinate = coordinates[coordinateIndex];

		if (!coordinate) {
			continue;
		}

		const normalizedSign = sign as number;
		const segmentDistanceMeters = Math.max(0, distance as number);
		const segmentTimeMs = time as number;

		normalizedInstructions.push({
			distanceFromStartMeters,
			text,
			sign: normalizedSign,
			type: mapGraphHopperSignToInstructionType(normalizedSign),
			segmentDistanceMeters,
			segmentTimeMs,
			coordinateIndex,
			coordinate,
			interval: [truncatedStart, truncatedEnd],
		});
		distanceFromStartMeters += segmentDistanceMeters;
	}

	return normalizedInstructions;
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
			avoidances: options.avoidances,
			routingProfile: selectedStrategy.profile,
			routingStrategy: selectedStrategy.routingStrategy,
			warnings: routingWarningsAsProviderWarnings(
				selectedStrategy.routingWarnings,
			),
			waypoints: [],
			bounds: [bbox[0], bbox[1], bbox[2], bbox[3]],
			distanceMeters: path.distance,
			durationMs: path.time,
			ascendMeters: path.ascend,
			descendMeters: path.descend,
			coordinates,
			instructions: normalizeGraphHopperInstructions(
				path.instructions,
				coordinates,
			),
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
	routeUrl: string,
	body: GraphHopperRouteRequestBody,
	timeoutMs: number,
): Effect.Effect<
	GraphHopperRouteResponse,
	| GraphHopperRouteFetchError
	| GraphHopperRouteStatusError
	| GraphHopperRoutePayloadError,
	TimeoutFetch
> {
	return Effect.gen(function* () {
		const timeoutFetch = yield* TimeoutFetch;
		const response = yield* Effect.mapError(
			timeoutFetch.fetch(
				routeUrl,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
					},
					body: JSON.stringify(body),
				},
				timeoutMs,
			),
			(cause) => new GraphHopperRouteFetchError(cause),
		);

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
	points: [number, number][],
	options: RouteRequestOptions,
): Effect.Effect<
	RouteRequestResult,
	GraphHopperRouteBoundaryError,
	GraphHopperConfig | TimeoutFetch
> {
	return Effect.gen(function* () {
		const config = yield* GraphHopperConfig;
		const key = yield* config.apiKey;

		const routeUrl = `${config.apiBaseUrl}/route?key=${encodeURIComponent(key)}`;
		function buildRouteRequestBody(
			strategy: RouteRequestStrategy,
		): GraphHopperRouteRequestBody {
			const requestBody: GraphHopperRouteRequestBody = {
				profile: strategy.profile,
				points,
				points_encoded: false,
				elevation: true,
				instructions: true,
				calc_points: true,
				details: routeDetailKeys,
			};

			if (strategy.useCustomModel) {
				requestBody.snap_preventions = ["ferry", "tunnel"];
				requestBody["ch.disable"] = true;
				requestBody.custom_model = buildRoadBikeCustomModel(
					options.spatialConstraint,
					options.avoidances,
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
		const requiresCustomModel =
			!!options.spatialConstraint || (options.avoidances?.length ?? 0) > 0;
		const strategies = requiresCustomModel
			? routeRequestStrategies.filter((strategy) => strategy.useCustomModel)
			: routeRequestStrategies;

		for (const strategy of strategies) {
			const routeResult = yield* Effect.result(
				sendRouteRequestEffect(
					routeUrl,
					buildRouteRequestBody(strategy),
					config.routeTimeoutMs,
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

			console.warn(
				`GraphHopper rejected ${strategy.profile}${strategy.useCustomModel ? " with road-bike tuning" : " routing"}. Trying the next routing strategy.`,
				error,
			);
		}

		if (!payload || !selectedStrategy) {
			return yield* Effect.fail(new GraphHopperRouteStrategyError());
		}

		const normalizedRoutes = (payload.paths ?? [])
			.map((path) =>
				normalizeGraphHopperPath(path, points, options, selectedStrategy),
			)
			.filter((route): route is NormalizedGraphHopperRoute => route !== null);

		if (normalizedRoutes.length === 0) {
			return yield* Effect.fail(new GraphHopperRouteIncompleteError());
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
	return runServerEffect(
		requestRoutesEffect(points, options).pipe(
			Effect.provide(GraphHopperLive),
			Effect.provideService(ServerFetch, { fetch: fetchFn }),
		),
	);
}
