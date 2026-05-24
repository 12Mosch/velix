import { Effect } from "effect";

import type {
	ResolvedRouteAvoidance,
	ResolvedRouteSpatialConstraint,
	RouteAvoidanceInput,
	RouteSpatialConstraintInput,
} from "$lib/route-planning";
import { geocodeLocationEffect } from "$lib/server/graphhopper";
import type { GraphHopperSuggestionCache } from "$lib/server/graphhopper-cache";
import type { GraphHopperConfig } from "$lib/server/graphhopper-config";
import type { GraphHopperGeocodeError } from "$lib/server/graphhopper-errors";
import type { TimeoutFetch } from "$lib/server/resilience";

import {
	SpatialConstraintValidationError,
	UnresolvedLocationError,
} from "./errors";
import {
	buildAreaPolygon,
	buildBufferedLinePolygon,
	buildCorridorPolygon,
	getDistanceMeters,
} from "./geometry";

export function resolveRouteAvoidances(
	avoidances: RouteAvoidanceInput[] | undefined,
): ResolvedRouteAvoidance[] | undefined {
	if (!avoidances || avoidances.length === 0) {
		return undefined;
	}

	return avoidances.map((avoidance, index) => ({
		kind: "road_segment" as const,
		label: avoidance.label?.trim() || `Avoided road ${index + 1}`,
		centerline: avoidance.centerline,
		bufferMeters: avoidance.bufferMeters,
		polygon: buildBufferedLinePolygon(
			avoidance.centerline,
			avoidance.bufferMeters * 2,
		),
	}));
}

export function resolveSpatialConstraintEffect(
	input: RouteSpatialConstraintInput | undefined,
	routePoints: [number, number][],
): Effect.Effect<
	{ constraint?: ResolvedRouteSpatialConstraint },
	| SpatialConstraintValidationError
	| UnresolvedLocationError
	| GraphHopperGeocodeError,
	GraphHopperConfig | TimeoutFetch | GraphHopperSuggestionCache
> {
	return Effect.gen(function* () {
		if (!input) {
			return {};
		}

		if (input.kind === "area") {
			const resolvedCenter = input.center.point
				? {
						label: input.center.label || "Selected area center",
						point: input.center.point,
					}
				: yield* geocodeLocationEffect(input.center.label);

			if (!resolvedCenter?.point) {
				return yield* Effect.fail(
					new UnresolvedLocationError("We couldn't resolve the area center.", {
						spatialConstraint: "We couldn't resolve that area center.",
					}),
				);
			}

			if (
				input.enforcement === "strict" &&
				routePoints.some(
					(point) =>
						getDistanceMeters(point, resolvedCenter.point) > input.radiusMeters,
				)
			) {
				return yield* Effect.fail(
					new SpatialConstraintValidationError(
						400,
						"Route stops must be inside the requested area.",
						"Move the area or increase its radius so all stops are inside it.",
					),
				);
			}

			return {
				constraint: {
					kind: "area" as const,
					label: resolvedCenter.label,
					center: resolvedCenter.point,
					radiusMeters: input.radiusMeters,
					enforcement: input.enforcement,
					polygon: buildAreaPolygon(resolvedCenter.point, input.radiusMeters),
				},
			};
		}

		return {
			constraint: {
				kind: "corridor" as const,
				widthMeters: input.widthMeters,
				enforcement: input.enforcement,
				polygon: buildCorridorPolygon(routePoints, input.widthMeters),
			},
		};
	});
}
