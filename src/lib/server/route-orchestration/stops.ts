import { Effect } from "effect";

import type { RouteFieldErrors } from "$lib/route-planning";
import { geocodeLocationEffect } from "$lib/server/graphhopper";
import type { GraphHopperSuggestionCache } from "$lib/server/graphhopper-cache";
import type { GraphHopperConfig } from "$lib/server/graphhopper-config";
import type { GraphHopperGeocodeError } from "$lib/server/graphhopper-errors";
import type { TimeoutFetch } from "$lib/server/resilience";

import { UnresolvedLocationError } from "./errors";
import type { ResolvedRouteStop, RouteStopResolutionInput } from "./types";

function resolveStopEffect(stop: RouteStopResolutionInput) {
	return Effect.gen(function* () {
		if (stop.input.point) {
			return {
				...stop,
				label: stop.input.label,
				point: stop.input.point,
			};
		}

		const resolved = yield* geocodeLocationEffect(stop.input.label);
		return resolved
			? {
					...stop,
					label: resolved.label,
					point: resolved.point,
				}
			: {
					...stop,
					label: "",
					point: undefined,
				};
	});
}

function hasResolvedStop(stop: { label: string; point?: [number, number] }) {
	return Boolean(stop.label || stop.point);
}

function getUnresolvedLocationMessage(stop: RouteStopResolutionInput): string {
	if (stop.unresolvedMessage) {
		return stop.unresolvedMessage;
	}

	if (stop.kind === "start") {
		return "We couldn't resolve that start point.";
	}

	if (stop.kind === "waypoint") {
		return "We couldn't resolve that waypoint.";
	}

	return "We couldn't resolve that destination.";
}

export function resolveRouteStopsEffect(
	stops: RouteStopResolutionInput[],
): Effect.Effect<
	ResolvedRouteStop[],
	UnresolvedLocationError | GraphHopperGeocodeError,
	GraphHopperConfig | TimeoutFetch | GraphHopperSuggestionCache
> {
	return Effect.gen(function* () {
		const resolvedStops = yield* Effect.all(stops.map(resolveStopEffect), {
			concurrency: "unbounded",
		});
		const fieldErrors: RouteFieldErrors = {};
		const waypointErrors = stops
			.filter((stop) => stop.field === "waypointQueries")
			.map(() => "");

		for (const stop of resolvedStops) {
			if (hasResolvedStop(stop)) {
				continue;
			}

			const message = getUnresolvedLocationMessage(stop);

			if (stop.field === "startQuery") {
				fieldErrors.startQuery = message;
				continue;
			}

			if (stop.field === "destinationQuery") {
				fieldErrors.destinationQuery = message;
				continue;
			}

			if (typeof stop.index === "number") {
				waypointErrors[stop.index] = message;
			}
		}

		if (waypointErrors.some((error) => error.length > 0)) {
			fieldErrors.waypointQueries = waypointErrors;
		}

		if (
			fieldErrors.startQuery ||
			fieldErrors.destinationQuery ||
			fieldErrors.waypointQueries
		) {
			return yield* Effect.fail(
				new UnresolvedLocationError(
					"We couldn't resolve one or more locations.",
					fieldErrors,
				),
			);
		}

		return resolvedStops as ResolvedRouteStop[];
	});
}
