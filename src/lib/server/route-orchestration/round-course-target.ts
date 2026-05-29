import { Effect } from "effect";

import type { PlannedRoute, RoundCourseTarget } from "$lib/route-planning";
import { neutralWorkoutSpeedMetersPerHour } from "$lib/workout-plan";

import {
	ascendTargetMetersPerKm,
	durationTargetSpeedMetersPerHour,
	maxRoundCourseDistanceMeters,
	minRoundCourseDistanceMeters,
} from "./constants";
import type { CandidateRouteResult } from "./types";

export function clampRoundCourseDistanceMeters(distanceMeters: number): number {
	return Math.min(
		maxRoundCourseDistanceMeters,
		Math.max(minRoundCourseDistanceMeters, distanceMeters),
	);
}

export function estimateRoundCourseDistanceMeters(
	target: RoundCourseTarget,
): number {
	if (target.kind === "distance") {
		return target.distanceMeters;
	}

	if (target.kind === "duration") {
		return (
			(target.durationMs / (60 * 60 * 1000)) * durationTargetSpeedMetersPerHour
		);
	}

	if (target.kind === "workout") {
		return target.distanceMeters;
	}

	return (target.ascendMeters / ascendTargetMetersPerKm) * 1000;
}

export function getWorkoutAdjustedDurationMs(
	route: PlannedRoute,
	target: RoundCourseTarget,
): number {
	if (target.kind !== "workout") {
		return route.durationMs;
	}

	if (
		!Number.isFinite(target.estimatedSpeedMetersPerHour) ||
		target.estimatedSpeedMetersPerHour <= 0
	) {
		return route.durationMs;
	}

	return Math.round(
		(route.durationMs * neutralWorkoutSpeedMetersPerHour) /
			target.estimatedSpeedMetersPerHour,
	);
}

export function withRoundCourseTargetAdjustedDuration(
	route: PlannedRoute,
	target: RoundCourseTarget,
): { route: PlannedRoute; adjustedDurationMs: number } {
	return {
		route,
		adjustedDurationMs: getWorkoutAdjustedDurationMs(route, target),
	};
}

export function withRoundCourseTargetAdjustedDurationEffect(
	route: PlannedRoute,
	target: RoundCourseTarget,
): Effect.Effect<{ route: PlannedRoute; adjustedDurationMs: number }> {
	return Effect.sync(() =>
		withRoundCourseTargetAdjustedDuration(route, target),
	);
}

export function getRoundCourseTargetRelativeError(
	route: PlannedRoute,
	target: RoundCourseTarget,
): number {
	if (target.kind === "duration") {
		return Math.abs(route.durationMs - target.durationMs) / target.durationMs;
	}

	if (target.kind === "workout") {
		return (
			Math.abs(
				getWorkoutAdjustedDurationMs(route, target) - target.durationMs,
			) / target.durationMs
		);
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

export function getRoundCourseTargetValue(
	route: PlannedRoute,
	target: RoundCourseTarget,
): number {
	if (target.kind === "duration") {
		return route.durationMs;
	}

	if (target.kind === "workout") {
		return getWorkoutAdjustedDurationMs(route, target);
	}

	if (target.kind === "ascend") {
		return route.ascendMeters;
	}

	return route.distanceMeters;
}

export function getRoundCourseRequestedTargetValue(
	target: RoundCourseTarget,
): number {
	if (target.kind === "duration") {
		return target.durationMs;
	}

	if (target.kind === "workout") {
		return target.durationMs;
	}

	if (target.kind === "ascend") {
		return target.ascendMeters;
	}

	return target.distanceMeters;
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

export function compareCandidateRoutes(
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

	const leftDurationValue = getRoundCourseTargetValue(left.route, target);
	const rightDurationValue = getRoundCourseTargetValue(right.route, target);
	const leftDurationError =
		target.kind === "duration" || target.kind === "workout"
			? Math.abs(leftDurationValue - target.durationMs)
			: left.route.durationMs;
	const rightDurationError =
		target.kind === "duration" || target.kind === "workout"
			? Math.abs(rightDurationValue - target.durationMs)
			: right.route.durationMs;
	const durationErrorDifference = leftDurationError - rightDurationError;

	if (Math.abs(durationErrorDifference) > 1e-9) {
		return durationErrorDifference;
	}

	return left.sequence - right.sequence;
}

function interpolateRoundCourseDistanceMeters(
	under: CandidateRouteResult,
	over: CandidateRouteResult,
	target: RoundCourseTarget,
): number | null {
	const targetValue = getRoundCourseRequestedTargetValue(target);
	const underValue = getRoundCourseTargetValue(under.route, target);
	const overValue = getRoundCourseTargetValue(over.route, target);
	const valueDelta = overValue - underValue;

	if (Math.abs(valueDelta) < 1e-9) {
		return null;
	}

	const ratio = (targetValue - underValue) / valueDelta;

	return (
		under.requestedDistanceMeters +
		(over.requestedDistanceMeters - under.requestedDistanceMeters) * ratio
	);
}

export function getNextRoundCourseBaseDistanceMeters(
	candidates: CandidateRouteResult[],
	target: RoundCourseTarget,
): number {
	const rankedCandidates = [...candidates].sort((left, right) =>
		compareCandidateRoutes(left, right, target),
	);
	const bestCandidate = rankedCandidates[0];

	if (!bestCandidate) {
		return clampRoundCourseDistanceMeters(
			estimateRoundCourseDistanceMeters(target),
		);
	}

	if (target.kind === "distance") {
		const actualDistanceMeters = Math.max(
			bestCandidate.route.distanceMeters,
			1,
		);
		const correctedDistanceMeters =
			(bestCandidate.requestedDistanceMeters * target.distanceMeters) /
			actualDistanceMeters;

		return clampRoundCourseDistanceMeters(correctedDistanceMeters);
	}

	const targetValue = getRoundCourseRequestedTargetValue(target);
	const underCandidates = rankedCandidates
		.filter(
			(candidate) =>
				getRoundCourseTargetValue(candidate.route, target) <= targetValue,
		)
		.sort(
			(left, right) =>
				targetValue -
				getRoundCourseTargetValue(left.route, target) -
				(targetValue - getRoundCourseTargetValue(right.route, target)),
		);
	const overCandidates = rankedCandidates
		.filter(
			(candidate) =>
				getRoundCourseTargetValue(candidate.route, target) >= targetValue,
		)
		.sort(
			(left, right) =>
				getRoundCourseTargetValue(left.route, target) -
				targetValue -
				(getRoundCourseTargetValue(right.route, target) - targetValue),
		);
	const underCandidate = underCandidates[0];
	const overCandidate = overCandidates[0];

	if (underCandidate && overCandidate && underCandidate !== overCandidate) {
		const interpolatedDistanceMeters = interpolateRoundCourseDistanceMeters(
			underCandidate,
			overCandidate,
			target,
		);

		if (interpolatedDistanceMeters !== null) {
			return clampRoundCourseDistanceMeters(interpolatedDistanceMeters);
		}
	}

	const bestValue = Math.max(
		getRoundCourseTargetValue(bestCandidate.route, target),
		1,
	);
	const adjustment = Math.min(1.6, Math.max(0.625, targetValue / bestValue));

	return clampRoundCourseDistanceMeters(
		bestCandidate.requestedDistanceMeters * adjustment,
	);
}

function formatDurationWarning(durationMs: number): string {
	const totalMinutes = Math.round(durationMs / 60000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	return `${hours}:${minutes.toString().padStart(2, "0")} h`;
}

export function buildRoundCourseMissWarning(
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

	if (target.kind === "duration" || target.kind === "workout") {
		return `Requested ${formatDurationWarning(target.durationMs)}, but the closest round course came out to ${formatDurationWarning(getRoundCourseTargetValue(route, target))}.`;
	}

	return `Requested ${Math.round(target.ascendMeters).toLocaleString()} m up, but the closest round course came out to ${Math.round(route.ascendMeters).toLocaleString()} m up.`;
}
