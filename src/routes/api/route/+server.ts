import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import type {
	PlannedRoute,
	ManualRouteEditingState,
	ResolvedRouteSpatialConstraint,
	RoundCourseTarget,
	RouteApiError,
	RouteCoordinate,
	RouteDetailInterval,
	RouteMode,
	RouteRequestPayload,
	RouteSpatialConstraintInput,
	RouteStopInput,
	RouteWaypoint,
	SpatialConstraintEnforcement,
} from "$lib/route-planning";
import {
	geocodeLocation,
	graphHopperApiBaseUrl,
	missingGraphHopperApiKeyMessage,
} from "$lib/server/graphhopper";

type GraphHopperPath = {
	bbox?: number[];
	distance?: number;
	time?: number;
	ascend?: number;
	descend?: number;
	points?: {
		coordinates?: RouteCoordinate[];
	};
	snapped_waypoints?: {
		coordinates?: RouteCoordinate[];
	};
	details?: Record<string, Array<[number, number, string]>>;
};

type GraphHopperRouteResponse = {
	paths?: GraphHopperPath[];
};

type GraphHopperPriorityRule = {
	if?: string;
	else?: string;
	multiply_by: string;
};

type GraphHopperCustomModel = {
	priority: GraphHopperPriorityRule[];
	distance_influence: number;
	areas?: {
		type: "FeatureCollection";
		features: Array<{
			type: "Feature";
			id: string;
			properties: Record<string, never>;
			geometry: {
				type: "Polygon";
				coordinates: [number, number][][];
			};
		}>;
	};
};

type GraphHopperRouteRequestBody = {
	profile: "bike" | "racingbike";
	points: [number, number][];
	points_encoded: false;
	elevation: true;
	instructions: false;
	calc_points: true;
	details: typeof routeDetailKeys;
	snap_preventions?: string[];
	"ch.disable"?: true;
	custom_model?: GraphHopperCustomModel;
	algorithm?: "round_trip" | "alternative_route";
	"round_trip.distance"?: number;
	"round_trip.seed"?: number;
	"alternative_route.max_paths"?: number;
	"alternative_route.max_weight_factor"?: number;
	"alternative_route.max_share_factor"?: number;
};
type GraphHopperProfile = GraphHopperRouteRequestBody["profile"];
type RouteRequestStrategy = {
	profile: GraphHopperProfile;
	useCustomModel: boolean;
	routingStrategy: string;
	routingWarnings: string[];
};

const maxRoutePoints = 5;
const maxWaypoints = maxRoutePoints - 2;
const routeDetailKeys = [
	"surface",
	"smoothness",
	"road_class",
	"road_environment",
	"road_access",
	"bike_network",
] as const;
type LegacyRouteRequestPayload = {
	startQuery?: string;
	waypointQueries?: string[];
	destinationQuery?: string;
};

type RoundCourseRouteRequestPayloadInput = {
	mode?: "round_course";
	start?: RouteStopInput;
	waypoints?: RouteStopInput[];
	target?: unknown;
	requestedDistanceMeters?: unknown;
};
type OutAndBackRouteRequestPayloadInput = {
	mode?: "out_and_back";
	start?: RouteStopInput;
	waypoints?: RouteStopInput[];
	turnaround?: RouteStopInput;
};

type StopField = "startQuery" | "destinationQuery" | "waypointQueries";
type RouteStop = {
	kind: "start" | "waypoint" | "destination";
	input: RouteStopInput;
	field: StopField;
	index?: number;
	label?: string;
	point?: [number, number];
};

type CandidateRouteResult = {
	route: PlannedRoute;
	requestedDistanceMeters: number;
	sequence: number;
};

type RouteRequestOptions = {
	mode: RouteMode;
	roundTripDistanceMeters?: number;
	roundTripSeed?: number;
	roundCourseTarget?: RoundCourseTarget;
	spatialConstraint?: ResolvedRouteSpatialConstraint;
	alternativeMaxPaths?: number;
	alternativeMaxWeightFactor?: number;
	alternativeMaxShareFactor?: number;
};

type NormalizedGraphHopperRoute = {
	route: PlannedRoute;
	snappedWaypoints: RouteCoordinate[];
};

const minRoundCourseDurationMs = 15 * 60 * 1000;
const minRoundCourseAscendMeters = 50;
const minRoundCourseDistanceMeters = 10_000;
const maxRoundCourseDistanceMeters = 220_000;
const durationTargetSpeedMetersPerHour = 22_000;
const ascendTargetMetersPerKm = 12;
const desiredAlternativeRoutes = 3;
const alternativeRouteMaxWeightFactor = 1.4;
const alternativeRouteMaxShareFactor = 0.6;
const roundCourseSearchDistanceMultipliers = [0.9, 1, 1.1] as const;
const roundCourseSearchSeeds = [
	[11, 37, 73],
	[109, 149, 191],
] as const;
const minAreaRadiusMeters = 1_000;
const maxAreaRadiusMeters = 250_000;
const minCorridorWidthMeters = 2_000;
const maxCorridorWidthMeters = 80_000;
const areaPolygonSegments = 48;
const earthRadiusMeters = 6_371_008.8;

const roadBikePriorityRules: GraphHopperPriorityRule[] = [
	{
		if: "road_access == PRIVATE",
		multiply_by: "0",
	},
	{
		if: "road_environment == FERRY || road_environment == TUNNEL",
		multiply_by: "0.05",
	},
	{
		if: "road_class == TRACK || road_class == PATH || road_class == FOOTWAY || road_class == STEPS",
		multiply_by: "0.02",
	},
	{
		if: "road_class == TRUNK || road_class == PRIMARY",
		multiply_by: "0.3",
	},
	{
		if: "road_class == LIVING_STREET || road_class == RESIDENTIAL || road_class == SERVICE",
		multiply_by: "0.7",
	},
	{
		if: "surface == DIRT || surface == GROUND || surface == GRAVEL || surface == SAND || surface == MUD || surface == GRASS || surface == EARTH || surface == UNPAVED",
		multiply_by: "0.02",
	},
	{
		if: "surface == COBBLESTONE || surface == SETT || surface == UNHEWN_COBBLESTONE || surface == PAVING_STONES",
		multiply_by: "0.2",
	},
	{
		if: "smoothness == BAD || smoothness == VERY_BAD || smoothness == HORRIBLE || smoothness == VERY_HORRIBLE || smoothness == IMPASSABLE",
		multiply_by: "0.1",
	},
];

function getTooManyWaypointsMessage() {
	return `You can add up to ${maxWaypoints} waypoints per route.`;
}

function buildRoadBikeCustomModel(
	spatialConstraint?: ResolvedRouteSpatialConstraint,
): GraphHopperCustomModel {
	const priority: GraphHopperPriorityRule[] = spatialConstraint
		? [
				{
					if: "in_route_constraint",
					multiply_by: "1",
				},
				{
					else: "",
					multiply_by:
						spatialConstraint.enforcement === "strict" ? "0" : "0.08",
				},
				...roadBikePriorityRules,
			]
		: [...roadBikePriorityRules];

	return {
		priority,
		distance_influence: 55,
		...(spatialConstraint
			? {
					areas: {
						type: "FeatureCollection" as const,
						features: [
							{
								type: "Feature" as const,
								id: "route_constraint",
								properties: {},
								geometry: {
									type: "Polygon" as const,
									coordinates: [spatialConstraint.polygon],
								},
							},
						],
					},
				}
			: {}),
	};
}

const routeRequestStrategies: RouteRequestStrategy[] = [
	{
		profile: "racingbike",
		useCustomModel: true,
		routingStrategy:
			"GraphHopper racingbike with asphalt-first, lower-traffic road-bike tuning.",
		routingWarnings: [],
	},
	{
		profile: "racingbike",
		useCustomModel: false,
		routingStrategy: "GraphHopper racingbike base profile.",
		routingWarnings: [
			"Advanced paved-road tuning was unavailable, so the built-in racingbike profile was used.",
		],
	},
	{
		profile: "bike",
		useCustomModel: true,
		routingStrategy:
			"GraphHopper bike with asphalt-first, lower-traffic road-bike tuning.",
		routingWarnings: [
			"GraphHopper did not accept the racingbike profile for this route, so tuned bike routing was used instead.",
		],
	},
	{
		profile: "bike",
		useCustomModel: false,
		routingStrategy: "GraphHopper default bike profile.",
		routingWarnings: [
			"Advanced road-bike routing was unavailable for this route, so GraphHopper's default bike profile was used.",
		],
	},
];

function errorResponse(
	status: number,
	error: string,
	fieldErrors?: RouteApiError["fieldErrors"],
) {
	return json(
		{
			error,
			fieldErrors,
		},
		{ status },
	);
}

function normalizeDetailIntervals(
	detail: Array<[number, number, string]> | undefined,
): RouteDetailInterval[] {
	if (!detail) {
		return [];
	}

	return detail
		.filter((interval) => interval.length >= 3)
		.map(([from, to, value]) => ({
			from,
			to,
			value,
		}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function normalizeFiniteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

function normalizeSpatialConstraintEnforcement(
	value: unknown,
): SpatialConstraintEnforcement {
	return value === "strict" ? "strict" : "preferred";
}

function normalizeSpatialConstraintInput(
	payloadRecord: Record<string, unknown>,
	mode: RouteMode,
): {
	constraint?: RouteSpatialConstraintInput;
	error?: string;
} {
	const rawConstraint = payloadRecord.spatialConstraint;

	if (rawConstraint === undefined || rawConstraint === null) {
		return {};
	}

	if (!isRecord(rawConstraint) || typeof rawConstraint.kind !== "string") {
		return {
			error: "Choose an area or corridor constraint.",
		};
	}

	const enforcement = normalizeSpatialConstraintEnforcement(
		rawConstraint.enforcement,
	);

	if (rawConstraint.kind === "area") {
		const center = normalizeStopInput(rawConstraint.center);
		const radiusMeters = normalizeFiniteNumber(rawConstraint.radiusMeters);

		if (!center.label && !center.point) {
			return {
				error: "Enter an area center.",
			};
		}

		if (
			radiusMeters === null ||
			radiusMeters < minAreaRadiusMeters ||
			radiusMeters > maxAreaRadiusMeters
		) {
			return {
				error: "Enter an area radius from 1 to 250 km.",
			};
		}

		return {
			constraint: {
				kind: "area",
				center,
				radiusMeters,
				enforcement,
			},
		};
	}

	if (rawConstraint.kind === "corridor") {
		if (mode === "round_course") {
			return {
				error:
					"Corridor constraints are available for point-to-point and out-and-back routes.",
			};
		}

		const widthMeters = normalizeFiniteNumber(rawConstraint.widthMeters);

		if (
			widthMeters === null ||
			widthMeters < minCorridorWidthMeters ||
			widthMeters > maxCorridorWidthMeters
		) {
			return {
				error: "Enter a corridor width from 2 to 80 km.",
			};
		}

		return {
			constraint: {
				kind: "corridor",
				widthMeters,
				enforcement,
			},
		};
	}

	return {
		error: "Choose an area or corridor constraint.",
	};
}

function normalizeManualEditingInput(
	value: unknown,
): ManualRouteEditingState | undefined {
	if (!isRecord(value) || !Array.isArray(value.lockedSegmentIndexes)) {
		return undefined;
	}

	const lockedSegmentIndexes = value.lockedSegmentIndexes.filter(
		(index): index is number => Number.isInteger(index) && index >= 0,
	);

	return lockedSegmentIndexes.length > 0
		? {
				lockedSegmentIndexes,
			}
		: undefined;
}

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

async function resolveSpatialConstraint(
	fetchFn: typeof fetch,
	input: RouteSpatialConstraintInput | undefined,
	routePoints: [number, number][],
): Promise<{
	constraint?: ResolvedRouteSpatialConstraint;
	error?: string;
	status?: number;
	fieldError?: string;
}> {
	if (!input) {
		return {};
	}

	if (input.kind === "area") {
		const resolvedCenter = input.center.point
			? {
					label: input.center.label || "Selected area center",
					point: input.center.point,
				}
			: await geocodeLocation(fetchFn, input.center.label);

		if (!resolvedCenter?.point) {
			return {
				status: 422,
				error: "We couldn't resolve the area center.",
				fieldError: "We couldn't resolve that area center.",
			};
		}
		const resolvedCenterPoint = resolvedCenter.point;

		if (
			input.enforcement === "strict" &&
			routePoints.some(
				(point) =>
					getDistanceMeters(point, resolvedCenterPoint) > input.radiusMeters,
			)
		) {
			return {
				status: 400,
				error: "Route stops must be inside the requested area.",
				fieldError:
					"Move the area or increase its radius so all stops are inside it.",
			};
		}

		return {
			constraint: {
				kind: "area",
				label: resolvedCenter.label,
				center: resolvedCenterPoint,
				radiusMeters: input.radiusMeters,
				enforcement: input.enforcement,
				polygon: buildAreaPolygon(resolvedCenterPoint, input.radiusMeters),
			},
		};
	}

	return {
		constraint: {
			kind: "corridor",
			widthMeters: input.widthMeters,
			enforcement: input.enforcement,
			polygon: buildCorridorPolygon(routePoints, input.widthMeters),
		},
	};
}

function clampRoundCourseDistanceMeters(distanceMeters: number): number {
	return Math.min(
		maxRoundCourseDistanceMeters,
		Math.max(minRoundCourseDistanceMeters, distanceMeters),
	);
}

function getRoundCourseTargetError(rawTarget: unknown): string {
	if (isRecord(rawTarget) && rawTarget.kind === "duration") {
		return "Enter a target time.";
	}

	if (isRecord(rawTarget) && rawTarget.kind === "ascend") {
		return "Enter a target climb.";
	}

	return "Enter a target distance.";
}

function normalizeRoundCourseTarget(
	payloadRecord: Record<string, unknown>,
): RoundCourseTarget | null {
	if ("target" in payloadRecord) {
		const rawTarget = payloadRecord.target;

		if (!isRecord(rawTarget) || typeof rawTarget.kind !== "string") {
			return null;
		}

		if (rawTarget.kind === "distance") {
			const distanceMeters = normalizeFiniteNumber(rawTarget.distanceMeters);
			return distanceMeters === null
				? null
				: {
						kind: "distance",
						distanceMeters,
					};
		}

		if (rawTarget.kind === "duration") {
			const durationMs = normalizeFiniteNumber(rawTarget.durationMs);
			return durationMs === null
				? null
				: {
						kind: "duration",
						durationMs,
					};
		}

		if (rawTarget.kind === "ascend") {
			const ascendMeters = normalizeFiniteNumber(rawTarget.ascendMeters);
			return ascendMeters === null
				? null
				: {
						kind: "ascend",
						ascendMeters,
					};
		}

		return null;
	}

	if ("requestedDistanceMeters" in payloadRecord) {
		const distanceMeters = normalizeFiniteNumber(
			payloadRecord.requestedDistanceMeters,
		);
		return distanceMeters === null
			? null
			: {
					kind: "distance",
					distanceMeters,
				};
	}

	return null;
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

function normalizeGraphHopperPath(
	path: GraphHopperPath,
	points: [number, number][],
	options: RouteRequestOptions,
	selectedStrategy: RouteRequestStrategy,
): NormalizedGraphHopperRoute | null {
	const coordinates = path.points?.coordinates;
	const snappedWaypoints = path.snapped_waypoints?.coordinates;
	const bbox = path.bbox;
	const normalizedSnappedWaypoints =
		snappedWaypoints && snappedWaypoints.length === points.length
			? snappedWaypoints
			: points.map((point): RouteCoordinate => [point[0], point[1]]);

	if (
		!bbox ||
		bbox.length < 4 ||
		!coordinates ||
		coordinates.length < 2 ||
		typeof path.distance !== "number" ||
		typeof path.time !== "number" ||
		typeof path.ascend !== "number" ||
		typeof path.descend !== "number"
	) {
		return null;
	}

	return {
		route: {
			mode: options.mode,
			source: {
				kind: "graphhopper",
			},
			startLabel: "",
			destinationLabel: "",
			roundCourseTarget:
				options.mode === "round_course" ? options.roundCourseTarget : undefined,
			spatialConstraint: options.spatialConstraint,
			routingProfile: selectedStrategy.profile,
			routingStrategy: selectedStrategy.routingStrategy,
			routingWarnings: [...selectedStrategy.routingWarnings],
			waypoints: [],
			bounds: [bbox[0], bbox[1], bbox[2], bbox[3]],
			distanceMeters: path.distance,
			durationMs: path.time,
			ascendMeters: path.ascend,
			descendMeters: path.descend,
			coordinates,
			surfaceDetails: normalizeDetailIntervals(path.details?.surface),
			smoothnessDetails: normalizeDetailIntervals(path.details?.smoothness),
		},
		snappedWaypoints: normalizedSnappedWaypoints,
	};
}

async function searchRoundCourseRoutes(
	fetchFn: typeof fetch,
	startPoint: [number, number],
	target: RoundCourseTarget,
	spatialConstraint?: ResolvedRouteSpatialConstraint,
	desiredCount = desiredAlternativeRoutes,
): Promise<PlannedRoute[]> {
	let baseDistanceMeters = clampRoundCourseDistanceMeters(
		estimateRoundCourseDistanceMeters(target),
	);
	const successfulCandidates: CandidateRouteResult[] = [];
	let sequence = 0;
	let lastError: unknown = null;

	for (const [roundIndex, seeds] of roundCourseSearchSeeds.entries()) {
		const requestedDistances = roundCourseSearchDistanceMultipliers.map(
			(multiplier) =>
				clampRoundCourseDistanceMeters(baseDistanceMeters * multiplier),
		);
		const candidateResults = await Promise.allSettled(
			requestedDistances.map((requestedDistanceMeters, candidateIndex) => {
				const candidateSequence = sequence++;
				return requestRoutes(fetchFn, [startPoint], {
					mode: "round_course",
					roundTripDistanceMeters: requestedDistanceMeters,
					roundTripSeed: seeds[candidateIndex],
					roundCourseTarget: target,
					spatialConstraint,
				}).then(({ routes }) =>
					routes.map((route, routeIndex) => ({
						route,
						requestedDistanceMeters,
						sequence: candidateSequence * desiredAlternativeRoutes + routeIndex,
					})),
				);
			}),
		);

		for (const candidateResult of candidateResults) {
			if (candidateResult.status === "fulfilled") {
				successfulCandidates.push(...candidateResult.value);
				continue;
			}

			lastError = candidateResult.reason;
		}

		const uniqueCandidates = dedupeCandidateRoutes(successfulCandidates);

		if (roundIndex === 0 && uniqueCandidates.length > 0) {
			const bestCandidate = [...uniqueCandidates].sort((left, right) =>
				compareCandidateRoutes(left, right, target),
			)[0];

			if (bestCandidate) {
				baseDistanceMeters = clampRoundCourseDistanceMeters(
					target.kind === "duration"
						? (bestCandidate.requestedDistanceMeters * target.durationMs) /
								Math.max(bestCandidate.route.durationMs, 1)
						: target.kind === "ascend"
							? (bestCandidate.requestedDistanceMeters * target.ascendMeters) /
								Math.max(bestCandidate.route.ascendMeters, 1)
							: bestCandidate.requestedDistanceMeters,
				);
			}
		}
	}

	const uniqueCandidates = dedupeCandidateRoutes(successfulCandidates);

	if (uniqueCandidates.length === 0) {
		throw lastError instanceof Error
			? lastError
			: new Error("GraphHopper could not generate a round course right now.");
	}

	const rankedCandidates = [...uniqueCandidates].sort((left, right) =>
		compareCandidateRoutes(left, right, target),
	);

	return rankedCandidates.slice(0, desiredCount).map((candidate) => {
		const missWarning = buildRoundCourseMissWarning(candidate.route, target);

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
	});
}

function normalizeStopInput(value: unknown): RouteStopInput {
	if (typeof value === "string") {
		return {
			label: value.trim(),
		};
	}

	if (!value || typeof value !== "object") {
		return {
			label: "",
		};
	}

	const candidate = value as {
		label?: unknown;
		point?: unknown;
	};
	const point = Array.isArray(candidate.point) ? candidate.point : undefined;

	return {
		label: typeof candidate.label === "string" ? candidate.label.trim() : "",
		point:
			point &&
			point.length >= 2 &&
			typeof point[0] === "number" &&
			Number.isFinite(point[0]) &&
			typeof point[1] === "number" &&
			Number.isFinite(point[1])
				? [point[0], point[1]]
				: undefined,
	};
}

async function requestRoutes(
	fetchFn: typeof fetch,
	points: [number, number][],
	options: RouteRequestOptions,
): Promise<{
	routes: PlannedRoute[];
	snappedWaypointSets: RouteCoordinate[][];
}> {
	const key = env.GRAPHHOPPER_API_KEY?.trim();

	if (!key) {
		throw new Error(missingGraphHopperApiKeyMessage);
	}

	const routeUrl = `${graphHopperApiBaseUrl}/route?key=${encodeURIComponent(key)}`;
	function buildRouteRequestBody(
		strategy: RouteRequestStrategy,
	): GraphHopperRouteRequestBody {
		const requestBody: GraphHopperRouteRequestBody = {
			profile: strategy.profile,
			points,
			points_encoded: false,
			elevation: true,
			instructions: false,
			calc_points: true,
			details: routeDetailKeys,
		};

		if (strategy.useCustomModel) {
			requestBody.snap_preventions = ["ferry", "tunnel"];
			requestBody["ch.disable"] = true;
			requestBody.custom_model = buildRoadBikeCustomModel(
				options.spatialConstraint,
			);
		}

		if (options.mode === "round_course") {
			requestBody.algorithm = "round_trip";
			requestBody["round_trip.distance"] = Math.round(
				options.roundTripDistanceMeters ?? 0,
			);

			if (typeof options.roundTripSeed === "number") {
				requestBody["round_trip.seed"] = options.roundTripSeed;
			}
		} else if ((options.alternativeMaxPaths ?? 1) > 1) {
			requestBody.algorithm = "alternative_route";
			requestBody["alternative_route.max_paths"] = options.alternativeMaxPaths;
			requestBody["alternative_route.max_weight_factor"] =
				options.alternativeMaxWeightFactor;
			requestBody["alternative_route.max_share_factor"] =
				options.alternativeMaxShareFactor;
		}

		return requestBody;
	}

	async function sendRouteRequest(body: GraphHopperRouteRequestBody) {
		const response = await fetchFn(routeUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const details = await response.text();
			throw new Error(
				`Routing failed with status ${response.status}${details ? `: ${details}` : ""}`,
			);
		}

		return (await response.json()) as GraphHopperRouteResponse;
	}

	let payload: GraphHopperRouteResponse | null = null;
	let selectedStrategy: RouteRequestStrategy | null = null;
	let lastError: unknown = null;
	const strategies = options.spatialConstraint
		? routeRequestStrategies.filter((strategy) => strategy.useCustomModel)
		: routeRequestStrategies;

	for (const strategy of strategies) {
		try {
			payload = await sendRouteRequest(buildRouteRequestBody(strategy));
			selectedStrategy = strategy;
			break;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			if (message.includes("Too many points for Routing API")) {
				throw error;
			}

			if (!message.includes("Routing failed with status 400")) {
				throw error;
			}

			lastError = error;
			console.warn(
				`GraphHopper rejected ${strategy.profile}${strategy.useCustomModel ? " with road-bike tuning" : " routing"}. Trying the next routing strategy.`,
				error,
			);
		}
	}

	if (!payload || !selectedStrategy) {
		throw lastError instanceof Error
			? lastError
			: new Error("GraphHopper did not accept any routing strategy");
	}

	const normalizedRoutes = (payload.paths ?? [])
		.map((path) =>
			normalizeGraphHopperPath(path, points, options, selectedStrategy),
		)
		.filter((route): route is NormalizedGraphHopperRoute => route !== null);

	if (normalizedRoutes.length === 0) {
		throw new Error("GraphHopper route response was incomplete");
	}

	return {
		routes: normalizedRoutes.map(({ route }) => route),
		snappedWaypointSets: normalizedRoutes.map(
			({ snappedWaypoints }) => snappedWaypoints,
		),
	};
}

export const POST: RequestHandler = async ({ fetch, request }) => {
	let payload:
		| Partial<RouteRequestPayload>
		| RoundCourseRouteRequestPayloadInput
		| OutAndBackRouteRequestPayloadInput
		| LegacyRouteRequestPayload;

	try {
		payload = (await request.json()) as typeof payload;
	} catch {
		return errorResponse(400, "Invalid route request payload.");
	}

	const payloadRecord = payload as Record<string, unknown>;
	const requestedMode =
		payloadRecord.mode === "round_course"
			? "round_course"
			: payloadRecord.mode === "out_and_back"
				? "out_and_back"
				: "point_to_point";
	const hasStructuredPayload =
		"start" in payloadRecord ||
		"waypoints" in payloadRecord ||
		"destination" in payloadRecord ||
		"turnaround" in payloadRecord ||
		"target" in payloadRecord ||
		"spatialConstraint" in payloadRecord ||
		"requestedDistanceMeters" in payloadRecord ||
		"mode" in payloadRecord;
	const structuredPayload = hasStructuredPayload
		? (payload as Partial<RouteRequestPayload>)
		: null;
	const structuredPointToPointPayload =
		structuredPayload && requestedMode === "point_to_point"
			? (structuredPayload as Partial<
					Extract<RouteRequestPayload, { mode: "point_to_point" }>
				>)
			: null;
	const structuredOutAndBackPayload =
		structuredPayload && requestedMode === "out_and_back"
			? (structuredPayload as Partial<
					Extract<RouteRequestPayload, { mode: "out_and_back" }>
				>)
			: null;
	const legacyPayload = hasStructuredPayload
		? null
		: (payload as LegacyRouteRequestPayload);
	const startInput = normalizeStopInput(
		structuredPayload ? structuredPayload.start : legacyPayload?.startQuery,
	);
	const fieldErrors: RouteApiError["fieldErrors"] = {};
	const spatialConstraintResult = normalizeSpatialConstraintInput(
		payloadRecord,
		requestedMode,
	);
	const spatialConstraintInput = spatialConstraintResult.constraint;
	const manualEditing = normalizeManualEditingInput(
		payloadRecord.manualEditing,
	);

	if (spatialConstraintResult.error) {
		fieldErrors.spatialConstraint = spatialConstraintResult.error;
	}

	if (requestedMode === "round_course") {
		const roundCourseTarget = normalizeRoundCourseTarget(payloadRecord);
		const rawWaypointInputs = Array.isArray(
			(payloadRecord as RoundCourseRouteRequestPayloadInput).waypoints,
		)
			? ((payloadRecord as RoundCourseRouteRequestPayloadInput).waypoints ?? [])
			: [];
		const waypointInputs = rawWaypointInputs.map((input) =>
			normalizeStopInput(input),
		);

		if (!startInput.label) {
			fieldErrors.startQuery = "Enter a start point.";
		}

		if (waypointInputs.length > maxWaypoints) {
			const waypointError = getTooManyWaypointsMessage();
			return errorResponse(400, waypointError, {
				...fieldErrors,
				waypointQueries: waypointInputs.map(() => waypointError),
			});
		}

		const waypointFieldErrors = waypointInputs.map(
			(waypoint: RouteStopInput) =>
				waypoint.label ? null : "Enter a waypoint or remove this stop.",
		);

		if (waypointFieldErrors.some((error: string | null) => !!error)) {
			fieldErrors.waypointQueries = waypointFieldErrors.map(
				(error: string | null) => error ?? "",
			);
		}

		if (!roundCourseTarget) {
			fieldErrors.roundCourseTarget = getRoundCourseTargetError(
				payloadRecord.target,
			);
		} else if (
			(roundCourseTarget.kind === "distance" &&
				roundCourseTarget.distanceMeters <= 0) ||
			(roundCourseTarget.kind === "duration" &&
				roundCourseTarget.durationMs < minRoundCourseDurationMs) ||
			(roundCourseTarget.kind === "ascend" &&
				roundCourseTarget.ascendMeters < minRoundCourseAscendMeters)
		) {
			fieldErrors.roundCourseTarget = getRoundCourseTargetError(
				payloadRecord.target,
			);
		}

		if (Object.keys(fieldErrors).length > 0) {
			return errorResponse(
				400,
				"Start and a round-course target are required.",
				fieldErrors,
			);
		}

		if (
			roundCourseTarget &&
			spatialConstraintInput?.kind === "area" &&
			spatialConstraintInput.enforcement === "strict" &&
			roundCourseTarget.kind === "distance" &&
			roundCourseTarget.distanceMeters >
				2 * Math.PI * spatialConstraintInput.radiusMeters
		) {
			return errorResponse(
				400,
				"Increase the area radius or reduce the target distance.",
				{
					spatialConstraint:
						"Increase the area radius or reduce the target distance.",
				},
			);
		}

		try {
			const resolvedStart = startInput.point
				? {
						label: startInput.label,
						point: startInput.point,
					}
				: await geocodeLocation(fetch, startInput.label);

			if (!resolvedStart?.point || !resolvedStart.label) {
				return errorResponse(422, "We couldn't resolve the start point.", {
					startQuery: "We couldn't resolve that start point.",
				});
			}

			const resolvedWaypoints = await Promise.all(
				waypointInputs.map(async (input, index) => {
					if (input.point) {
						return {
							index,
							label: input.label,
							point: input.point,
						};
					}

					const resolved = await geocodeLocation(fetch, input.label);
					return resolved
						? {
								index,
								label: resolved.label,
								point: resolved.point,
							}
						: {
								index,
								label: "",
								point: undefined,
							};
				}),
			);
			const unresolvedWaypoints = waypointInputs.map(() => "");

			for (const waypoint of resolvedWaypoints) {
				if (waypoint.label && waypoint.point) {
					continue;
				}

				unresolvedWaypoints[waypoint.index] =
					"We couldn't resolve that waypoint.";
			}

			if (unresolvedWaypoints.some((error: string) => error.length > 0)) {
				return errorResponse(
					422,
					"We couldn't resolve one or more locations.",
					{
						waypointQueries: unresolvedWaypoints,
					},
				);
			}

			const routePoints = [
				resolvedStart.point,
				...resolvedWaypoints.map(
					(waypoint) => waypoint.point as [number, number],
				),
			];

			const resolvedSpatialConstraint = await resolveSpatialConstraint(
				fetch,
				spatialConstraintInput,
				routePoints,
			);

			if (resolvedSpatialConstraint.fieldError) {
				return errorResponse(
					resolvedSpatialConstraint.status ?? 400,
					resolvedSpatialConstraint.error ?? "Route bounds are invalid.",
					{
						spatialConstraint: resolvedSpatialConstraint.fieldError,
					},
				);
			}

			let normalizedRoutes: PlannedRoute[];

			if (resolvedWaypoints.length === 0) {
				normalizedRoutes = dedupeRoutes(
					await searchRoundCourseRoutes(
						fetch,
						resolvedStart.point,
						roundCourseTarget as RoundCourseTarget,
						resolvedSpatialConstraint.constraint,
					),
				).map((route) =>
					applyManualEditing(
						{
							...route,
							startLabel: resolvedStart.label,
							destinationLabel: resolvedStart.label,
							waypoints: [],
						},
						manualEditing,
					),
				);
			} else {
				const { routes, snappedWaypointSets } = await requestRoutes(
					fetch,
					[...routePoints, resolvedStart.point],
					{
						mode: "point_to_point",
						spatialConstraint: resolvedSpatialConstraint.constraint,
						alternativeMaxPaths: desiredAlternativeRoutes,
						alternativeMaxWeightFactor: alternativeRouteMaxWeightFactor,
						alternativeMaxShareFactor: alternativeRouteMaxShareFactor,
					},
				);

				normalizedRoutes = dedupeRoutes(
					routes.map((route, routeIndex) => {
						const snappedWaypoints = snappedWaypointSets[routeIndex] ?? [];

						return {
							...route,
							mode: "round_course" as const,
							startLabel: resolvedStart.label,
							destinationLabel: resolvedStart.label,
							roundCourseTarget: roundCourseTarget as RoundCourseTarget,
							waypoints: resolvedWaypoints.map(
								(waypoint, waypointIndex): RouteWaypoint => ({
									label: waypoint.label,
									coordinate:
										snappedWaypoints[waypointIndex + 1] ??
										(waypoint.point as [number, number]),
								}),
							),
							routingWarnings: [
								...(route.routingWarnings ?? []),
								"Manual shaping points make the round-course target best-effort.",
							],
						};
					}),
				).map((route) => applyManualEditing(route, manualEditing));
			}

			if (normalizedRoutes.length === 0) {
				throw new Error(
					"GraphHopper could not generate a round course right now.",
				);
			}

			return json({
				routes: normalizedRoutes,
				selectedRouteIndex: 0,
			});
		} catch (error) {
			console.error("Failed to generate GraphHopper round course", error);

			if (
				error instanceof Error &&
				error.message === missingGraphHopperApiKeyMessage
			) {
				return errorResponse(
					500,
					"Routing is not configured yet. Add GRAPHHOPPER_API_KEY.",
				);
			}

			return errorResponse(
				502,
				"GraphHopper could not generate a round course right now.",
			);
		}
	}

	if (requestedMode === "out_and_back") {
		const turnaroundInput = normalizeStopInput(
			structuredOutAndBackPayload?.turnaround,
		);
		const rawWaypointInputs = Array.isArray(
			structuredOutAndBackPayload?.waypoints,
		)
			? structuredOutAndBackPayload.waypoints
			: [];
		const waypointInputs = rawWaypointInputs.map((input) =>
			normalizeStopInput(input),
		);

		if (!startInput.label) {
			fieldErrors.startQuery = "Enter a start point.";
		}

		if (waypointInputs.length > maxWaypoints) {
			const waypointError = getTooManyWaypointsMessage();
			return errorResponse(400, waypointError, {
				...fieldErrors,
				waypointQueries: waypointInputs.map(() => waypointError),
			});
		}

		const waypointFieldErrors = waypointInputs.map(
			(waypoint: RouteStopInput) =>
				waypoint.label ? null : "Enter a waypoint or remove this stop.",
		);

		if (waypointFieldErrors.some((error: string | null) => !!error)) {
			fieldErrors.waypointQueries = waypointFieldErrors.map(
				(error: string | null) => error ?? "",
			);
		}

		if (!turnaroundInput.label) {
			fieldErrors.destinationQuery = "Enter a turnaround point.";
		}

		if (Object.keys(fieldErrors).length > 0) {
			return errorResponse(
				400,
				"Start and turnaround are required.",
				fieldErrors,
			);
		}

		try {
			const stops: RouteStop[] = [
				{ kind: "start", input: startInput, field: "startQuery" },
				...waypointInputs.map((input: RouteStopInput, index: number) => ({
					kind: "waypoint" as const,
					input,
					field: "waypointQueries" as const,
					index,
				})),
				{
					kind: "destination",
					input: turnaroundInput,
					field: "destinationQuery",
				},
			];
			const resolvedStops = await Promise.all(
				stops.map(async (stop) => {
					if (stop.input.point) {
						return {
							...stop,
							label: stop.input.label,
							point: stop.input.point,
						};
					}

					const resolved = await geocodeLocation(fetch, stop.input.label);
					return resolved
						? {
								...stop,
								label: resolved.label,
								point: resolved.point,
							}
						: stop;
				}),
			);
			const unresolvedWaypoints = waypointInputs.map(() => "");

			for (const stop of resolvedStops) {
				if (stop.label && stop.point) {
					continue;
				}

				if (stop.field === "startQuery") {
					fieldErrors.startQuery = "We couldn't resolve that start point.";
				} else {
					if (typeof stop.index === "number") {
						unresolvedWaypoints[stop.index] =
							"We couldn't resolve that waypoint.";
					} else {
						fieldErrors.destinationQuery =
							"We couldn't resolve that turnaround point.";
					}
				}
			}

			if (unresolvedWaypoints.some((error: string) => error.length > 0)) {
				fieldErrors.waypointQueries = unresolvedWaypoints;
			}

			if (
				fieldErrors.startQuery ||
				fieldErrors.destinationQuery ||
				fieldErrors.waypointQueries
			) {
				return errorResponse(
					422,
					"We couldn't resolve one or more locations.",
					fieldErrors,
				);
			}

			const routePoints = resolvedStops.map(
				(stop) => stop.point as [number, number],
			);
			const resolvedSpatialConstraint = await resolveSpatialConstraint(
				fetch,
				spatialConstraintInput,
				routePoints,
			);

			if (resolvedSpatialConstraint.fieldError) {
				return errorResponse(
					resolvedSpatialConstraint.status ?? 400,
					resolvedSpatialConstraint.error ?? "Route bounds are invalid.",
					{
						spatialConstraint: resolvedSpatialConstraint.fieldError,
					},
				);
			}

			const { routes, snappedWaypointSets } = await requestRoutes(
				fetch,
				routePoints,
				{
					mode: "out_and_back",
					spatialConstraint: resolvedSpatialConstraint.constraint,
					alternativeMaxPaths: desiredAlternativeRoutes,
					alternativeMaxWeightFactor: alternativeRouteMaxWeightFactor,
					alternativeMaxShareFactor: alternativeRouteMaxShareFactor,
				},
			);
			const normalizedRoutes = dedupeRoutes(
				routes.map((route, routeIndex) => {
					const snappedWaypoints = snappedWaypointSets[routeIndex] ?? [];
					const snappedStart =
						snappedWaypoints[0] ??
						(resolvedStops[0]?.point as [number, number]);
					const snappedTurnaround =
						snappedWaypoints[snappedWaypoints.length - 1] ??
						(resolvedStops[resolvedStops.length - 1]?.point as [
							number,
							number,
						]);
					const shapingWaypoints = resolvedStops.slice(1, -1).map(
						(stop, waypointIndex): RouteWaypoint => ({
							label: stop.label ?? stop.input.label,
							coordinate:
								snappedWaypoints[waypointIndex + 1] ??
								(stop.point as [number, number]),
						}),
					);

					return buildOutAndBackRoute(
						route,
						resolvedStops[0]?.label ?? "",
						resolvedStops[resolvedStops.length - 1]?.label ?? "",
						snappedStart,
						snappedTurnaround,
						shapingWaypoints,
					);
				}),
			).map((route) => applyManualEditing(route, manualEditing));

			if (normalizedRoutes.length === 0) {
				throw new Error(
					"GraphHopper could not generate an out-and-back route right now.",
				);
			}

			return json({
				routes: normalizedRoutes,
				selectedRouteIndex: 0,
			});
		} catch (error) {
			console.error("Failed to generate GraphHopper out-and-back route", error);

			if (
				error instanceof Error &&
				error.message === missingGraphHopperApiKeyMessage
			) {
				return errorResponse(
					500,
					"Routing is not configured yet. Add GRAPHHOPPER_API_KEY.",
				);
			}

			return errorResponse(
				502,
				"GraphHopper could not generate an out-and-back route right now.",
			);
		}
	}

	const rawWaypointInputs =
		(structuredPointToPointPayload
			? structuredPointToPointPayload.waypoints
			: legacyPayload?.waypointQueries) ?? [];
	const waypointInputs = Array.isArray(rawWaypointInputs)
		? rawWaypointInputs.map((input: RouteStopInput | string | undefined) =>
				normalizeStopInput(input),
			)
		: [];
	const destinationInput = normalizeStopInput(
		structuredPointToPointPayload
			? structuredPointToPointPayload.destination
			: legacyPayload?.destinationQuery,
	);

	if (waypointInputs.length > maxWaypoints) {
		const waypointError = getTooManyWaypointsMessage();
		fieldErrors.waypointQueries = waypointInputs.map(() => waypointError);
		return errorResponse(400, waypointError, fieldErrors);
	}

	if (!startInput.label) {
		fieldErrors.startQuery = "Enter a start point.";
	}

	const waypointFieldErrors = waypointInputs.map((waypoint: RouteStopInput) =>
		waypoint.label ? null : "Enter a waypoint or remove this stop.",
	);

	if (waypointFieldErrors.some((error: string | null) => !!error)) {
		fieldErrors.waypointQueries = waypointFieldErrors.map(
			(error: string | null) => error ?? "",
		);
	}

	if (!destinationInput.label) {
		fieldErrors.destinationQuery = "Enter a destination.";
	}

	if (Object.keys(fieldErrors).length > 0) {
		return errorResponse(
			400,
			"Start and destination are required.",
			fieldErrors,
		);
	}

	try {
		const stops: RouteStop[] = [
			{ kind: "start", input: startInput, field: "startQuery" },
			...waypointInputs.map((input: RouteStopInput, index: number) => ({
				kind: "waypoint" as const,
				input,
				field: "waypointQueries" as const,
				index,
			})),
			{
				kind: "destination",
				input: destinationInput,
				field: "destinationQuery",
			},
		];

		const resolvedStops = await Promise.all(
			stops.map(async (stop) => {
				if (stop.input.point) {
					return {
						...stop,
						label: stop.input.label,
						point: stop.input.point,
					};
				}

				const resolved = await geocodeLocation(fetch, stop.input.label);
				return resolved
					? {
							...stop,
							label: resolved.label,
							point: resolved.point,
						}
					: stop;
			}),
		);

		const unresolvedWaypoints = waypointInputs.map(() => "");

		for (const stop of resolvedStops) {
			if (stop.label && stop.point) {
				continue;
			}

			if (stop.field === "startQuery") {
				fieldErrors.startQuery = "We couldn't resolve that start point.";
				continue;
			}

			if (stop.field === "destinationQuery") {
				fieldErrors.destinationQuery = "We couldn't resolve that destination.";
				continue;
			}

			if (typeof stop.index === "number") {
				unresolvedWaypoints[stop.index] = "We couldn't resolve that waypoint.";
			}
		}

		if (unresolvedWaypoints.some((error: string) => error.length > 0)) {
			fieldErrors.waypointQueries = unresolvedWaypoints;
		}

		if (
			fieldErrors.startQuery ||
			fieldErrors.destinationQuery ||
			fieldErrors.waypointQueries
		) {
			return errorResponse(
				422,
				"We couldn't resolve one or more locations.",
				fieldErrors,
			);
		}

		const routePoints = resolvedStops.map(
			(stop) => stop.point as [number, number],
		);
		const resolvedSpatialConstraint = await resolveSpatialConstraint(
			fetch,
			spatialConstraintInput,
			routePoints,
		);

		if (resolvedSpatialConstraint.fieldError) {
			return errorResponse(
				resolvedSpatialConstraint.status ?? 400,
				resolvedSpatialConstraint.error ?? "Route bounds are invalid.",
				{
					spatialConstraint: resolvedSpatialConstraint.fieldError,
				},
			);
		}

		const { routes, snappedWaypointSets } = await requestRoutes(
			fetch,
			routePoints,
			{
				mode: "point_to_point",
				spatialConstraint: resolvedSpatialConstraint.constraint,
				alternativeMaxPaths: desiredAlternativeRoutes,
				alternativeMaxWeightFactor: alternativeRouteMaxWeightFactor,
				alternativeMaxShareFactor: alternativeRouteMaxShareFactor,
			},
		);
		const normalizedRoutes = dedupeRoutes(
			routes.map((route, routeIndex) => {
				const snappedWaypoints = snappedWaypointSets[routeIndex] ?? [];

				return {
					...route,
					startLabel: resolvedStops[0]?.label ?? "",
					destinationLabel:
						resolvedStops[resolvedStops.length - 1]?.label ?? "",
					waypoints: resolvedStops.slice(1, -1).map(
						(stop, index): RouteWaypoint => ({
							label: stop.label ?? stop.input.label,
							coordinate:
								snappedWaypoints[index + 1] ?? (stop.point as [number, number]),
						}),
					),
				};
			}),
		).map((route) => applyManualEditing(route, manualEditing));

		if (normalizedRoutes.length === 0) {
			throw new Error("GraphHopper could not generate a route right now.");
		}

		return json({
			routes: normalizedRoutes,
			selectedRouteIndex: 0,
		});
	} catch (error) {
		console.error("Failed to generate GraphHopper route", error);

		if (
			error instanceof Error &&
			error.message === missingGraphHopperApiKeyMessage
		) {
			return errorResponse(
				500,
				"Routing is not configured yet. Add GRAPHHOPPER_API_KEY.",
			);
		}

		if (
			error instanceof Error &&
			error.message.includes("Too many points for Routing API")
		) {
			return errorResponse(
				400,
				`Your current routing plan allows up to ${maxRoutePoints} total route points (${maxWaypoints} waypoints plus start and destination).`,
			);
		}

		return errorResponse(
			502,
			"GraphHopper could not generate a route right now.",
		);
	}
};
