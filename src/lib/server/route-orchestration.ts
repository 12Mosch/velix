import { Effect, Result } from "effect";

import type {
	ManualRouteEditingState,
	PlannedRoute,
	ResolvedRouteSpatialConstraint,
	RouteWindAnalysis,
	RouteWindSample,
	RouteWindSegment,
	RoundCourseCandidateError,
	RoundCourseTarget,
	RouteCoordinate,
	RouteDetailInterval,
	RouteFieldErrors,
	RouteSpatialConstraintInput,
	RouteStopInput,
	RouteWaypoint,
} from "$lib/route-planning";
import {
	calculateBearingDegrees,
	calculateWindComponents,
} from "$lib/route-planning";
import { geocodeLocationEffect } from "$lib/server/graphhopper";
import type { GraphHopperSuggestionCache } from "$lib/server/graphhopper-cache";
import type { GraphHopperConfig } from "$lib/server/graphhopper-config";
import type {
	GraphHopperGeocodeError,
	GraphHopperRouteBoundaryError,
} from "$lib/server/graphhopper-errors";
import {
	GraphHopperRouteStatusError,
	isGraphHopperRoutePointLimitError,
	isMissingGraphHopperApiKeyError,
} from "$lib/server/graphhopper-errors";
import { requestRoutesEffect } from "$lib/server/graphhopper-routing";
import { fetchOpenMeteoBatchWindEffect } from "$lib/server/open-meteo";
import type { TimeoutFetch } from "$lib/server/resilience";

type StopField = "startQuery" | "destinationQuery" | "waypointQueries";

export type RouteStopResolutionInput = {
	kind: "start" | "waypoint" | "destination";
	input: RouteStopInput;
	field: StopField;
	index?: number;
	unresolvedMessage?: string;
};

export type ResolvedRouteStop = RouteStopResolutionInput & {
	label: string;
	point: [number, number];
};

export type PointToPointRouteSearchInput = {
	stops: ResolvedRouteStop[];
	spatialConstraint?: ResolvedRouteSpatialConstraint;
	manualEditing?: ManualRouteEditingState;
};

export type OutAndBackRouteSearchInput = PointToPointRouteSearchInput;

export type RoundCourseRouteSearchInput = {
	start: ResolvedRouteStop;
	waypoints: ResolvedRouteStop[];
	target: RoundCourseTarget;
	spatialConstraint?: ResolvedRouteSpatialConstraint;
	manualEditing?: ManualRouteEditingState;
};

type CandidateRouteResult = {
	route: PlannedRoute;
	requestedDistanceMeters: number;
	sequence: number;
};

type RoundCourseCandidateAttemptContext = {
	roundIndex: number;
	candidateIndex: number;
	sequence: number;
	requestedDistanceMeters: number;
	seed?: number;
};

type RoundCourseCandidateSuccess = RoundCourseCandidateAttemptContext & {
	_tag: "RoundCourseCandidateSuccess";
	candidates: CandidateRouteResult[];
};

type RoundCourseCandidateFailure = RoundCourseCandidateAttemptContext & {
	_tag: "RoundCourseCandidateFailure";
	error: RouteGenerationError | GraphHopperRouteBoundaryError;
};

type RoundCourseCandidateAttempt =
	| RoundCourseCandidateSuccess
	| RoundCourseCandidateFailure;

type RoundCourseCandidateSearchResult = {
	routes: PlannedRoute[];
	candidateErrors: RoundCourseCandidateError[];
};

type RoundCourseRouteSearchResult = {
	routes: PlannedRoute[];
	candidateErrors?: RoundCourseCandidateError[];
};

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

const desiredAlternativeRoutes = 3;
const alternativeRouteMaxWeightFactor = 1.4;
const alternativeRouteMaxShareFactor = 0.6;
const roundCourseDistanceSearchMultipliers = [0.9, 1, 1.1] as const;
const broadRoundCourseSearchMultipliers = [0.75, 1, 1.25] as const;
const tightRoundCourseSearchMultipliers = [0.9, 1, 1.1] as const;
const roundCourseSearchSeeds = [
	[11, 37, 73],
	[109, 149, 191],
	[233, 277, 331],
] as const;
const minRoundCourseDistanceMeters = 10_000;
const maxRoundCourseDistanceMeters = 220_000;
const durationTargetSpeedMetersPerHour = 22_000;
const ascendTargetMetersPerKm = 12;
const areaPolygonSegments = 48;
const earthRadiusMeters = 6_371_008.8;
const windUnavailableWarning =
	"Wind data is temporarily unavailable, so wind analysis was skipped.";

function applyManualEditing(
	route: PlannedRoute,
	manualEditing: ManualRouteEditingState | undefined,
): PlannedRoute {
	return manualEditing
		? {
				...route,
				manualEditing,
			}
		: route;
}

function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
	return (radians * 180) / Math.PI;
}

function getDistanceMeters(left: [number, number], right: [number, number]) {
	const leftLat = toRadians(left[1]);
	const rightLat = toRadians(right[1]);
	const deltaLat = toRadians(right[1] - left[1]);
	const deltaLng = toRadians(right[0] - left[0]);
	const a =
		Math.sin(deltaLat / 2) ** 2 +
		Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;

	return (
		earthRadiusMeters *
		2 *
		Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
	);
}

function toCoordinatePair(coordinate: RouteCoordinate): [number, number] {
	return [coordinate[0], coordinate[1]];
}

function interpolateCoordinate(
	from: RouteCoordinate,
	to: RouteCoordinate,
	ratio: number,
): [number, number] {
	return [
		from[0] + (to[0] - from[0]) * ratio,
		from[1] + (to[1] - from[1]) * ratio,
	];
}

function getRouteDistanceSamples(route: PlannedRoute): [number, number][] {
	const coordinates = route.coordinates;

	if (coordinates.length === 0) {
		return [];
	}

	if (coordinates.length === 1 || route.distanceMeters <= 0) {
		return [toCoordinatePair(coordinates[0] as RouteCoordinate)];
	}

	const segmentDistances = coordinates
		.slice(0, -1)
		.map((coordinate, index) =>
			getDistanceMeters(
				toCoordinatePair(coordinate),
				toCoordinatePair(coordinates[index + 1] as RouteCoordinate),
			),
		);
	const totalDistance = segmentDistances.reduce(
		(sum, distance) => sum + distance,
		0,
	);
	const sampleDistances =
		totalDistance > 0
			? [0, 0.25, 0.5, 0.75, 1].map((ratio) => totalDistance * ratio)
			: [0];

	return sampleDistances.map((targetDistance) => {
		let walkedDistance = 0;

		for (let index = 0; index < segmentDistances.length; index += 1) {
			const segmentDistance = segmentDistances[index] ?? 0;
			const from = coordinates[index];
			const to = coordinates[index + 1];

			if (!from || !to) {
				continue;
			}

			if (
				targetDistance <= walkedDistance + segmentDistance ||
				index === segmentDistances.length - 1
			) {
				const ratio =
					segmentDistance > 0
						? (targetDistance - walkedDistance) / segmentDistance
						: 0;
				return interpolateCoordinate(from, to, Math.min(1, Math.max(0, ratio)));
			}

			walkedDistance += segmentDistance;
		}

		return toCoordinatePair(
			coordinates[coordinates.length - 1] as RouteCoordinate,
		);
	});
}

function getNearestWindSample(
	coordinate: [number, number],
	samples: RouteWindSample[],
): RouteWindSample | null {
	let nearestSample: RouteWindSample | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;

	for (const sample of samples) {
		const distance = getDistanceMeters(coordinate, sample.coordinate);

		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearestSample = sample;
		}
	}

	return nearestSample;
}

function buildWindAnalysis(
	route: PlannedRoute,
	samples: RouteWindSample[],
	fetchedAt: string,
): RouteWindAnalysis | null {
	if (samples.length === 0 || route.coordinates.length < 2) {
		return null;
	}

	const segments: RouteWindSegment[] = [];
	let weightedHeadwindTotal = 0;
	let totalDistance = 0;
	let maxHeadwindKmh = 0;
	let maxCrosswindKmh = 0;
	let headwindDistanceMeters = 0;
	let tailwindDistanceMeters = 0;
	let crosswindDistanceMeters = 0;

	for (let index = 0; index < route.coordinates.length - 1; index += 1) {
		const from = route.coordinates[index];
		const to = route.coordinates[index + 1];

		if (!from || !to) {
			continue;
		}

		const fromPoint = toCoordinatePair(from);
		const toPoint = toCoordinatePair(to);
		const distanceMeters = getDistanceMeters(fromPoint, toPoint);

		if (distanceMeters <= 0) {
			continue;
		}

		const midpoint = interpolateCoordinate(from, to, 0.5);
		const sample = getNearestWindSample(midpoint, samples);

		if (!sample) {
			continue;
		}

		const routeBearingDegrees = calculateBearingDegrees(from, to);
		const components = calculateWindComponents({
			speedKmh: sample.speedKmh,
			windDirectionDegrees: sample.directionDegrees,
			routeBearingDegrees,
		});

		segments.push({
			from: index,
			to: index + 1,
			speedKmh: sample.speedKmh,
			directionDegrees: sample.directionDegrees,
			routeBearingDegrees,
			relativeAngleDegrees: components.relativeAngleDegrees,
			headwindComponentKmh: components.headwindComponentKmh,
			crosswindComponentKmh: components.crosswindComponentKmh,
			bucket: components.bucket,
		});

		weightedHeadwindTotal += components.headwindComponentKmh * distanceMeters;
		totalDistance += distanceMeters;
		maxHeadwindKmh = Math.max(maxHeadwindKmh, components.headwindComponentKmh);
		maxCrosswindKmh = Math.max(
			maxCrosswindKmh,
			Math.abs(components.crosswindComponentKmh),
		);

		if (
			components.bucket === "headwind" ||
			components.bucket === "cross_headwind"
		) {
			headwindDistanceMeters += distanceMeters;
		} else if (
			components.bucket === "tailwind" ||
			components.bucket === "cross_tailwind"
		) {
			tailwindDistanceMeters += distanceMeters;
		} else {
			crosswindDistanceMeters += distanceMeters;
		}
	}

	if (segments.length === 0 || totalDistance <= 0) {
		return null;
	}

	const averageHeadwindKmh = weightedHeadwindTotal / totalDistance;

	return {
		source: "open_meteo",
		fetchedAt,
		forecastTime: samples[0]?.time ?? fetchedAt,
		samples,
		segments,
		averageHeadwindKmh,
		maxHeadwindKmh,
		averageTailwindKmh: Math.max(0, -averageHeadwindKmh),
		maxCrosswindKmh,
		headwindDistanceMeters,
		tailwindDistanceMeters,
		crosswindDistanceMeters,
	};
}

function withWindWarning(route: PlannedRoute): PlannedRoute {
	return {
		...route,
		routingWarnings: [...(route.routingWarnings ?? []), windUnavailableWarning],
	};
}

function attachWindAnalysisToRouteEffect(
	route: PlannedRoute,
): Effect.Effect<PlannedRoute, never, TimeoutFetch> {
	return Effect.gen(function* () {
		const sampleCoordinates = getRouteDistanceSamples(route);
		const fetchedAt = new Date().toISOString();
		const result = yield* Effect.result(
			fetchOpenMeteoBatchWindEffect(sampleCoordinates).pipe(
				Effect.map((forecasts) =>
					forecasts.map(
						(forecast, index): RouteWindSample => ({
							coordinate: sampleCoordinates[index] as [number, number],
							speedKmh: forecast.speedKmh,
							directionDegrees: forecast.directionDegrees,
							time: forecast.forecastTime,
							source: "open_meteo",
						}),
					),
				),
			),
		);

		if (Result.isFailure(result)) {
			return withWindWarning(route);
		}

		const windAnalysis = buildWindAnalysis(route, result.success, fetchedAt);

		return windAnalysis ? { ...route, windAnalysis } : route;
	});
}

export function attachWindAnalysisEffect(
	routes: PlannedRoute[],
): Effect.Effect<PlannedRoute[], never, TimeoutFetch> {
	return Effect.all(routes.map(attachWindAnalysisToRouteEffect), {
		concurrency: 3,
	});
}

function isSamePoint(left: [number, number], right: [number, number]) {
	return left[0] === right[0] && left[1] === right[1];
}

function closePolygonRing(points: [number, number][]): [number, number][] {
	const firstPoint = points[0];
	const lastPoint = points[points.length - 1];

	if (!firstPoint) {
		return [];
	}

	if (lastPoint && isSamePoint(firstPoint, lastPoint)) {
		return points;
	}

	return [...points, firstPoint];
}

function getRingSignedArea(points: [number, number][]): number {
	let area = 0;

	for (let index = 0; index < points.length - 1; index += 1) {
		const point = points[index];
		const nextPoint = points[index + 1];

		if (!point || !nextPoint) {
			continue;
		}

		area += point[0] * nextPoint[1] - nextPoint[0] * point[1];
	}

	return area / 2;
}

function ensureCounterClockwiseRing(
	points: [number, number][],
): [number, number][] {
	const closedRing = closePolygonRing(points);
	const openRing = closedRing.slice(0, -1);

	if (getRingSignedArea(closedRing) >= 0) {
		return closedRing;
	}

	return closePolygonRing([...openRing].reverse());
}

function buildAreaPolygon(
	center: [number, number],
	radiusMeters: number,
): [number, number][] {
	const centerLng = toRadians(center[0]);
	const centerLat = toRadians(center[1]);
	const angularDistance = radiusMeters / earthRadiusMeters;
	const coordinates: [number, number][] = [];

	for (let index = 0; index < areaPolygonSegments; index += 1) {
		const bearing = (2 * Math.PI * index) / areaPolygonSegments;
		const lat = Math.asin(
			Math.sin(centerLat) * Math.cos(angularDistance) +
				Math.cos(centerLat) * Math.sin(angularDistance) * Math.cos(bearing),
		);
		const lng =
			centerLng +
			Math.atan2(
				Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centerLat),
				Math.cos(angularDistance) - Math.sin(centerLat) * Math.sin(lat),
			);

		coordinates.push([toDegrees(lng), toDegrees(lat)]);
	}

	return ensureCounterClockwiseRing(coordinates);
}

function getProjectionOrigin(points: [number, number][]) {
	const lng =
		points.reduce((sum, point) => sum + point[0], 0) /
		Math.max(points.length, 1);
	const lat =
		points.reduce((sum, point) => sum + point[1], 0) /
		Math.max(points.length, 1);

	return {
		lng,
		lat,
		cosLat: Math.cos(toRadians(lat)),
	};
}

function buildCorridorPolygon(
	points: [number, number][],
	widthMeters: number,
): [number, number][] {
	const uniquePoints = points.filter((point, index) => {
		const previousPoint = points[index - 1];
		return !previousPoint || getDistanceMeters(previousPoint, point) > 1;
	});
	const fallbackPoint =
		uniquePoints[0] ?? points[0] ?? ([0, 0] as [number, number]);
	const controlPoints: [number, number][] =
		uniquePoints.length >= 2
			? uniquePoints
			: [fallbackPoint, [fallbackPoint[0] + 0.0001, fallbackPoint[1]]];
	const origin = getProjectionOrigin(controlPoints);
	const halfWidthMeters = widthMeters / 2;
	const projected = controlPoints.map((point) => ({
		x:
			toRadians(point[0] - origin.lng) *
			earthRadiusMeters *
			Math.max(origin.cosLat, 1e-6),
		y: toRadians(point[1] - origin.lat) * earthRadiusMeters,
	}));
	const segments = projected.slice(0, -1).map((point, index) => {
		const nextPoint = projected[index + 1] ?? point;
		const dx = nextPoint.x - point.x;
		const dy = nextPoint.y - point.y;
		const length = Math.hypot(dx, dy) || 1;
		const unit = {
			x: dx / length,
			y: dy / length,
		};

		return {
			unit,
			normal: {
				x: -unit.y,
				y: unit.x,
			},
		};
	});
	const left: Array<{ x: number; y: number }> = [];
	const right: Array<{ x: number; y: number }> = [];

	for (const [index, point] of projected.entries()) {
		const previousSegment = segments[Math.max(0, index - 1)] ?? segments[0];
		const nextSegment =
			segments[Math.min(index, segments.length - 1)] ?? previousSegment;
		const summedNormal = {
			x: (previousSegment?.normal.x ?? 0) + (nextSegment?.normal.x ?? 0),
			y: (previousSegment?.normal.y ?? 0) + (nextSegment?.normal.y ?? 0),
		};
		const summedLength = Math.hypot(summedNormal.x, summedNormal.y);
		const miter =
			summedLength > 1e-6
				? {
						x: summedNormal.x / summedLength,
						y: summedNormal.y / summedLength,
					}
				: (nextSegment?.normal ?? { x: 0, y: 1 });
		const denominator =
			miter.x * (nextSegment?.normal.x ?? 0) +
			miter.y * (nextSegment?.normal.y ?? 0);
		const miterLength =
			Math.abs(denominator) > 1e-6
				? Math.min(Math.abs(halfWidthMeters / denominator), halfWidthMeters * 2)
				: halfWidthMeters;
		const offset = {
			x: miter.x * miterLength,
			y: miter.y * miterLength,
		};

		left.push({
			x: point.x + offset.x,
			y: point.y + offset.y,
		});
		right.push({
			x: point.x - offset.x,
			y: point.y - offset.y,
		});
	}

	const unproject = (point: { x: number; y: number }): [number, number] => [
		origin.lng +
			toDegrees(point.x / (earthRadiusMeters * Math.max(origin.cosLat, 1e-6))),
		origin.lat + toDegrees(point.y / earthRadiusMeters),
	];
	return ensureCounterClockwiseRing(
		[...right.reverse(), ...left].map(unproject),
	);
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
			if (stop.label && stop.point) {
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

function clampRoundCourseDistanceMeters(distanceMeters: number): number {
	return Math.min(
		maxRoundCourseDistanceMeters,
		Math.max(minRoundCourseDistanceMeters, distanceMeters),
	);
}

function estimateRoundCourseDistanceMeters(target: RoundCourseTarget): number {
	if (target.kind === "distance") {
		return target.distanceMeters;
	}

	if (target.kind === "duration") {
		return (
			(target.durationMs / (60 * 60 * 1000)) * durationTargetSpeedMetersPerHour
		);
	}

	return (target.ascendMeters / ascendTargetMetersPerKm) * 1000;
}

function getRoundCourseTargetRelativeError(
	route: PlannedRoute,
	target: RoundCourseTarget,
): number {
	if (target.kind === "duration") {
		return Math.abs(route.durationMs - target.durationMs) / target.durationMs;
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

function getRoundCourseTargetValue(
	route: PlannedRoute,
	target: RoundCourseTarget,
): number {
	if (target.kind === "duration") {
		return route.durationMs;
	}

	if (target.kind === "ascend") {
		return route.ascendMeters;
	}

	return route.distanceMeters;
}

function getRoundCourseRequestedTargetValue(target: RoundCourseTarget): number {
	if (target.kind === "duration") {
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

function compareCandidateRoutes(
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

	const leftDurationError =
		target.kind === "duration"
			? Math.abs(left.route.durationMs - target.durationMs)
			: left.route.durationMs;
	const rightDurationError =
		target.kind === "duration"
			? Math.abs(right.route.durationMs - target.durationMs)
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

function getNextRoundCourseBaseDistanceMeters(
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

function buildRoundCourseMissWarning(
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

	if (target.kind === "duration") {
		return `Requested ${formatDurationWarning(target.durationMs)}, but the closest round course came out to ${formatDurationWarning(route.durationMs)}.`;
	}

	return `Requested ${Math.round(target.ascendMeters).toLocaleString()} m up, but the closest round course came out to ${Math.round(route.ascendMeters).toLocaleString()} m up.`;
}

function buildRouteUniquenessKey(route: PlannedRoute): string {
	const sampleCount = Math.min(route.coordinates.length, 12);
	const sampledCoordinates =
		sampleCount === 0
			? []
			: Array.from({ length: sampleCount }, (_, index) => {
					const coordinateIndex =
						sampleCount === 1
							? 0
							: Math.round(
									(index * (route.coordinates.length - 1)) / (sampleCount - 1),
								);
					const coordinate = route.coordinates[coordinateIndex];

					return coordinate
						? `${coordinate[0].toFixed(4)},${coordinate[1].toFixed(4)}`
						: "";
				});

	return [
		Math.round(route.distanceMeters / 250),
		Math.round(route.durationMs / 60000),
		Math.round(route.ascendMeters / 25),
		...sampledCoordinates,
	].join("|");
}

function dedupeRoutes(routes: PlannedRoute[]): PlannedRoute[] {
	const uniqueRoutes = new Map<string, PlannedRoute>();

	for (const route of routes) {
		const key = buildRouteUniquenessKey(route);

		if (!uniqueRoutes.has(key)) {
			uniqueRoutes.set(key, route);
		}
	}

	return [...uniqueRoutes.values()];
}

function dedupeCandidateRoutes(
	candidates: CandidateRouteResult[],
): CandidateRouteResult[] {
	const uniqueCandidates = new Map<string, CandidateRouteResult>();

	for (const candidate of candidates) {
		const key = buildRouteUniquenessKey(candidate.route);

		if (!uniqueCandidates.has(key)) {
			uniqueCandidates.set(key, candidate);
		}
	}

	return [...uniqueCandidates.values()];
}

function mirrorDetailIntervals(
	details: RouteDetailInterval[],
	coordinateCount: number,
): RouteDetailInterval[] {
	const outboundExtent = Math.max(
		coordinateCount - 1,
		...details.map((detail) => detail.to),
		0,
	);

	return [
		...details,
		...details
			.slice()
			.reverse()
			.map((detail) => ({
				from: outboundExtent + (outboundExtent - detail.to),
				to: outboundExtent + (outboundExtent - detail.from),
				value: detail.value,
			})),
	];
}

function buildOutAndBackRoute(
	outboundRoute: PlannedRoute,
	startLabel: string,
	turnaroundLabel: string,
	snappedStart: RouteCoordinate,
	snappedTurnaround: RouteCoordinate,
	shapingWaypoints: RouteWaypoint[] = [],
): PlannedRoute {
	const outboundCoordinates =
		outboundRoute.coordinates.length >= 2
			? outboundRoute.coordinates
			: [snappedStart, snappedTurnaround];

	return {
		...outboundRoute,
		mode: "out_and_back",
		startLabel,
		destinationLabel: turnaroundLabel,
		waypoints: [
			...shapingWaypoints,
			{
				label: turnaroundLabel,
				coordinate: snappedTurnaround,
			},
		],
		distanceMeters: outboundRoute.distanceMeters * 2,
		durationMs: outboundRoute.durationMs * 2,
		ascendMeters: outboundRoute.ascendMeters + outboundRoute.descendMeters,
		descendMeters: outboundRoute.descendMeters + outboundRoute.ascendMeters,
		coordinates: [
			...outboundCoordinates,
			...outboundCoordinates.slice(0, -1).reverse(),
		],
		surfaceDetails: mirrorDetailIntervals(
			outboundRoute.surfaceDetails,
			outboundCoordinates.length,
		),
		smoothnessDetails: mirrorDetailIntervals(
			outboundRoute.smoothnessDetails,
			outboundCoordinates.length,
		),
	};
}

function mapRouteBoundaryToGenerationError(
	logPrefix: string,
	userMessage: string,
) {
	return (
		error: GraphHopperRouteBoundaryError,
	): RouteGenerationError | GraphHopperRouteBoundaryError => {
		if (
			isMissingGraphHopperApiKeyError(error) ||
			isGraphHopperRoutePointLimitError(error)
		) {
			return error;
		}

		return new RouteGenerationError(logPrefix, userMessage, error);
	};
}

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

export function searchPointToPointRoutesEffect(
	input: PointToPointRouteSearchInput,
): Effect.Effect<
	PlannedRoute[],
	RouteGenerationError | GraphHopperRouteBoundaryError,
	GraphHopperConfig | TimeoutFetch
> {
	return Effect.gen(function* () {
		const routePoints = input.stops.map((stop) => stop.point);
		const { routes, snappedWaypointSets } = yield* requestRoutesEffect(
			routePoints,
			{
				mode: "point_to_point",
				spatialConstraint: input.spatialConstraint,
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

		return yield* attachWindAnalysisEffect(normalizedRoutes);
	});
}

export function searchOutAndBackRoutesEffect(
	input: OutAndBackRouteSearchInput,
): Effect.Effect<
	PlannedRoute[],
	RouteGenerationError | GraphHopperRouteBoundaryError,
	GraphHopperConfig | TimeoutFetch
> {
	return Effect.gen(function* () {
		const routePoints = input.stops.map((stop) => stop.point);
		const { routes, snappedWaypointSets } = yield* requestRoutesEffect(
			routePoints,
			{
				mode: "out_and_back",
				spatialConstraint: input.spatialConstraint,
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

		return yield* attachWindAnalysisEffect(normalizedRoutes);
	});
}

function searchRoundCourseCandidateRoutesEffect(
	startPoint: [number, number],
	target: RoundCourseTarget,
	spatialConstraint?: ResolvedRouteSpatialConstraint,
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

			const attemptEffects = requestedDistances.map(
				(requestedDistanceMeters, candidateIndex) => {
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

			const candidateResults: RoundCourseCandidateAttempt[] = yield* Effect.all(
				attemptEffects,
				{
					concurrency: "unbounded",
				},
			);

			for (const candidateResult of candidateResults) {
				if (candidateResult._tag === "RoundCourseCandidateSuccess") {
					successfulCandidates.push(...candidateResult.candidates);
					continue;
				}

				candidateFailures.push(candidateResult);
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

		return {
			routes: rankedCandidates.slice(0, desiredCount).map((candidate) => {
				const missWarning = buildRoundCourseMissWarning(
					candidate.route,
					target,
				);

				if (!missWarning) {
					return candidate.route;
				}

				return {
					...candidate.route,
					routingWarnings: [
						...(candidate.route.routingWarnings ?? []),
						missWarning,
					],
				};
			}),
			candidateErrors: candidateFailures.map(
				serializeRoundCourseCandidateFailure,
			),
		};
	});
}

export function searchRoundCourseRoutesEffect(
	input: RoundCourseRouteSearchInput,
): Effect.Effect<
	RoundCourseRouteSearchResult,
	RouteGenerationError | GraphHopperRouteBoundaryError,
	GraphHopperConfig | TimeoutFetch
> {
	return Effect.gen(function* () {
		let normalizedRoutes: PlannedRoute[];
		let candidateErrors: RoundCourseCandidateError[] | undefined;

		if (input.waypoints.length === 0) {
			const searchResult = yield* searchRoundCourseCandidateRoutesEffect(
				input.start.point,
				input.target,
				input.spatialConstraint,
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

			normalizedRoutes = dedupeRoutes(
				routes.map((route, routeIndex) => {
					const snappedWaypoints = snappedWaypointSets[routeIndex] ?? [];

					return {
						...route,
						mode: "round_course" as const,
						startLabel: input.start.label,
						destinationLabel: input.start.label,
						roundCourseTarget: input.target,
						waypoints: input.waypoints.map(
							(waypoint, waypointIndex): RouteWaypoint => ({
								label: waypoint.label,
								coordinate:
									snappedWaypoints[waypointIndex + 1] ?? waypoint.point,
							}),
						),
						routingWarnings: [
							...(route.routingWarnings ?? []),
							"Manual shaping points make the round-course target best-effort.",
						],
					};
				}),
			).map((route) => applyManualEditing(route, input.manualEditing));
		}

		if (normalizedRoutes.length === 0) {
			return yield* Effect.fail(
				new RouteGenerationError(
					"Failed to generate GraphHopper round course",
					"GraphHopper could not generate a round course right now.",
				),
			);
		}

		const routesWithWind = yield* attachWindAnalysisEffect(normalizedRoutes);

		return candidateErrors
			? { routes: routesWithWind, candidateErrors }
			: { routes: routesWithWind };
	});
}
