import { Effect } from "effect";

import type { RouteFieldErrors } from "$lib/route-planning";
import { geocodeLocationEffect } from "$lib/server/graphhopper";
import type { GraphHopperSuggestionCache } from "$lib/server/graphhopper-cache";
import type { GraphHopperConfig } from "$lib/server/graphhopper-config";
import type { GraphHopperGeocodeError } from "$lib/server/graphhopper-errors";
import type { TimeoutFetch } from "$lib/server/resilience";

import { UnresolvedLocationError } from "./errors";
import type { ResolvedRouteStop, RouteStopResolutionInput } from "./types";

type MaybeResolvedRouteStop = RouteStopResolutionInput & {
	label: string;
	point?: [number, number];
};

type IndexedRouteStop = {
	index: number;
	stop: RouteStopResolutionInput;
};

type IndexedResolvedRouteStop = {
	index: number;
	stop: MaybeResolvedRouteStop;
};

function getStopGeocodeKey(stop: RouteStopResolutionInput): string {
	return stop.input.label.trim().toLowerCase();
}

function resolveCoordinateStop(
	stop: RouteStopResolutionInput,
): MaybeResolvedRouteStop {
	return {
		...stop,
		label: stop.input.label,
		point: stop.input.point,
	};
}

function applyGeocodeResult(
	stop: RouteStopResolutionInput,
	resolved: { label: string; point: [number, number] } | null,
): MaybeResolvedRouteStop {
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
}

function resolveFreeTextStopGroupEffect(
	stops: IndexedRouteStop[],
): Effect.Effect<
	IndexedResolvedRouteStop[],
	GraphHopperGeocodeError,
	GraphHopperConfig | TimeoutFetch | GraphHopperSuggestionCache
> {
	return Effect.gen(function* () {
		const firstStop = stops[0];

		if (!firstStop) {
			return [];
		}

		const resolved = yield* geocodeLocationEffect(firstStop.stop.input.label);

		return stops.map(({ index, stop }) => ({
			index,
			stop: applyGeocodeResult(stop, resolved),
		}));
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
		const resolvedStopsByIndex = new Map<number, MaybeResolvedRouteStop>();
		const freeTextStopsByKey = new Map<string, IndexedRouteStop[]>();

		for (const [index, stop] of stops.entries()) {
			if (stop.input.point) {
				resolvedStopsByIndex.set(index, resolveCoordinateStop(stop));
				continue;
			}

			const key = getStopGeocodeKey(stop);
			const groupedStops = freeTextStopsByKey.get(key) ?? [];
			groupedStops.push({ index, stop });
			freeTextStopsByKey.set(key, groupedStops);
		}

		const resolvedFreeTextGroups = yield* Effect.all(
			Array.from(freeTextStopsByKey.values()).map(
				resolveFreeTextStopGroupEffect,
			),
			{
				concurrency: "unbounded",
			},
		);

		for (const group of resolvedFreeTextGroups) {
			for (const { index, stop } of group) {
				resolvedStopsByIndex.set(index, stop);
			}
		}

		const resolvedStops = stops.map((_, index) => {
			const stop = resolvedStopsByIndex.get(index);

			if (!stop) {
				throw new Error("Route stop resolution missed a stop.");
			}

			return stop;
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
