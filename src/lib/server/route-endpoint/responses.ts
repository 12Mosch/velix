import { json } from "@sveltejs/kit";
import { Effect } from "effect";

import {
	assertRouteApiErrorPayload,
	assertRouteApiSuccessPayload,
} from "$lib/route-api-schema";
import type {
	PlannedRoute,
	RoundCourseCandidateError,
	RouteApiError,
	RouteApiSuccess,
	RouteFieldErrors,
} from "$lib/route-planning";
import {
	isGraphHopperRoutePointLimitError,
	isMissingGraphHopperApiKeyError,
} from "$lib/server/graphhopper-errors";
import {
	maxRoutePoints,
	maxWaypoints,
} from "$lib/server/route-endpoint/constants";
import {
	RoundCourseCandidateSearchError,
	RouteGenerationError,
	RouteValidationError,
	SpatialConstraintValidationError,
	UnresolvedLocationError,
} from "$lib/server/route-orchestration";

export function errorResponse(
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

export function successResponse(payload: RouteApiSuccess) {
	assertRouteApiSuccessPayload(payload);
	return json(payload);
}

export function successWithRoutes(
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

export function validationFailure(
	status: number,
	error: string,
	fieldErrors?: RouteFieldErrors,
): Effect.Effect<never, RouteValidationError> {
	return Effect.fail(new RouteValidationError(status, error, fieldErrors));
}

function getRoundCourseCandidateErrors(
	error: RouteGenerationError,
): RoundCourseCandidateError[] | undefined {
	return error.cause instanceof RoundCourseCandidateSearchError
		? error.cause.candidateErrors
		: undefined;
}

export function mapRouteEndpointError(error: unknown): Effect.Effect<Response> {
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
