import { Effect } from "effect";

import type { PlannedRoute, RouteWaypoint } from "$lib/route-planning";
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
import type { PointToPointRouteSearchInput } from "./types";
import { attachWindAnalysisEffect } from "./wind-analysis";
import { finalizeGeneratedRoutesWarnings } from "./warnings";

export function searchPointToPointRoutesEffect(
	input: PointToPointRouteSearchInput,
): Effect.Effect<
	PlannedRoute[],
	RouteGenerationError | GraphHopperRouteBoundaryError,
	| GraphHopperConfig
	| TimeoutFetch
	| GraphHopperRouteCache
	| PaidUpstreamRateLimiter
	| GraphHopperRouteCallSubject
> {
	return Effect.gen(function* () {
		const routePoints = input.stops.map((stop) => stop.point);
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
					"Failed to generate GraphHopper route",
					"GraphHopper could not generate a route right now.",
				),
			),
		);
		const normalizedRoutes = dedupeRoutes(
			routes.map((route, routeIndex) => {
				const snappedWaypoints = snappedWaypointSets[routeIndex] ?? [];

				return {
					...route,
					startLabel: input.stops[0]?.label ?? "",
					destinationLabel: input.stops[input.stops.length - 1]?.label ?? "",
					waypoints: input.stops.slice(1, -1).map(
						(stop, index): RouteWaypoint => ({
							label: stop.label ?? stop.input.label,
							coordinate: snappedWaypoints[index + 1] ?? stop.point,
						}),
					),
				};
			}),
		).map((route) => applyManualEditing(route, input.manualEditing));

		if (normalizedRoutes.length === 0) {
			return yield* Effect.fail(
				new RouteGenerationError(
					"Failed to generate GraphHopper route",
					"GraphHopper could not generate a route right now.",
				),
			);
		}

		const routesWithWind = yield* attachWindAnalysisEffect(normalizedRoutes);

		return finalizeGeneratedRoutesWarnings(routesWithWind);
	});
}
