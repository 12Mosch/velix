import { Option } from "effect";

import type { PlannedRoute, RouteSource, RouteStopInput } from "./types";
import {
	getLegDistanceMeters,
	getNearestPolylineIndex,
	toStopPoint,
} from "./geometry";

export function isImportedRoute(
	route: Pick<PlannedRoute, "source"> | null | undefined,
): route is {
	source: Extract<RouteSource, { kind: "gpx_import" }>;
} {
	return route?.source.kind === "gpx_import";
}

export function getRouteStopInputs(route: PlannedRoute): RouteStopInput[] {
	return getEditableRouteStops(route);
}

/**
 * Returns the editable stop chain for route planning interactions.
 *
 * Point-to-point routes expose start, all waypoints, and destination.
 * Round courses expose the start plus shaping waypoints; the implicit closing
 * leg returns to the start. Out-and-back routes expose start, optional shaping
 * waypoints, and the turnaround, with mirrored return geometry handled later.
 */
export function getEditableRouteStops(route: PlannedRoute): RouteStopInput[] {
	const startCoordinate = route.coordinates[0];
	const destinationCoordinate = route.coordinates[route.coordinates.length - 1];
	const startStop = {
		label: route.startLabel,
		point: startCoordinate ? toStopPoint(startCoordinate) : undefined,
	};

	if (route.mode !== "point_to_point") {
		return [
			startStop,
			...route.waypoints.map((waypoint) => ({
				label: waypoint.label,
				point: toStopPoint(waypoint.coordinate),
			})),
		];
	}

	return [
		startStop,
		...route.waypoints.map((waypoint) => ({
			label: waypoint.label,
			point: toStopPoint(waypoint.coordinate),
		})),
		{
			label: route.destinationLabel,
			point: destinationCoordinate
				? toStopPoint(destinationCoordinate)
				: undefined,
		},
	];
}

/**
 * Counts editable legs, not raw polyline coordinate segments.
 *
 * Point-to-point and out-and-back routes have one fewer editable segment than
 * editable stops. Round courses include the implicit final segment from the
 * last shaping stop back to the start, so their segment count matches the
 * editable stop count.
 */
export function getRouteSegmentCount(route: PlannedRoute): number {
	const editableStops = getEditableRouteStops(route);

	if (route.mode === "round_course") {
		return Math.max(1, editableStops.length);
	}

	return Math.max(0, editableStops.length - 1);
}

export function sanitizeLockedSegmentIndexes(
	indexes: number[] | null | undefined,
	segmentCount: number,
): number[] {
	if (!Array.isArray(indexes) || segmentCount <= 0) {
		return [];
	}

	return [...new Set(indexes)]
		.filter(
			(index) => Number.isInteger(index) && index >= 0 && index < segmentCount,
		)
		.sort((left, right) => left - right);
}

export function isRouteStopLocked(
	stopIndex: number,
	lockedSegmentIndexes: number[],
	segmentCount: number,
	isClosedLoop = false,
): boolean {
	if (!Number.isInteger(stopIndex) || stopIndex < 0 || segmentCount <= 0) {
		return false;
	}

	const lockedSegments = new Set(
		sanitizeLockedSegmentIndexes(lockedSegmentIndexes, segmentCount),
	);

	if (lockedSegments.has(stopIndex) || lockedSegments.has(stopIndex - 1)) {
		return true;
	}

	return (
		isClosedLoop && stopIndex === 0 && lockedSegments.has(segmentCount - 1)
	);
}

function getRouteStopPolylineIndices(route: PlannedRoute): number[] {
	const editableStops = getEditableRouteStops(route);
	const stopPoints = editableStops
		.map((stop) => stop.point)
		.filter((point): point is [number, number] => !!point);

	if (
		stopPoints.length !== editableStops.length ||
		route.coordinates.length === 0
	) {
		return [];
	}

	const stopIndices: number[] = [];
	let searchStartIndex = 0;

	for (const stopPoint of stopPoints) {
		const stopIndex = getNearestPolylineIndex(
			route.coordinates,
			stopPoint,
			searchStartIndex,
		);
		stopIndices.push(stopIndex);
		searchStartIndex = stopIndex;
	}

	return stopIndices;
}

export function getCoordinateSegmentForRouteLeg(
	route: PlannedRoute,
	legIndex: number,
): Option.Option<{ fromIndex: number; toIndex: number }> {
	const segmentCount = getRouteSegmentCount(route);

	if (
		legIndex < 0 ||
		legIndex >= segmentCount ||
		route.coordinates.length < 2
	) {
		return Option.none();
	}

	const stopIndices = getRouteStopPolylineIndices(route);

	if (route.mode === "round_course") {
		if (stopIndices.length <= 1) {
			return Option.some({
				fromIndex: 0,
				toIndex: route.coordinates.length - 1,
			});
		}

		const fromIndex = stopIndices[legIndex] ?? 0;
		const toIndex =
			legIndex === segmentCount - 1
				? route.coordinates.length - 1
				: (stopIndices[legIndex + 1] ?? route.coordinates.length - 1);

		return toIndex > fromIndex
			? Option.some({ fromIndex, toIndex })
			: Option.none();
	}

	const fromIndex = stopIndices[legIndex] ?? 0;
	const toIndex = stopIndices[legIndex + 1] ?? route.coordinates.length - 1;

	return toIndex > fromIndex
		? Option.some({ fromIndex, toIndex })
		: Option.none();
}

export function getRouteLegIndexForCoordinateSegment(
	route: PlannedRoute,
	coordinateSegmentIndex: number,
): Option.Option<number> {
	const segmentCount = getRouteSegmentCount(route);

	if (
		!Number.isInteger(coordinateSegmentIndex) ||
		coordinateSegmentIndex < 0 ||
		coordinateSegmentIndex >= route.coordinates.length - 1
	) {
		return Option.none();
	}

	for (let legIndex = 0; legIndex < segmentCount; legIndex += 1) {
		const segment = getCoordinateSegmentForRouteLeg(route, legIndex);

		if (Option.isSome(segment)) {
			const value = segment.value;
			if (
				coordinateSegmentIndex >= value.fromIndex &&
				coordinateSegmentIndex < value.toIndex
			) {
				return Option.some(legIndex);
			}
		}
	}

	return Option.none();
}

function getRouteLegInsertionIndex(
	stops: RouteStopInput[],
	point: [number, number],
	route: PlannedRoute,
): Option.Option<number> {
	const routeStops = getEditableRouteStops(route);

	if (routeStops.length !== stops.length || route.coordinates.length === 0) {
		return Option.none();
	}

	for (let index = 0; index < stops.length; index += 1) {
		const stop = stops[index];
		const routeStop = routeStops[index];

		if (!stop || !routeStop) {
			return Option.none();
		}

		if (stop.label !== routeStop.label) {
			return Option.none();
		}

		if (
			(stop.point && !routeStop.point) ||
			(!stop.point && routeStop.point) ||
			(stop.point &&
				routeStop.point &&
				(stop.point[0] !== routeStop.point[0] ||
					stop.point[1] !== routeStop.point[1]))
		) {
			return Option.none();
		}
	}

	const routeStopPoints = routeStops
		.map((stop) => stop.point)
		.filter((stopPoint): stopPoint is [number, number] => !!stopPoint);

	if (routeStopPoints.length !== routeStops.length) {
		return Option.none();
	}

	const stopIndices: number[] = [];
	let searchStartIndex = 0;

	for (const stopPoint of routeStopPoints) {
		const stopIndex = getNearestPolylineIndex(
			route.coordinates,
			stopPoint,
			searchStartIndex,
		);
		stopIndices.push(stopIndex);
		searchStartIndex = stopIndex;
	}

	for (let index = 0; index < stopIndices.length - 1; index += 1) {
		const currentIndex = stopIndices[index];
		const nextIndex = stopIndices[index + 1];

		if (
			currentIndex === undefined ||
			nextIndex === undefined ||
			nextIndex <= currentIndex
		) {
			return Option.none();
		}
	}

	let bestLegIndex = 0;
	let bestLegDistance = Number.POSITIVE_INFINITY;

	for (let index = 0; index < stopIndices.length - 1; index += 1) {
		const fromIndex = stopIndices[index];
		const toIndex = stopIndices[index + 1];

		if (fromIndex === undefined || toIndex === undefined) {
			continue;
		}

		const legCoordinates = route.coordinates
			.slice(fromIndex, toIndex + 1)
			.map((coordinate) => toStopPoint(coordinate));
		const distance = getLegDistanceMeters(
			point,
			legCoordinates.length > 0
				? legCoordinates
				: [routeStopPoints[index], routeStopPoints[index + 1]],
		);

		if (distance < bestLegDistance) {
			bestLegDistance = distance;
			bestLegIndex = index;
		}
	}

	return Option.some(bestLegIndex);
}

export function getWaypointInsertionIndex(
	stops: RouteStopInput[],
	point: [number, number],
	route: PlannedRoute | null = null,
): number {
	const routedLegIndex = route
		? getRouteLegInsertionIndex(stops, point, route)
		: Option.none<number>();

	if (Option.isSome(routedLegIndex)) {
		return routedLegIndex.value;
	}

	const resolvedStops = stops.filter(
		(stop) => stop.label.trim().length > 0 && !!stop.point,
	);

	if (resolvedStops.length < 2) {
		return Math.max(0, Math.min(stops.length - 1, resolvedStops.length - 1));
	}

	let bestLegIndex = 0;
	let bestLegDistance = Number.POSITIVE_INFINITY;

	for (let index = 0; index < resolvedStops.length - 1; index += 1) {
		const from = resolvedStops[index]?.point;
		const to = resolvedStops[index + 1]?.point;

		if (!from || !to) {
			continue;
		}

		const distance = getLegDistanceMeters(point, [from, to]);

		if (distance < bestLegDistance) {
			bestLegDistance = distance;
			bestLegIndex = index;
		}
	}

	return bestLegIndex;
}
