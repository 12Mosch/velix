import type {
	RoundCourseCandidateError,
	RouteFieldErrors,
} from "$lib/route-planning";
import type { GraphHopperRouteBoundaryError } from "$lib/server/graphhopper-errors";

export class RouteValidationError extends Error {
	readonly _tag = "RouteValidationError";

	constructor(
		readonly status: number,
		readonly error: string,
		readonly fieldErrors?: RouteFieldErrors,
	) {
		super(error);
	}
}

export class SpatialConstraintValidationError extends Error {
	readonly _tag = "SpatialConstraintValidationError";

	constructor(
		readonly status: number,
		readonly error: string,
		readonly fieldError: string,
	) {
		super(error);
	}
}

export class UnresolvedLocationError extends Error {
	readonly _tag = "UnresolvedLocationError";

	constructor(
		readonly error: string,
		readonly fieldErrors: RouteFieldErrors,
	) {
		super(error);
	}
}

export class RouteGenerationError extends Error {
	readonly _tag = "RouteGenerationError";

	constructor(
		readonly logPrefix: string,
		readonly userMessage: string,
		readonly cause?: unknown,
	) {
		super(userMessage);
	}
}

export class RoundCourseCandidateSearchError extends Error {
	readonly _tag = "RoundCourseCandidateSearchError";

	constructor(
		readonly candidateErrors: RoundCourseCandidateError[],
		readonly lastError?: RouteGenerationError | GraphHopperRouteBoundaryError,
	) {
		super("All round-course candidate attempts failed");
	}
}
