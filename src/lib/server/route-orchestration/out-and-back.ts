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
	buildOutAndBackRoute,
	dedupeRoutes,
	mapRouteBoundaryToGenerationError,
} from "./route-normalization";
import type { OutAndBackRouteSearchInput } from "./types";
import { finalizeGeneratedRoutesWarnings } from "./warnings";

export function searchOutAndBackRoutesEffect(
	input: OutAndBackRouteSearchInput,
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
				mode: "out_and_back",
				spatialConstraint: input.spatialConstraint,
				avoidances: input.avoidances,
				alternativeMaxPaths: desiredAlternativeRoutes,
				alternativeMaxWeightFactor: alternativeRouteMaxWeightFactor,
				alternativeMaxShareFactor: alternativeRouteMaxShareFactor,
			},
		).pipe(
			Effect.mapError(
				mapRouteBoundaryToGenerationError(
					"Failed to generate GraphHopper out-and-back route",
					"GraphHopper could not generate an out-and-back route right now.",
				),
			),
		);
		const normalizedRoutes = dedupeRoutes(
			routes.map((route, routeIndex) => {
				const snappedWaypoints = snappedWaypointSets[routeIndex] ?? [];
				const snappedStart = snappedWaypoints[0] ?? input.stops[0]?.point;
				const snappedTurnaround =
					snappedWaypoints[snappedWaypoints.length - 1] ??
					input.stops[input.stops.length - 1]?.point;
				const shapingWaypoints = input.stops.slice(1, -1).map(
					(stop, waypointIndex): RouteWaypoint => ({
						label: stop.label ?? stop.input.label,
						coordinate: snappedWaypoints[waypointIndex + 1] ?? stop.point,
					}),
				);

				return buildOutAndBackRoute(
					route,
					input.stops[0]?.label ?? "",
					input.stops[input.stops.length - 1]?.label ?? "",
					snappedStart ?? ([0, 0] as [number, number]),
					snappedTurnaround ?? ([0, 0] as [number, number]),
					shapingWaypoints,
				);
			}),
		).map((route) => applyManualEditing(route, input.manualEditing));

		if (normalizedRoutes.length === 0) {
			return yield* Effect.fail(
				new RouteGenerationError(
					"Failed to generate GraphHopper out-and-back route",
					"GraphHopper could not generate an out-and-back route right now.",
				),
			);
		}

		return finalizeGeneratedRoutesWarnings(normalizedRoutes, {
			suppressDeferredWindWarning: true,
		});
	});
}
