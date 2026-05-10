import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { Effect, Schema } from "effect";

import { parseCoordinateSearchInput } from "$lib/coordinate-search";
import {
	assertRouteApiErrorPayload,
	assertRouteApiSuccessPayload,
	decodeRouteRequestPayload,
	RoundCourseTargetSchema,
	RouteSpatialConstraintInputSchema,
	type LegacyRouteRequestPayloadInput,
	type RouteRequestPayloadInput,
} from "$lib/route-api-schema";
import type {
	ManualRouteEditingState,
	PlannedRoute,
	RoundCourseCandidateError,
	RoundCourseTarget,
	RouteApiError,
	RouteApiSuccess,
	RouteFieldErrors,
	RouteMode,
	RouteAvoidanceInput,
	RouteSpatialConstraintInput,
	RouteStopInput,
	SpatialConstraintEnforcement,
} from "$lib/route-planning";
import { runServerEffect } from "$lib/server/effect-runtime";
import {
	isGraphHopperRoutePointLimitError,
	isMissingGraphHopperApiKeyError,
} from "$lib/server/graphhopper-errors";
import { ServerLive } from "$lib/server/layers";
import {
	resolveRouteAvoidances,
	resolveRouteStopsEffect,
	resolveSpatialConstraintEffect,
	RoundCourseCandidateSearchError,
	RouteGenerationError,
	RouteValidationError,
	searchOutAndBackRoutesEffect,
	searchPointToPointRoutesEffect,
	searchRoundCourseRoutesEffect,
	SpatialConstraintValidationError,
	UnresolvedLocationError,
	type ResolvedRouteStop,
	type RouteStopResolutionInput,
} from "$lib/server/route-orchestration";
import { ServerFetch } from "$lib/server/resilience";
import { checkRouteRateLimitEffect } from "$lib/server/route-rate-limits";

const maxRoutePoints = 5;
const maxWaypoints = maxRoutePoints - 2;
const minRoundCourseDurationMs = 15 * 60 * 1000;
const minRoundCourseAscendMeters = 50;
const minRoundCourseDistanceMeters = 10_000;
const minAreaRadiusMeters = 1_000;
const maxAreaRadiusMeters = 250_000;
const minCorridorWidthMeters = 2_000;
const maxCorridorWidthMeters = 80_000;
const maxRouteAvoidances = 5;
const minRouteAvoidanceCenterlinePoints = 2;
const maxRouteAvoidanceCenterlinePoints = 32;
const defaultRouteAvoidanceBufferMeters = 35;
const minRouteAvoidanceBufferMeters = 10;
const maxRouteAvoidanceBufferMeters = 150;

type RouteRequestEvent = Parameters<RequestHandler>[0];

type RouteModeContext = {
	event: RouteRequestEvent;
	payloadRecord: Record<string, unknown>;
	startInput: RouteStopInput;
	spatialConstraintInput?: RouteSpatialConstraintInput;
	avoidanceInputs?: RouteAvoidanceInput[];
	manualEditing?: ManualRouteEditingState;
	fieldErrors: RouteFieldErrors;
	structuredPointToPointPayload: RouteRequestPayloadInput | null;
	structuredOutAndBackPayload: RouteRequestPayloadInput | null;
	legacyPayload: LegacyRouteRequestPayloadInput | null;
};

function getTooManyWaypointsMessage() {
	return `You can add up to ${maxWaypoints} waypoints per route.`;
}

function errorResponse(
	status: number,
	error: string,
	fieldErrors?: RouteApiError["fieldErrors"],
	roundCourseCandidateErrors?: RoundCourseCandidateError[],
) {
	const payload: RouteApiError = {
		error,
		...(fieldErrors === undefined ? {} : { fieldErrors }),
		...(roundCourseCandidateErrors === undefined
			? {}
			: { roundCourseCandidateErrors }),
	};

	assertRouteApiErrorPayload(payload);
	return json(payload, { status });
}

function successResponse(payload: RouteApiSuccess) {
	assertRouteApiSuccessPayload(payload);
	return json(payload);
}

function getRoundCourseCandidateErrors(
	error: RouteGenerationError,
): RoundCourseCandidateError[] | undefined {
	return error.cause instanceof RoundCourseCandidateSearchError
		? error.cause.candidateErrors
		: undefined;
}

function validationFailure(
	status: number,
	error: string,
	fieldErrors?: RouteFieldErrors,
): Effect.Effect<never, RouteValidationError> {
	return Effect.fail(new RouteValidationError(status, error, fieldErrors));
}

function mapRouteEndpointError(error: unknown): Effect.Effect<Response> {
	if (error instanceof RouteValidationError) {
		return Effect.succeed(
			errorResponse(error.status, error.error, error.fieldErrors),
		);
	}

	if (error instanceof SpatialConstraintValidationError) {
		return Effect.succeed(
			errorResponse(error.status, error.error, {
				spatialConstraint: error.fieldError,
			}),
		);
	}

	if (error instanceof UnresolvedLocationError) {
		return Effect.succeed(errorResponse(422, error.error, error.fieldErrors));
	}

	if (isMissingGraphHopperApiKeyError(error)) {
		return Effect.sync(() => {
			console.error("Failed to generate GraphHopper route", error);

			return errorResponse(
				500,
				"Routing is not configured yet. Add GRAPHHOPPER_API_KEY.",
			);
		});
	}

	if (isGraphHopperRoutePointLimitError(error)) {
		return Effect.succeed(
			errorResponse(
				400,
				`Your current routing plan allows up to ${maxRoutePoints} total route points (${maxWaypoints} waypoints plus start and destination).`,
			),
		);
	}

	if (error instanceof RouteGenerationError) {
		return Effect.sync(() => {
			console.error(error.logPrefix, error.cause ?? error);

			return errorResponse(
				502,
				error.userMessage,
				undefined,
				getRoundCourseCandidateErrors(error),
			);
		});
	}

	return Effect.sync(() => {
		console.error("Failed to generate GraphHopper route", error);

		return errorResponse(
			502,
			"GraphHopper could not generate a route right now.",
		);
	});
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

function normalizeSpatialConstraintEnforcement(
	value: unknown,
): SpatialConstraintEnforcement {
	return value === "strict" ? "strict" : "preferred";
}

function normalizeSpatialConstraintInput(
	payloadRecord: Record<string, unknown>,
	mode: RouteMode,
): {
	constraint?: RouteSpatialConstraintInput;
	error?: string;
} {
	const rawConstraint = payloadRecord.spatialConstraint;

	if (rawConstraint === undefined || rawConstraint === null) {
		return {};
	}

	let decodedConstraint: typeof RouteSpatialConstraintInputSchema.Type;

	try {
		decodedConstraint = Schema.decodeUnknownSync(
			RouteSpatialConstraintInputSchema,
		)(rawConstraint);
	} catch {
		return {
			error: "Choose an area or corridor constraint.",
		};
	}

	const enforcement = normalizeSpatialConstraintEnforcement(
		decodedConstraint.enforcement,
	);

	if (decodedConstraint.kind === "area") {
		const center = normalizeStopInput(decodedConstraint.center);
		const radiusMeters = decodedConstraint.radiusMeters;

		if (!center.label && !center.point) {
			return {
				error: "Enter an area center.",
			};
		}

		if (
			radiusMeters === null ||
			radiusMeters < minAreaRadiusMeters ||
			radiusMeters > maxAreaRadiusMeters
		) {
			return {
				error: "Enter an area radius from 1 to 250 km.",
			};
		}

		return {
			constraint: {
				kind: "area",
				center,
				radiusMeters,
				enforcement,
			},
		};
	}

	if (decodedConstraint.kind === "corridor") {
		if (mode === "round_course") {
			return {
				error:
					"Corridor constraints are available for point-to-point and out-and-back routes.",
			};
		}

		const widthMeters = decodedConstraint.widthMeters;

		if (
			widthMeters < minCorridorWidthMeters ||
			widthMeters > maxCorridorWidthMeters
		) {
			return {
				error: "Enter a corridor width from 2 to 80 km.",
			};
		}

		return {
			constraint: {
				kind: "corridor",
				widthMeters,
				enforcement,
			},
		};
	}

	return {
		error: "Choose an area or corridor constraint.",
	};
}

function isFiniteLngLat(value: unknown): value is [number, number] {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === "number" &&
		Number.isFinite(value[0]) &&
		value[0] >= -180 &&
		value[0] <= 180 &&
		typeof value[1] === "number" &&
		Number.isFinite(value[1]) &&
		value[1] >= -90 &&
		value[1] <= 90
	);
}

function normalizeRouteAvoidanceInputs(value: unknown): {
	avoidances?: RouteAvoidanceInput[];
	error?: string;
} {
	if (value === undefined || value === null) {
		return {};
	}

	if (!Array.isArray(value)) {
		return {
			error: "Choose a road segment to avoid.",
		};
	}

	if (value.length > maxRouteAvoidances) {
		return {
			error: `You can avoid up to ${maxRouteAvoidances} road segments.`,
		};
	}

	const avoidances: RouteAvoidanceInput[] = [];

	for (const [index, item] of value.entries()) {
		if (!isRecord(item) || item.kind !== "road_segment") {
			return {
				error: "Choose a road segment to avoid.",
			};
		}

		const rawCenterline = item.centerline;
		if (
			!Array.isArray(rawCenterline) ||
			rawCenterline.length < minRouteAvoidanceCenterlinePoints ||
			rawCenterline.length > maxRouteAvoidanceCenterlinePoints ||
			!rawCenterline.every(isFiniteLngLat)
		) {
			return {
				error: "Choose a valid road segment to avoid.",
			};
		}

		const bufferMeters = normalizeFiniteNumber(
			item.bufferMeters ?? defaultRouteAvoidanceBufferMeters,
		);

		if (
			bufferMeters === null ||
			bufferMeters < minRouteAvoidanceBufferMeters ||
			bufferMeters > maxRouteAvoidanceBufferMeters
		) {
			return {
				error: `Use an avoidance buffer distance from ${minRouteAvoidanceBufferMeters} to ${maxRouteAvoidanceBufferMeters} m per side.`,
			};
		}

		const label =
			typeof item.label === "string" && item.label.trim()
				? item.label.trim()
				: `Avoided road ${index + 1}`;

		avoidances.push({
			kind: "road_segment",
			centerline: rawCenterline.map((point) => [point[0], point[1]]),
			bufferMeters,
			label,
		});
	}

	return avoidances.length > 0 ? { avoidances } : {};
}

function normalizeManualEditingInput(
	value: unknown,
): ManualRouteEditingState | undefined {
	if (!isRecord(value) || !Array.isArray(value.lockedSegmentIndexes)) {
		return undefined;
	}

	const lockedSegmentIndexes = value.lockedSegmentIndexes.filter(
		(index): index is number => Number.isInteger(index) && index >= 0,
	);

	return lockedSegmentIndexes.length > 0
		? {
				lockedSegmentIndexes,
			}
		: undefined;
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

		try {
			return Schema.decodeUnknownSync(RoundCourseTargetSchema)(rawTarget);
		} catch {
			return null;
		}
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

function normalizeStopInput(value: unknown): RouteStopInput {
	if (typeof value === "string") {
		const label = value.trim();
		const coordinateResult = parseCoordinateSearchInput(label);

		if (coordinateResult.kind === "coordinate") {
			return {
				label: coordinateResult.label,
				point: coordinateResult.point,
			};
		}

		return {
			label,
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
	const label =
		typeof candidate.label === "string" ? candidate.label.trim() : "";
	const normalizedPoint: [number, number] | undefined =
		point &&
		point.length >= 2 &&
		typeof point[0] === "number" &&
		Number.isFinite(point[0]) &&
		typeof point[1] === "number" &&
		Number.isFinite(point[1])
			? [point[0], point[1]]
			: undefined;

	if (normalizedPoint) {
		return {
			label,
			point: normalizedPoint,
		};
	}

	const coordinateResult = parseCoordinateSearchInput(label);

	if (coordinateResult.kind === "coordinate") {
		return {
			label: coordinateResult.label,
			point: coordinateResult.point,
		};
	}

	return {
		label,
	};
}

function buildWaypointFieldErrors(waypointInputs: RouteStopInput[]) {
	return waypointInputs.map((waypoint) =>
		waypoint.label ? null : "Enter a waypoint or remove this stop.",
	);
}

function addWaypointValidationErrors(
	fieldErrors: RouteFieldErrors,
	waypointInputs: RouteStopInput[],
) {
	const waypointFieldErrors = buildWaypointFieldErrors(waypointInputs);

	if (waypointFieldErrors.some((error) => !!error)) {
		fieldErrors.waypointQueries = waypointFieldErrors.map(
			(error) => error ?? "",
		);
	}
}

function buildRoutePoints(stops: ResolvedRouteStop[]): [number, number][] {
	return stops.map((stop) => stop.point);
}

function successWithRoutes(
	routes: PlannedRoute[],
	roundCourseCandidateErrors?: RoundCourseCandidateError[],
) {
	return successResponse({
		routes,
		selectedRouteIndex: 0,
		...(roundCourseCandidateErrors === undefined
			? {}
			: { roundCourseCandidateErrors }),
	});
}

function buildStopResolutionInput(
	startInput: RouteStopInput,
	waypointInputs: RouteStopInput[],
	destinationInput?: RouteStopInput,
	destinationUnresolvedMessage = "We couldn't resolve that destination.",
): RouteStopResolutionInput[] {
	return [
		{ kind: "start", input: startInput, field: "startQuery" },
		...waypointInputs.map((input, index) => ({
			kind: "waypoint" as const,
			input,
			field: "waypointQueries" as const,
			index,
		})),
		...(destinationInput
			? [
					{
						kind: "destination" as const,
						input: destinationInput,
						field: "destinationQuery" as const,
						unresolvedMessage: destinationUnresolvedMessage,
					},
				]
			: []),
	];
}

function handlePointToPointEffect(context: RouteModeContext) {
	return Effect.gen(function* () {
		const {
			event,
			startInput,
			spatialConstraintInput,
			avoidanceInputs,
			manualEditing,
			fieldErrors,
			structuredPointToPointPayload,
			legacyPayload,
		} = context;
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
			const waypointError = getTooManyWaypointsMessage();
			fieldErrors.waypointQueries = waypointInputs.map(() => waypointError);
			return yield* validationFailure(400, waypointError, fieldErrors);
		}

		if (!startInput.label) {
			fieldErrors.startQuery = "Enter a start point.";
		}

		addWaypointValidationErrors(fieldErrors, waypointInputs);

		if (!destinationInput.label) {
			fieldErrors.destinationQuery = "Enter a destination.";
		}

		if (Object.keys(fieldErrors).length > 0) {
			return yield* validationFailure(
				400,
				"Start and destination are required.",
				fieldErrors,
			);
		}

		const rateLimitResponse = yield* checkRouteRateLimitEffect(event);

		if (rateLimitResponse) {
			return rateLimitResponse;
		}

		const resolvedStops = yield* resolveRouteStopsEffect(
			buildStopResolutionInput(startInput, waypointInputs, destinationInput),
		);
		const routePoints = buildRoutePoints(resolvedStops);
		const { constraint } = yield* resolveSpatialConstraintEffect(
			spatialConstraintInput,
			routePoints,
		);
		const avoidances = resolveRouteAvoidances(avoidanceInputs);
		const routes = yield* searchPointToPointRoutesEffect({
			stops: resolvedStops,
			spatialConstraint: constraint,
			avoidances,
			manualEditing,
		});

		return successWithRoutes(routes);
	});
}

function handleOutAndBackEffect(context: RouteModeContext) {
	return Effect.gen(function* () {
		const {
			event,
			startInput,
			spatialConstraintInput,
			avoidanceInputs,
			manualEditing,
			fieldErrors,
			structuredOutAndBackPayload,
		} = context;
		const turnaroundInput = normalizeStopInput(
			structuredOutAndBackPayload?.turnaround,
		);
		const rawWaypointInputs = Array.isArray(
			structuredOutAndBackPayload?.waypoints,
		)
			? structuredOutAndBackPayload.waypoints
			: [];
		const waypointInputs = rawWaypointInputs.map((input) =>
			normalizeStopInput(input),
		);

		if (!startInput.label) {
			fieldErrors.startQuery = "Enter a start point.";
		}

		if (waypointInputs.length > maxWaypoints) {
			const waypointError = getTooManyWaypointsMessage();
			return yield* validationFailure(400, waypointError, {
				...fieldErrors,
				waypointQueries: waypointInputs.map(() => waypointError),
			});
		}

		addWaypointValidationErrors(fieldErrors, waypointInputs);

		if (!turnaroundInput.label) {
			fieldErrors.destinationQuery = "Enter a turnaround point.";
		}

		if (Object.keys(fieldErrors).length > 0) {
			return yield* validationFailure(
				400,
				"Start and turnaround are required.",
				fieldErrors,
			);
		}

		const rateLimitResponse = yield* checkRouteRateLimitEffect(event);

		if (rateLimitResponse) {
			return rateLimitResponse;
		}

		const resolvedStops = yield* resolveRouteStopsEffect(
			buildStopResolutionInput(
				startInput,
				waypointInputs,
				turnaroundInput,
				"We couldn't resolve that turnaround point.",
			),
		);
		const routePoints = buildRoutePoints(resolvedStops);
		const { constraint } = yield* resolveSpatialConstraintEffect(
			spatialConstraintInput,
			routePoints,
		);
		const avoidances = resolveRouteAvoidances(avoidanceInputs);
		const routes = yield* searchOutAndBackRoutesEffect({
			stops: resolvedStops,
			spatialConstraint: constraint,
			avoidances,
			manualEditing,
		});

		return successWithRoutes(routes);
	});
}

function handleRoundCourseEffect(context: RouteModeContext) {
	return Effect.gen(function* () {
		const {
			event,
			payloadRecord,
			startInput,
			spatialConstraintInput,
			avoidanceInputs,
			manualEditing,
			fieldErrors,
		} = context;
		const roundCourseTarget = normalizeRoundCourseTarget(payloadRecord);
		const rawWaypointInputs = Array.isArray(payloadRecord.waypoints)
			? payloadRecord.waypoints
			: [];
		const waypointInputs = rawWaypointInputs.map((input) =>
			normalizeStopInput(input),
		);

		if (!startInput.label) {
			fieldErrors.startQuery = "Enter a start point.";
		}

		if (waypointInputs.length > maxWaypoints) {
			const waypointError = getTooManyWaypointsMessage();
			return yield* validationFailure(400, waypointError, {
				...fieldErrors,
				waypointQueries: waypointInputs.map(() => waypointError),
			});
		}

		addWaypointValidationErrors(fieldErrors, waypointInputs);

		if (!roundCourseTarget) {
			fieldErrors.roundCourseTarget = getRoundCourseTargetError(
				payloadRecord.target,
			);
		} else if (
			(roundCourseTarget.kind === "distance" &&
				roundCourseTarget.distanceMeters < minRoundCourseDistanceMeters) ||
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
			return yield* validationFailure(
				400,
				"Start and a round-course target are required.",
				fieldErrors,
			);
		}

		const rateLimitResponse = yield* checkRouteRateLimitEffect(event);

		if (rateLimitResponse) {
			return rateLimitResponse;
		}

		const resolvedStops = yield* resolveRouteStopsEffect(
			buildStopResolutionInput(startInput, waypointInputs),
		);
		const start = resolvedStops[0];

		if (!start) {
			return yield* validationFailure(400, "Start is required.");
		}

		const waypoints = resolvedStops.slice(1);
		const routePoints = buildRoutePoints(resolvedStops);
		const { constraint } = yield* resolveSpatialConstraintEffect(
			spatialConstraintInput,
			routePoints,
		);
		const avoidances = resolveRouteAvoidances(avoidanceInputs);
		const routeSearchResult = yield* searchRoundCourseRoutesEffect({
			start,
			waypoints,
			target: roundCourseTarget as RoundCourseTarget,
			spatialConstraint: constraint,
			avoidances,
			manualEditing,
		});

		return successWithRoutes(
			routeSearchResult.routes,
			routeSearchResult.candidateErrors,
		);
	});
}

export const POST: RequestHandler = async (event) => {
	const { fetch, request } = event;

	const program = Effect.gen(function* () {
		const rawPayload = yield* Effect.tryPromise({
			try: () => request.json(),
			catch: () =>
				new RouteValidationError(400, "Invalid route request payload."),
		});
		const decodedPayload = decodeRouteRequestPayload(rawPayload);

		if (!decodedPayload.ok) {
			return yield* validationFailure(400, decodedPayload.error);
		}

		const payload: RouteRequestPayloadInput = decodedPayload.payload;
		const payloadRecord = payload as Record<string, unknown>;
		const requestedMode =
			payloadRecord.mode === "round_course"
				? "round_course"
				: payloadRecord.mode === "out_and_back"
					? "out_and_back"
					: "point_to_point";
		const hasStructuredPayload =
			"start" in payloadRecord ||
			"waypoints" in payloadRecord ||
			"destination" in payloadRecord ||
			"turnaround" in payloadRecord ||
			"target" in payloadRecord ||
			"spatialConstraint" in payloadRecord ||
			"avoidances" in payloadRecord ||
			"requestedDistanceMeters" in payloadRecord ||
			"mode" in payloadRecord;
		const structuredPayload = hasStructuredPayload ? payload : null;
		const structuredPointToPointPayload =
			structuredPayload && requestedMode === "point_to_point"
				? structuredPayload
				: null;
		const structuredOutAndBackPayload =
			structuredPayload && requestedMode === "out_and_back"
				? structuredPayload
				: null;
		const legacyPayload = hasStructuredPayload
			? null
			: (payload as LegacyRouteRequestPayloadInput);
		const startInput = normalizeStopInput(
			structuredPayload ? structuredPayload.start : legacyPayload?.startQuery,
		);
		const fieldErrors: RouteFieldErrors = {};
		const spatialConstraintResult = normalizeSpatialConstraintInput(
			payloadRecord,
			requestedMode,
		);
		const spatialConstraintInput = spatialConstraintResult.constraint;
		const avoidanceResult = normalizeRouteAvoidanceInputs(
			payloadRecord.avoidances,
		);
		const avoidanceInputs = avoidanceResult.avoidances;
		const manualEditing = normalizeManualEditingInput(
			payloadRecord.manualEditing,
		);

		if (spatialConstraintResult.error) {
			fieldErrors.spatialConstraint = spatialConstraintResult.error;
		}

		if (avoidanceResult.error) {
			fieldErrors.avoidances = avoidanceResult.error;
		}

		const context: RouteModeContext = {
			event,
			payloadRecord,
			startInput,
			spatialConstraintInput,
			avoidanceInputs,
			manualEditing,
			fieldErrors,
			structuredPointToPointPayload,
			structuredOutAndBackPayload,
			legacyPayload,
		};

		if (requestedMode === "round_course") {
			return yield* handleRoundCourseEffect(context);
		}

		if (requestedMode === "out_and_back") {
			return yield* handleOutAndBackEffect(context);
		}

		return yield* handlePointToPointEffect(context);
	});

	return runServerEffect(
		program.pipe(
			Effect.catch(mapRouteEndpointError),
			Effect.provide(ServerLive),
			Effect.provideService(ServerFetch, { fetch }),
		),
	);
};
