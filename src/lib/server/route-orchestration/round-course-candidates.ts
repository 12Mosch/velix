import { Effect } from "effect";

import type {
	ResolvedRouteAvoidance,
	ResolvedRouteSpatialConstraint,
	RoundCourseCandidateError,
	RoundCourseTarget,
} from "$lib/route-planning";
import type { GraphHopperConfig } from "$lib/server/graphhopper-config";
import type { GraphHopperRouteBoundaryError } from "$lib/server/graphhopper-errors";
import { GraphHopperRouteStatusError } from "$lib/server/graphhopper-errors";
import { requestRoutesEffect } from "$lib/server/graphhopper-routing";
import type { TimeoutFetch } from "$lib/server/resilience";

import {
	broadRoundCourseSearchMultipliers,
	desiredAlternativeRoutes,
	roundCourseCandidateSearchConcurrency,
	roundCourseDistanceSearchMultipliers,
	roundCourseSearchSeeds,
	tightRoundCourseSearchMultipliers,
} from "./constants";
import {
	RouteGenerationError,
	RoundCourseCandidateSearchError,
} from "./errors";
import { dedupeCandidateRoutes } from "./route-normalization";
import {
	buildRoundCourseMissWarning,
	clampRoundCourseDistanceMeters,
	compareCandidateRoutes,
	estimateRoundCourseDistanceMeters,
	getNextRoundCourseBaseDistanceMeters,
	getRoundCourseTargetRelativeError,
} from "./round-course-target";
import type {
	CandidateRouteResult,
	RoundCourseCandidateAttempt,
	RoundCourseCandidateAttemptContext,
	RoundCourseCandidateFailure,
	RoundCourseCandidateSearchResult,
	RoundCourseCandidateSuccess,
} from "./types";
import { withProviderWarning } from "./warnings";

function getErrorTag(error: Error): string {
	return "_tag" in error && typeof error._tag === "string"
		? error._tag
		: error.constructor.name;
}

function serializeRoundCourseCandidateFailure(
	failure: RoundCourseCandidateFailure,
): RoundCourseCandidateError {
	return {
		roundIndex: failure.roundIndex,
		candidateIndex: failure.candidateIndex,
		sequence: failure.sequence,
		requestedDistanceMeters: failure.requestedDistanceMeters,
		...(failure.seed === undefined ? {} : { seed: failure.seed }),
		errorTag: getErrorTag(failure.error),
		message: failure.error.message,
		...(failure.error instanceof GraphHopperRouteStatusError
			? { status: failure.error.status }
			: {}),
	};
}

export function searchRoundCourseCandidateRoutesEffect(
	startPoint: [number, number],
	target: RoundCourseTarget,
	spatialConstraint?: ResolvedRouteSpatialConstraint,
	avoidances?: ResolvedRouteAvoidance[],
	desiredCount = desiredAlternativeRoutes,
): Effect.Effect<
	RoundCourseCandidateSearchResult,
	RouteGenerationError | GraphHopperRouteBoundaryError,
	GraphHopperConfig | TimeoutFetch
> {
	return Effect.gen(function* () {
		let baseDistanceMeters = clampRoundCourseDistanceMeters(
			estimateRoundCourseDistanceMeters(target),
		);
		const successfulCandidates: CandidateRouteResult[] = [];
		const candidateFailures: RoundCourseCandidateFailure[] = [];
		let sequence = 0;
		const attemptedRequestedDistances = new Set<string>();

		for (const [roundIndex, seeds] of roundCourseSearchSeeds.entries()) {
			const multipliers =
				target.kind === "distance"
					? roundCourseDistanceSearchMultipliers
					: roundIndex === 0
						? broadRoundCourseSearchMultipliers
						: tightRoundCourseSearchMultipliers;
			const requestedDistances = multipliers
				.map((multiplier) =>
					clampRoundCourseDistanceMeters(baseDistanceMeters * multiplier),
				)
				.filter((requestedDistanceMeters) => {
					const key = `${roundIndex}:${Math.round(requestedDistanceMeters)}`;

					if (attemptedRequestedDistances.has(key)) {
						return false;
					}

					attemptedRequestedDistances.add(key);
					return true;
				});

			if (requestedDistances.length === 0) {
				continue;
			}

			const roundSuccessfulCandidates: CandidateRouteResult[] = [];

			for (
				let batchStart = 0;
				batchStart < requestedDistances.length;
				batchStart += roundCourseCandidateSearchConcurrency
			) {
				const batch = requestedDistances.slice(
					batchStart,
					batchStart + roundCourseCandidateSearchConcurrency,
				);
				const attemptEffects = batch.map(
					(requestedDistanceMeters, batchIndex) => {
						const candidateIndex = batchStart + batchIndex;
						const candidateSequence = sequence++;
						const seed = seeds[candidateIndex];
						const context: RoundCourseCandidateAttemptContext = {
							roundIndex,
							candidateIndex,
							sequence: candidateSequence,
							requestedDistanceMeters,
							...(seed === undefined ? {} : { seed }),
						};

						return requestRoutesEffect([startPoint], {
							mode: "round_course",
							roundTripDistanceMeters: requestedDistanceMeters,
							roundTripSeed: seed,
							roundCourseTarget: target,
							spatialConstraint,
							avoidances,
						}).pipe(
							Effect.map(
								({ routes }): RoundCourseCandidateSuccess => ({
									...context,
									_tag: "RoundCourseCandidateSuccess",
									candidates: routes.map((route, routeIndex) => ({
										route,
										requestedDistanceMeters,
										sequence:
											candidateSequence * desiredAlternativeRoutes + routeIndex,
									})),
								}),
							),
							Effect.match({
								onFailure: (error): RoundCourseCandidateFailure => ({
									...context,
									_tag: "RoundCourseCandidateFailure",
									error,
								}),
								onSuccess: (success) => success,
							}),
						);
					},
				);

				const candidateResults: RoundCourseCandidateAttempt[] =
					yield* Effect.all(attemptEffects, {
						concurrency: roundCourseCandidateSearchConcurrency,
					});

				for (const candidateResult of candidateResults) {
					if (candidateResult._tag === "RoundCourseCandidateSuccess") {
						roundSuccessfulCandidates.push(...candidateResult.candidates);
						successfulCandidates.push(...candidateResult.candidates);
						continue;
					}

					candidateFailures.push(candidateResult);
				}

				if (
					dedupeCandidateRoutes(roundSuccessfulCandidates).length >=
					desiredCount
				) {
					break;
				}
			}

			const uniqueCandidates = dedupeCandidateRoutes(successfulCandidates);

			if (uniqueCandidates.length === 0) {
				continue;
			}

			const bestCandidate = [...uniqueCandidates].sort((left, right) =>
				compareCandidateRoutes(left, right, target),
			)[0];

			if (roundIndex === 0) {
				baseDistanceMeters = getNextRoundCourseBaseDistanceMeters(
					uniqueCandidates,
					target,
				);
				continue;
			}

			if (
				target.kind !== "distance" &&
				roundIndex === 1 &&
				bestCandidate &&
				getRoundCourseTargetRelativeError(bestCandidate.route, target) > 0.15
			) {
				baseDistanceMeters = getNextRoundCourseBaseDistanceMeters(
					uniqueCandidates,
					target,
				);
				continue;
			}

			break;
		}

		const uniqueCandidates = dedupeCandidateRoutes(successfulCandidates);

		if (uniqueCandidates.length === 0) {
			const candidateErrors = candidateFailures.map(
				serializeRoundCourseCandidateFailure,
			);

			if (candidateErrors.length > 0) {
				return yield* Effect.fail(
					new RouteGenerationError(
						"Failed to generate GraphHopper round course",
						"GraphHopper could not generate a round course right now.",
						new RoundCourseCandidateSearchError(
							candidateErrors,
							candidateFailures[candidateFailures.length - 1]?.error,
						),
					),
				);
			}

			return yield* Effect.fail(
				new RouteGenerationError(
					"Failed to generate GraphHopper round course",
					"GraphHopper could not generate a round course right now.",
				),
			);
		}

		const rankedCandidates = [...uniqueCandidates].sort((left, right) =>
			compareCandidateRoutes(left, right, target),
		);

		const routes = yield* Effect.all(
			rankedCandidates.slice(0, desiredCount).map((candidate) => {
				const missWarning = buildRoundCourseMissWarning(
					candidate.route,
					target,
				);

				if (!missWarning) {
					return Effect.succeed(candidate.route);
				}

				return withProviderWarning(
					candidate.route,
					missWarning,
					"Round-course target best effort",
				);
			}),
		);

		return {
			routes,
			candidateErrors: candidateFailures.map(
				serializeRoundCourseCandidateFailure,
			),
		};
	});
}
