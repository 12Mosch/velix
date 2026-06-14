import { Effect } from "effect";

import type {
	PlannedRoute,
	RoundCourseCandidateError,
	RouteWaypoint,
} from "$lib/route-planning";
import type { GraphHopperConfig } from "$lib/server/graphhopper-config";
import type { GraphHopperRouteCache } from "$lib/server/graphhopper-cache";
import type { GraphHopperRouteBoundaryError } from "$lib/server/graphhopper-errors";
import { requestRoutesEffect } from "$lib/server/graphhopper-routing";
import type {
	GraphHopperRouteCallSubject,
	PaidUpstreamRateLimiter,
} from "$lib/server/route-rate-limits";
import type { TimeoutFetch } from "$lib/server/resilience";

import {
	alternativeRouteMaxShareFactor,
	alternativeRouteMaxWeightFactor,
	desiredAlternativeRoutes,
} from "./constants";
import { RouteGenerationError } from "./errors";
import {
	applyManualEditing,
	dedupeRoutes,
	mapRouteBoundaryToGenerationError,
} from "./route-normalization";
import { searchRoundCourseCandidateRoutesEffect } from "./round-course-candidates";
import { withRoundCourseTargetAdjustedDurationEffect } from "./round-course-target";
import type {
	RoundCourseRouteSearchInput,
	RoundCourseRouteSearchResult,
} from "./types";
import { attachWindAnalysisEffect } from "./wind-analysis";
import {
	finalizeGeneratedRoutesWarnings,
	withProviderWarning,
} from "./warnings";

export function searchRoundCourseRoutesEffect(
	input: RoundCourseRouteSearchInput,
): Effect.Effect<
	RoundCourseRouteSearchResult,
	RouteGenerationError | GraphHopperRouteBoundaryError,
	| GraphHopperConfig
	| TimeoutFetch
	| GraphHopperRouteCache
	| PaidUpstreamRateLimiter
	| GraphHopperRouteCallSubject
> {
	return Effect.gen(function* () {
		let normalizedRoutes: PlannedRoute[];
		let candidateErrors: RoundCourseCandidateError[] | undefined;

		if (input.waypoints.length === 0) {
			const searchResult = yield* searchRoundCourseCandidateRoutesEffect(
				input.start.point,
				input.target,
				input.spatialConstraint,
				input.avoidances,
			);
			candidateErrors =
				searchResult.candidateErrors.length > 0
					? searchResult.candidateErrors
					: undefined;
			normalizedRoutes = dedupeRoutes(searchResult.routes).map((route) =>
				applyManualEditing(
					{
						...route,
						startLabel: input.start.label,
						destinationLabel: input.start.label,
						waypoints: [],
					},
					input.manualEditing,
				),
			);
		} else {
			const routePoints = [
				input.start.point,
				...input.waypoints.map((waypoint) => waypoint.point),
				input.start.point,
			];
			const { routes, snappedWaypointSets } = yield* requestRoutesEffect(
				routePoints,
				{
					mode: "point_to_point",
					spatialConstraint: input.spatialConstraint,
					avoidances: input.avoidances,
					alternativeMaxPaths: desiredAlternativeRoutes,
					alternativeMaxWeightFactor: alternativeRouteMaxWeightFactor,
					alternativeMaxShareFactor: alternativeRouteMaxShareFactor,
				},
			).pipe(
				Effect.mapError(
					mapRouteBoundaryToGenerationError(
						"Failed to generate GraphHopper round course",
						"GraphHopper could not generate a round course right now.",
					),
				),
			);

			const shapedRoutes = routes.map((route, routeIndex) => {
				const snappedWaypoints = snappedWaypointSets[routeIndex] ?? [];

				const shapedRoute = {
					...route,
					mode: "round_course" as const,
					startLabel: input.start.label,
					destinationLabel: input.start.label,
					roundCourseTarget: input.target,
					waypoints: input.waypoints.map(
						(waypoint, waypointIndex): RouteWaypoint => ({
							label: waypoint.label,
							coordinate: snappedWaypoints[waypointIndex + 1] ?? waypoint.point,
						}),
					),
				};

				return withProviderWarning(
					shapedRoute,
					"Manual shaping points make the round-course target best-effort.",
					"Round-course target best effort",
				);
			});

			normalizedRoutes = dedupeRoutes(shapedRoutes).map((route) =>
				applyManualEditing(route, input.manualEditing),
			);
		}

		if (normalizedRoutes.length === 0) {
			return yield* Effect.fail(
				new RouteGenerationError(
					"Failed to generate GraphHopper round course",
					"GraphHopper could not generate a round course right now.",
				),
			);
		}

		const targetAdjustedRoutes = yield* Effect.all(
			normalizedRoutes.map((route) =>
				withRoundCourseTargetAdjustedDurationEffect(route, input.target),
			),
		);
		const routesWithWind = yield* attachWindAnalysisEffect(
			targetAdjustedRoutes.map(({ route }) => route),
		);
		const routesWithWarnings = finalizeGeneratedRoutesWarnings(routesWithWind);

		return candidateErrors
			? { routes: routesWithWarnings, candidateErrors }
			: { routes: routesWithWarnings };
	});
}
