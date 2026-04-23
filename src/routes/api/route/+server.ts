import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import type {
	PlannedRoute,
	RoundCourseTarget,
	RouteApiError,
	RouteCoordinate,
	RouteDetailInterval,
	RouteMode,
	RouteRequestPayload,
	RouteStopInput,
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
	profile: "bike" | "racingbike";
	points: [number, number][];
	points_encoded: false;
	elevation: true;
	instructions: false;
	calc_points: true;
	details: typeof routeDetailKeys;
	snap_preventions?: string[];
	"ch.disable"?: true;
	custom_model?: typeof roadBikeCustomModel;
	algorithm?: "round_trip";
	"round_trip.distance"?: number;
	"round_trip.seed"?: number;
};
type GraphHopperProfile = GraphHopperRouteRequestBody["profile"];
type RouteRequestStrategy = {
	profile: GraphHopperProfile;
	useCustomModel: boolean;
	routingStrategy: string;
	routingWarnings: string[];
};

const maxRoutePoints = 5;
const maxWaypoints = maxRoutePoints - 2;
const routeDetailKeys = [
	"surface",
	"smoothness",
	"road_class",
	"road_environment",
	"road_access",
	"bike_network",
] as const;
type LegacyRouteRequestPayload = {
	startQuery?: string;
	waypointQueries?: string[];
	destinationQuery?: string;
};

type RoundCourseRouteRequestPayloadInput = {
	mode?: "round_course";
	start?: RouteStopInput;
	target?: unknown;
	requestedDistanceMeters?: unknown;
};

type StopField = "startQuery" | "destinationQuery" | "waypointQueries";
type RouteStop = {
	kind: "start" | "waypoint" | "destination";
	input: RouteStopInput;
	field: StopField;
	index?: number;
	label?: string;
	point?: [number, number];
};

type CandidateRouteResult = {
	route: PlannedRoute;
	requestedDistanceMeters: number;
	sequence: number;
};

const minRoundCourseDurationMs = 15 * 60 * 1000;
const minRoundCourseAscendMeters = 50;
const minRoundCourseDistanceMeters = 10_000;
const maxRoundCourseDistanceMeters = 220_000;
const durationTargetSpeedMetersPerHour = 22_000;
const ascendTargetMetersPerKm = 12;
const roundCourseSearchDistanceMultipliers = [0.9, 1, 1.1] as const;
const roundCourseSearchSeeds = [
	[11, 37, 73],
	[109, 149, 191],
] as const;

const roadBikeCustomModel = {
	priority: [
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
	],
	distance_influence: 55,
} as const;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function normalizeFiniteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

function clampRoundCourseDistanceMeters(distanceMeters: number): number {
	return Math.min(
		maxRoundCourseDistanceMeters,
		Math.max(minRoundCourseDistanceMeters, distanceMeters),
	);
}

function getRoundCourseTargetError(rawTarget: unknown): string {
	if (isRecord(rawTarget) && rawTarget.kind === "duration") {
		return "Enter a target time.";
	}

	if (isRecord(rawTarget) && rawTarget.kind === "ascend") {
		return "Enter a target climb.";
	}

	return "Enter a target distance.";
}

function normalizeRoundCourseTarget(
	payloadRecord: Record<string, unknown>,
): RoundCourseTarget | null {
	if ("target" in payloadRecord) {
		const rawTarget = payloadRecord.target;

		if (!isRecord(rawTarget) || typeof rawTarget.kind !== "string") {
			return null;
		}

		if (rawTarget.kind === "distance") {
			const distanceMeters = normalizeFiniteNumber(rawTarget.distanceMeters);
			return distanceMeters === null
				? null
				: {
						kind: "distance",
						distanceMeters,
					};
		}

		if (rawTarget.kind === "duration") {
			const durationMs = normalizeFiniteNumber(rawTarget.durationMs);
			return durationMs === null
				? null
				: {
						kind: "duration",
						durationMs,
					};
		}

		if (rawTarget.kind === "ascend") {
			const ascendMeters = normalizeFiniteNumber(rawTarget.ascendMeters);
			return ascendMeters === null
				? null
				: {
						kind: "ascend",
						ascendMeters,
					};
		}

		return null;
	}

	if ("requestedDistanceMeters" in payloadRecord) {
		const distanceMeters = normalizeFiniteNumber(
			payloadRecord.requestedDistanceMeters,
		);
		return distanceMeters === null
			? null
			: {
					kind: "distance",
					distanceMeters,
				};
	}

	return null;
}

function estimateRoundCourseDistanceMeters(target: RoundCourseTarget): number {
	if (target.kind === "distance") {
		return target.distanceMeters;
	}

	if (target.kind === "duration") {
		return (
			(target.durationMs / (60 * 60 * 1000)) * durationTargetSpeedMetersPerHour
		);
	}

	return (target.ascendMeters / ascendTargetMetersPerKm) * 1000;
}

function getRoundCourseTargetRelativeError(
	route: PlannedRoute,
	target: RoundCourseTarget,
): number {
	if (target.kind === "duration") {
		return Math.abs(route.durationMs - target.durationMs) / target.durationMs;
	}

	if (target.kind === "ascend") {
		return (
			Math.abs(route.ascendMeters - target.ascendMeters) / target.ascendMeters
		);
	}

	return (
		Math.abs(route.distanceMeters - target.distanceMeters) /
		target.distanceMeters
	);
}

function getRequestedDistanceRelativeError(
	route: PlannedRoute,
	requestedDistanceMeters: number,
): number {
	return (
		Math.abs(route.distanceMeters - requestedDistanceMeters) /
		Math.max(requestedDistanceMeters, 1)
	);
}

function compareCandidateRoutes(
	left: CandidateRouteResult,
	right: CandidateRouteResult,
	target: RoundCourseTarget,
): number {
	const targetErrorDifference =
		getRoundCourseTargetRelativeError(left.route, target) -
		getRoundCourseTargetRelativeError(right.route, target);

	if (Math.abs(targetErrorDifference) > 1e-9) {
		return targetErrorDifference;
	}

	const requestedDistanceErrorDifference =
		getRequestedDistanceRelativeError(
			left.route,
			left.requestedDistanceMeters,
		) -
		getRequestedDistanceRelativeError(
			right.route,
			right.requestedDistanceMeters,
		);

	if (Math.abs(requestedDistanceErrorDifference) > 1e-9) {
		return requestedDistanceErrorDifference;
	}

	const leftDurationError =
		target.kind === "duration"
			? Math.abs(left.route.durationMs - target.durationMs)
			: left.route.durationMs;
	const rightDurationError =
		target.kind === "duration"
			? Math.abs(right.route.durationMs - target.durationMs)
			: right.route.durationMs;
	const durationErrorDifference = leftDurationError - rightDurationError;

	if (Math.abs(durationErrorDifference) > 1e-9) {
		return durationErrorDifference;
	}

	return left.sequence - right.sequence;
}

function formatDurationWarning(durationMs: number): string {
	const totalMinutes = Math.round(durationMs / 60000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	return `${hours}:${minutes.toString().padStart(2, "0")} h`;
}

function buildRoundCourseMissWarning(
	route: PlannedRoute,
	target: RoundCourseTarget,
): string | null {
	if (target.kind === "distance") {
		return null;
	}

	const relativeError = getRoundCourseTargetRelativeError(route, target);

	if (relativeError <= 0.15) {
		return null;
	}

	if (target.kind === "duration") {
		return `Requested ${formatDurationWarning(target.durationMs)}, but the closest round course came out to ${formatDurationWarning(route.durationMs)}.`;
	}

	return `Requested ${Math.round(target.ascendMeters).toLocaleString()} m up, but the closest round course came out to ${Math.round(route.ascendMeters).toLocaleString()} m up.`;
}

async function searchRoundCourseRoute(
	fetchFn: typeof fetch,
	startPoint: [number, number],
	target: RoundCourseTarget,
): Promise<PlannedRoute> {
	let baseDistanceMeters = clampRoundCourseDistanceMeters(
		estimateRoundCourseDistanceMeters(target),
	);
	const successfulCandidates: CandidateRouteResult[] = [];
	let sequence = 0;
	let lastError: unknown = null;

	for (const [roundIndex, seeds] of roundCourseSearchSeeds.entries()) {
		const requestedDistances = roundCourseSearchDistanceMultipliers.map(
			(multiplier) =>
				clampRoundCourseDistanceMeters(baseDistanceMeters * multiplier),
		);
		const candidateResults = await Promise.allSettled(
			requestedDistances.map((requestedDistanceMeters, candidateIndex) => {
				const candidateSequence = sequence++;
				return requestRoute(fetchFn, [startPoint], {
					mode: "round_course",
					roundTripDistanceMeters: requestedDistanceMeters,
					roundTripSeed: seeds[candidateIndex],
					roundCourseTarget: target,
				}).then(({ route }) => ({
					route,
					requestedDistanceMeters,
					sequence: candidateSequence,
				}));
			}),
		);

		for (const candidateResult of candidateResults) {
			if (candidateResult.status === "fulfilled") {
				successfulCandidates.push(candidateResult.value);
				continue;
			}

			lastError = candidateResult.reason;
		}

		if (roundIndex === 0 && successfulCandidates.length > 0) {
			const bestCandidate = [...successfulCandidates].sort((left, right) =>
				compareCandidateRoutes(left, right, target),
			)[0];

			if (bestCandidate) {
				baseDistanceMeters = clampRoundCourseDistanceMeters(
					target.kind === "duration"
						? (bestCandidate.requestedDistanceMeters * target.durationMs) /
								Math.max(bestCandidate.route.durationMs, 1)
						: target.kind === "ascend"
							? (bestCandidate.requestedDistanceMeters * target.ascendMeters) /
								Math.max(bestCandidate.route.ascendMeters, 1)
							: bestCandidate.requestedDistanceMeters,
				);
			}
		}
	}

	if (successfulCandidates.length === 0) {
		throw lastError instanceof Error
			? lastError
			: new Error("GraphHopper could not generate a round course right now.");
	}

	const bestCandidate = [...successfulCandidates].sort((left, right) =>
		compareCandidateRoutes(left, right, target),
	)[0];

	if (!bestCandidate) {
		throw new Error("GraphHopper could not generate a round course right now.");
	}

	const missWarning = buildRoundCourseMissWarning(bestCandidate.route, target);

	if (missWarning) {
		bestCandidate.route.routingWarnings = [
			...(bestCandidate.route.routingWarnings ?? []),
			missWarning,
		];
	}

	return bestCandidate.route;
}

function normalizeStopInput(value: unknown): RouteStopInput {
	if (typeof value === "string") {
		return {
			label: value.trim(),
		};
	}

	if (!value || typeof value !== "object") {
		return {
			label: "",
		};
	}

	const candidate = value as {
		label?: unknown;
		point?: unknown;
	};
	const point = Array.isArray(candidate.point) ? candidate.point : undefined;

	return {
		label: typeof candidate.label === "string" ? candidate.label.trim() : "",
		point:
			point &&
			point.length >= 2 &&
			typeof point[0] === "number" &&
			Number.isFinite(point[0]) &&
			typeof point[1] === "number" &&
			Number.isFinite(point[1])
				? [point[0], point[1]]
				: undefined,
	};
}

async function requestRoute(
	fetchFn: typeof fetch,
	points: [number, number][],
	options: {
		mode: RouteMode;
		roundTripDistanceMeters?: number;
		roundTripSeed?: number;
		roundCourseTarget?: RoundCourseTarget;
	},
): Promise<{
	route: PlannedRoute;
	snappedWaypoints: RouteCoordinate[];
}> {
	const key = env.GRAPHHOPPER_API_KEY?.trim();

	if (!key) {
		throw new Error(missingGraphHopperApiKeyMessage);
	}

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
			requestBody.custom_model = roadBikeCustomModel;
		}

		if (options.mode === "round_course") {
			requestBody.algorithm = "round_trip";
			requestBody["round_trip.distance"] = Math.round(
				options.roundTripDistanceMeters ?? 0,
			);

			if (typeof options.roundTripSeed === "number") {
				requestBody["round_trip.seed"] = options.roundTripSeed;
			}
		}

		return requestBody;
	}

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

	let payload: GraphHopperRouteResponse | null = null;
	let selectedStrategy: RouteRequestStrategy | null = null;
	let lastError: unknown = null;

	for (const strategy of routeRequestStrategies) {
		try {
			payload = await sendRouteRequest(buildRouteRequestBody(strategy));
			selectedStrategy = strategy;
			break;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			if (message.includes("Too many points for Routing API")) {
				throw error;
			}

			if (!message.includes("Routing failed with status 400")) {
				throw error;
			}

			lastError = error;
			console.warn(
				`GraphHopper rejected ${strategy.profile}${strategy.useCustomModel ? " with road-bike tuning" : " routing"}. Trying the next routing strategy.`,
				error,
			);
		}
	}

	if (!payload || !selectedStrategy) {
		throw lastError instanceof Error
			? lastError
			: new Error("GraphHopper did not accept any routing strategy");
	}

	const path = payload.paths?.[0];
	const coordinates = path?.points?.coordinates;
	const snappedWaypoints = path?.snapped_waypoints?.coordinates;
	const bbox = path?.bbox;
	const normalizedSnappedWaypoints =
		snappedWaypoints && snappedWaypoints.length === points.length
			? snappedWaypoints
			: options.mode === "round_course"
				? points.map((point): RouteCoordinate => [point[0], point[1]])
				: null;

	if (
		!path ||
		!bbox ||
		bbox.length < 4 ||
		!coordinates ||
		coordinates.length < 2 ||
		!normalizedSnappedWaypoints ||
		typeof path.distance !== "number" ||
		typeof path.time !== "number" ||
		typeof path.ascend !== "number" ||
		typeof path.descend !== "number"
	) {
		throw new Error("GraphHopper route response was incomplete");
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

export const POST: RequestHandler = async ({ fetch, request }) => {
	let payload:
		| Partial<RouteRequestPayload>
		| RoundCourseRouteRequestPayloadInput
		| LegacyRouteRequestPayload;

	try {
		payload = (await request.json()) as typeof payload;
	} catch {
		return errorResponse(400, "Invalid route request payload.");
	}

	const payloadRecord = payload as Record<string, unknown>;
	const requestedMode =
		payloadRecord.mode === "round_course" ? "round_course" : "point_to_point";
	const hasStructuredPayload =
		"start" in payloadRecord ||
		"waypoints" in payloadRecord ||
		"destination" in payloadRecord ||
		"target" in payloadRecord ||
		"requestedDistanceMeters" in payloadRecord ||
		"mode" in payloadRecord;
	const structuredPayload = hasStructuredPayload
		? (payload as Partial<RouteRequestPayload>)
		: null;
	const structuredPointToPointPayload =
		structuredPayload && requestedMode === "point_to_point"
			? (structuredPayload as Partial<
					Extract<RouteRequestPayload, { mode: "point_to_point" }>
				>)
			: null;
	const legacyPayload = hasStructuredPayload
		? null
		: (payload as LegacyRouteRequestPayload);
	const startInput = normalizeStopInput(
		structuredPayload ? structuredPayload.start : legacyPayload?.startQuery,
	);
	const fieldErrors: RouteApiError["fieldErrors"] = {};

	if (requestedMode === "round_course") {
		const roundCourseTarget = normalizeRoundCourseTarget(payloadRecord);

		if (!startInput.label) {
			fieldErrors.startQuery = "Enter a start point.";
		}

		if (!roundCourseTarget) {
			fieldErrors.roundCourseTarget = getRoundCourseTargetError(
				payloadRecord.target,
			);
		} else if (
			(roundCourseTarget.kind === "distance" &&
				roundCourseTarget.distanceMeters <= 0) ||
			(roundCourseTarget.kind === "duration" &&
				roundCourseTarget.durationMs < minRoundCourseDurationMs) ||
			(roundCourseTarget.kind === "ascend" &&
				roundCourseTarget.ascendMeters < minRoundCourseAscendMeters)
		) {
			fieldErrors.roundCourseTarget = getRoundCourseTargetError(
				payloadRecord.target,
			);
		}

		if (Object.keys(fieldErrors).length > 0) {
			return errorResponse(
				400,
				"Start and a round-course target are required.",
				fieldErrors,
			);
		}

		try {
			const resolvedStart = startInput.point
				? {
						label: startInput.label,
						point: startInput.point,
					}
				: await geocodeLocation(fetch, startInput.label);

			if (!resolvedStart?.point || !resolvedStart.label) {
				return errorResponse(422, "We couldn't resolve the start point.", {
					startQuery: "We couldn't resolve that start point.",
				});
			}

			const route =
				roundCourseTarget?.kind === "distance"
					? (
							await requestRoute(fetch, [resolvedStart.point], {
								mode: "round_course",
								roundTripDistanceMeters: roundCourseTarget.distanceMeters,
								roundCourseTarget,
							})
						).route
					: await searchRoundCourseRoute(
							fetch,
							resolvedStart.point,
							roundCourseTarget as Exclude<
								RoundCourseTarget,
								{ kind: "distance" }
							>,
						);
			route.startLabel = resolvedStart.label;
			route.destinationLabel = resolvedStart.label;
			route.waypoints = [];

			return json({
				route,
			});
		} catch (error) {
			console.error("Failed to generate GraphHopper round course", error);

			if (
				error instanceof Error &&
				error.message === missingGraphHopperApiKeyMessage
			) {
				return errorResponse(
					500,
					"Routing is not configured yet. Add GRAPHHOPPER_API_KEY.",
				);
			}

			return errorResponse(
				502,
				"GraphHopper could not generate a round course right now.",
			);
		}
	}

	const rawWaypointInputs =
		(structuredPointToPointPayload
			? structuredPointToPointPayload.waypoints
			: legacyPayload?.waypointQueries) ?? [];
	const waypointInputs = Array.isArray(rawWaypointInputs)
		? rawWaypointInputs.map((input: RouteStopInput | string | undefined) =>
				normalizeStopInput(input),
			)
		: [];
	const destinationInput = normalizeStopInput(
		structuredPointToPointPayload
			? structuredPointToPointPayload.destination
			: legacyPayload?.destinationQuery,
	);

	if (waypointInputs.length > maxWaypoints) {
		fieldErrors.waypointQueries = waypointInputs.map(() => "");
		return errorResponse(
			400,
			`You can add up to ${maxWaypoints} waypoints per route.`,
			fieldErrors,
		);
	}

	if (!startInput.label) {
		fieldErrors.startQuery = "Enter a start point.";
	}

	const waypointFieldErrors = waypointInputs.map((waypoint: RouteStopInput) =>
		waypoint.label ? null : "Enter a waypoint or remove this stop.",
	);

	if (waypointFieldErrors.some((error: string | null) => !!error)) {
		fieldErrors.waypointQueries = waypointFieldErrors.map(
			(error: string | null) => error ?? "",
		);
	}

	if (!destinationInput.label) {
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
			{ kind: "start", input: startInput, field: "startQuery" },
			...waypointInputs.map((input: RouteStopInput, index: number) => ({
				kind: "waypoint" as const,
				input,
				field: "waypointQueries" as const,
				index,
			})),
			{
				kind: "destination",
				input: destinationInput,
				field: "destinationQuery",
			},
		];

		const resolvedStops = await Promise.all(
			stops.map(async (stop) => {
				if (stop.input.point) {
					return {
						...stop,
						label: stop.input.label,
						point: stop.input.point,
					};
				}

				const resolved = await geocodeLocation(fetch, stop.input.label);
				return resolved
					? {
							...stop,
							label: resolved.label,
							point: resolved.point,
						}
					: stop;
			}),
		);

		const unresolvedWaypoints = waypointInputs.map(() => "");

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

		if (unresolvedWaypoints.some((error: string) => error.length > 0)) {
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
		const { route, snappedWaypoints } = await requestRoute(fetch, routePoints, {
			mode: "point_to_point",
		});

		route.startLabel = resolvedStops[0]?.label ?? "";
		route.destinationLabel =
			resolvedStops[resolvedStops.length - 1]?.label ?? "";
		route.waypoints = resolvedStops.slice(1, -1).map(
			(stop, index): RouteWaypoint => ({
				label: stop.label ?? stop.input.label,
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
