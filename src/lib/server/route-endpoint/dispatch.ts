import { Effect } from "effect";

import type { RoundCourseTarget, RouteStopInput } from "$lib/route-planning";
import {
	maxWaypoints,
	minRoundCourseAscendMeters,
	minRoundCourseDistanceMeters,
	minRoundCourseDurationMs,
	getTooManyWaypointsMessage,
} from "$lib/server/route-endpoint/constants";
import {
	addWaypointValidationErrors,
	addRouteStopLabelValidationError,
	getRoundCourseTargetError,
	hasFiniteOutOfBoundsStopPoint,
	hasRouteStopInput,
	normalizeRoundCourseTarget,
	normalizeStopInput,
} from "$lib/server/route-endpoint/payload";
import {
	successWithRoutes,
	validationFailure,
} from "$lib/server/route-endpoint/responses";
import type {
	PreparedRouteModeContext,
	RouteModeContext,
} from "$lib/server/route-endpoint/types";
import {
	resolveRouteAvoidances,
	resolveRouteStopsEffect,
	resolveSpatialConstraintEffect,
	searchOutAndBackRoutesEffect,
	searchPointToPointRoutesEffect,
	searchRoundCourseRoutesEffect,
	type ResolvedRouteStop,
	type RouteStopResolutionInput,
} from "$lib/server/route-orchestration";
import { checkRouteRateLimitEffect } from "$lib/server/route-rate-limits";

function buildTooManyWaypointsFieldErrors(
	rawWaypointInputs: readonly unknown[],
	fieldErrors: RouteModeContext["fieldErrors"] = {},
) {
	const waypointError = getTooManyWaypointsMessage();

	return {
		error: waypointError,
		fieldErrors: {
			...fieldErrors,
			waypointQueries: rawWaypointInputs.map(() => waypointError),
		},
	};
}

function buildRoutePoints(stops: ResolvedRouteStop[]): [number, number][] {
	return stops.map((stop) => stop.point);
}

function getValidationFailureMessage(
	fieldErrors: RouteModeContext["fieldErrors"],
) {
	const firstWaypointError = fieldErrors.waypointQueries?.find(Boolean);

	return (
		fieldErrors.startQuery ??
		firstWaypointError ??
		fieldErrors.destinationQuery ??
		fieldErrors.roundCourseTarget ??
		fieldErrors.spatialConstraint ??
		fieldErrors.avoidances ??
		"Validation failed."
	);
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

export const handlePointToPointEffect = Effect.fn("handlePointToPointEffect")(
	function* (context: RouteModeContext) {
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
		if (
			Array.isArray(rawWaypointInputs) &&
			rawWaypointInputs.length > maxWaypoints
		) {
			const waypointFailure = buildTooManyWaypointsFieldErrors(
				rawWaypointInputs,
				fieldErrors,
			);
			return yield* validationFailure(
				400,
				waypointFailure.error,
				waypointFailure.fieldErrors,
			);
		}
		if (
			Array.isArray(rawWaypointInputs) &&
			rawWaypointInputs.some(hasFiniteOutOfBoundsStopPoint)
		) {
			return yield* validationFailure(400, "Invalid route request payload.");
		}
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
		if (!hasRouteStopInput(startInput)) {
			fieldErrors.startQuery = "Enter a start point.";
		}

		addWaypointValidationErrors(fieldErrors, waypointInputs);

		if (!hasRouteStopInput(destinationInput)) {
			fieldErrors.destinationQuery = "Enter a destination.";
		}
		addRouteStopLabelValidationError(
			fieldErrors,
			"destinationQuery",
			destinationInput,
		);

		if (Object.keys(fieldErrors).length > 0) {
			return yield* validationFailure(
				400,
				getValidationFailureMessage(fieldErrors),
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
	},
);

export const handleOutAndBackEffect = Effect.fn("handleOutAndBackEffect")(
	function* (context: RouteModeContext) {
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
		if (!hasRouteStopInput(startInput)) {
			fieldErrors.startQuery = "Enter a start point.";
		}

		if (rawWaypointInputs.length > maxWaypoints) {
			const waypointFailure = buildTooManyWaypointsFieldErrors(
				rawWaypointInputs,
				fieldErrors,
			);
			return yield* validationFailure(
				400,
				waypointFailure.error,
				waypointFailure.fieldErrors,
			);
		}
		if (rawWaypointInputs.some(hasFiniteOutOfBoundsStopPoint)) {
			return yield* validationFailure(400, "Invalid route request payload.");
		}
		const waypointInputs = rawWaypointInputs.map((input) =>
			normalizeStopInput(input),
		);

		addWaypointValidationErrors(fieldErrors, waypointInputs);

		if (!hasRouteStopInput(turnaroundInput)) {
			fieldErrors.destinationQuery = "Enter a turnaround point.";
		}
		addRouteStopLabelValidationError(
			fieldErrors,
			"destinationQuery",
			turnaroundInput,
		);

		if (Object.keys(fieldErrors).length > 0) {
			return yield* validationFailure(
				400,
				getValidationFailureMessage(fieldErrors),
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
	},
);

export const handleRoundCourseEffect = Effect.fn("handleRoundCourseEffect")(
	function* (context: RouteModeContext) {
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
		if (!hasRouteStopInput(startInput)) {
			fieldErrors.startQuery = "Enter a start point.";
		}

		if (rawWaypointInputs.length > maxWaypoints) {
			const waypointFailure = buildTooManyWaypointsFieldErrors(
				rawWaypointInputs,
				fieldErrors,
			);
			return yield* validationFailure(
				400,
				waypointFailure.error,
				waypointFailure.fieldErrors,
			);
		}
		if (rawWaypointInputs.some(hasFiniteOutOfBoundsStopPoint)) {
			return yield* validationFailure(400, "Invalid route request payload.");
		}
		const waypointInputs = rawWaypointInputs.map((input) =>
			normalizeStopInput(input),
		);

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
			(roundCourseTarget.kind === "workout" &&
				(roundCourseTarget.durationMs < minRoundCourseDurationMs ||
					roundCourseTarget.distanceMeters <= 0 ||
					roundCourseTarget.estimatedSpeedMetersPerHour <= 0 ||
					roundCourseTarget.weightedIntensity <= 0)) ||
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
				getValidationFailureMessage(fieldErrors),
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
	},
);

export const dispatchRouteModeEffect = Effect.fn("dispatchRouteModeEffect")(
	function* ({ requestedMode, context }: PreparedRouteModeContext) {
		if (requestedMode === "round_course") {
			return yield* handleRoundCourseEffect(context);
		}

		if (requestedMode === "out_and_back") {
			return yield* handleOutAndBackEffect(context);
		}

		return yield* handlePointToPointEffect(context);
	},
);
