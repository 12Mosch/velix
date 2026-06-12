import { Schema } from "effect";

import { parseCoordinateSearchInput } from "$lib/coordinate-search";
import {
	RoundCourseTargetSchema,
	RouteSpatialConstraintInputSchema,
	type LegacyRouteRequestPayloadInput,
	type RouteRequestPayloadInput,
} from "$lib/route-api-schema";
import type {
	ManualRouteEditingState,
	RouteAvoidanceInput,
	RouteFieldErrors,
	RouteMode,
	RoundCourseTarget,
	RouteSpatialConstraintInput,
	RouteStopInput,
	SpatialConstraintEnforcement,
} from "$lib/route-planning";
import {
	defaultRouteAvoidanceBufferMeters,
	maxAreaRadiusMeters,
	maxCorridorWidthMeters,
	maxRouteAvoidanceBufferMeters,
	maxRouteAvoidanceCenterlinePoints,
	maxRouteAvoidances,
	minAreaRadiusMeters,
	minCorridorWidthMeters,
	minRouteAvoidanceBufferMeters,
	minRouteAvoidanceCenterlinePoints,
} from "$lib/server/route-endpoint/constants";
import type {
	PreparedRouteModeContext,
	RouteRequestEvent,
} from "$lib/server/route-endpoint/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
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

function isFiniteLngLat(value: unknown): value is [number, number] {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === "number" &&
		Number.isFinite(value[0]) &&
		value[0] >= -180 &&
		value[0] <= 180 &&
		typeof value[1] === "number" &&
		Number.isFinite(value[1]) &&
		value[1] >= -90 &&
		value[1] <= 90
	);
}

function hasFiniteLngLatPair(value: unknown): value is [number, number] {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === "number" &&
		Number.isFinite(value[0]) &&
		typeof value[1] === "number" &&
		Number.isFinite(value[1])
	);
}

export function normalizeStopInput(value: unknown): RouteStopInput {
	if (typeof value === "string") {
		const label = value.trim();
		const coordinateResult = parseCoordinateSearchInput(label);

		if (coordinateResult.kind === "coordinate") {
			return {
				label: coordinateResult.label,
				point: coordinateResult.point,
			};
		}

		return {
			label,
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
	const label =
		typeof candidate.label === "string" ? candidate.label.trim() : "";
	const normalizedPoint = isFiniteLngLat(point)
		? ([point[0], point[1]] satisfies [number, number])
		: undefined;

	if (normalizedPoint) {
		return {
			label,
			point: normalizedPoint,
		};
	}

	if (hasFiniteLngLatPair(point)) {
		return {
			label,
			point: [point[0], point[1]],
		};
	}

	const coordinateResult = parseCoordinateSearchInput(label);

	if (coordinateResult.kind === "coordinate") {
		return {
			label: coordinateResult.label,
			point: coordinateResult.point,
		};
	}

	return {
		label,
	};
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

	let decodedConstraint: typeof RouteSpatialConstraintInputSchema.Type;

	try {
		decodedConstraint = Schema.decodeUnknownSync(
			RouteSpatialConstraintInputSchema,
		)(rawConstraint);
	} catch {
		return {
			error: "Choose an area or corridor constraint.",
		};
	}

	const enforcement = normalizeSpatialConstraintEnforcement(
		decodedConstraint.enforcement,
	);

	if (decodedConstraint.kind === "area") {
		const center = normalizeStopInput(decodedConstraint.center);
		const radiusMeters = decodedConstraint.radiusMeters;

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

	if (decodedConstraint.kind === "corridor") {
		if (mode === "round_course") {
			return {
				error:
					"Corridor constraints are available for point-to-point and out-and-back routes.",
			};
		}

		const widthMeters = decodedConstraint.widthMeters;

		if (
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

function normalizeRouteAvoidanceInputs(value: unknown): {
	avoidances?: RouteAvoidanceInput[];
	error?: string;
} {
	if (value === undefined || value === null) {
		return {};
	}

	if (!Array.isArray(value)) {
		return {
			error: "Choose a road segment to avoid.",
		};
	}

	if (value.length > maxRouteAvoidances) {
		return {
			error: `You can avoid up to ${maxRouteAvoidances} road segments.`,
		};
	}

	const avoidances: RouteAvoidanceInput[] = [];

	for (const [index, item] of value.entries()) {
		if (!isRecord(item) || item.kind !== "road_segment") {
			return {
				error: "Choose a road segment to avoid.",
			};
		}

		const rawCenterline = item.centerline;
		if (
			!Array.isArray(rawCenterline) ||
			rawCenterline.length < minRouteAvoidanceCenterlinePoints ||
			rawCenterline.length > maxRouteAvoidanceCenterlinePoints ||
			!rawCenterline.every(isFiniteLngLat)
		) {
			return {
				error: "Choose a valid road segment to avoid.",
			};
		}

		const bufferMeters = normalizeFiniteNumber(
			item.bufferMeters ?? defaultRouteAvoidanceBufferMeters,
		);

		if (
			bufferMeters === null ||
			bufferMeters < minRouteAvoidanceBufferMeters ||
			bufferMeters > maxRouteAvoidanceBufferMeters
		) {
			return {
				error: `Use an avoidance buffer distance from ${minRouteAvoidanceBufferMeters} to ${maxRouteAvoidanceBufferMeters} m per side.`,
			};
		}

		const label =
			typeof item.label === "string" && item.label.trim()
				? item.label.trim()
				: `Avoided road ${index + 1}`;

		avoidances.push({
			kind: "road_segment",
			centerline: rawCenterline.map((point) => [point[0], point[1]]),
			bufferMeters,
			label,
		});
	}

	return avoidances.length > 0 ? { avoidances } : {};
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

export function getRoundCourseTargetError(rawTarget: unknown): string {
	if (
		isRecord(rawTarget) &&
		(rawTarget.kind === "duration" || rawTarget.kind === "workout")
	) {
		if (rawTarget.kind === "workout") {
			return "Enter a workout plan.";
		}

		return "Enter a target time.";
	}

	if (isRecord(rawTarget) && rawTarget.kind === "ascend") {
		return "Enter a target climb.";
	}

	return "Enter a target distance.";
}

export function normalizeRoundCourseTarget(
	payloadRecord: Record<string, unknown>,
): RoundCourseTarget | null {
	if ("target" in payloadRecord) {
		const rawTarget = payloadRecord.target;

		try {
			return Schema.decodeUnknownSync(RoundCourseTargetSchema)(rawTarget);
		} catch {
			return null;
		}
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

export function hasFiniteOutOfBoundsStopPoint(value: unknown): boolean {
	if (!value || typeof value !== "object") {
		return false;
	}

	const point = (value as { point?: unknown }).point;

	return (
		Array.isArray(point) &&
		point.length >= 2 &&
		typeof point[0] === "number" &&
		Number.isFinite(point[0]) &&
		typeof point[1] === "number" &&
		Number.isFinite(point[1]) &&
		!isFiniteLngLat(point)
	);
}

export function hasRouteStopInput(stop: RouteStopInput) {
	return Boolean(stop.label || stop.point);
}

function buildWaypointFieldErrors(waypointInputs: RouteStopInput[]) {
	return waypointInputs.map((waypoint) =>
		hasRouteStopInput(waypoint)
			? null
			: "Enter a waypoint or remove this stop.",
	);
}

export function addWaypointValidationErrors(
	fieldErrors: RouteFieldErrors,
	waypointInputs: RouteStopInput[],
) {
	const waypointFieldErrors = buildWaypointFieldErrors(waypointInputs);

	if (waypointFieldErrors.some((error) => !!error)) {
		fieldErrors.waypointQueries = waypointFieldErrors.map(
			(error) => error ?? "",
		);
	}
}

export function prepareRouteModeContext(
	event: RouteRequestEvent,
	payload: RouteRequestPayloadInput,
): PreparedRouteModeContext {
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
		"avoidances" in payloadRecord ||
		"requestedDistanceMeters" in payloadRecord ||
		"mode" in payloadRecord;
	const structuredPayload = hasStructuredPayload ? payload : null;
	const structuredPointToPointPayload =
		structuredPayload && requestedMode === "point_to_point"
			? structuredPayload
			: null;
	const structuredOutAndBackPayload =
		structuredPayload && requestedMode === "out_and_back"
			? structuredPayload
			: null;
	const legacyPayload = hasStructuredPayload
		? null
		: (payload as LegacyRouteRequestPayloadInput);
	const startInput = normalizeStopInput(
		structuredPayload ? structuredPayload.start : legacyPayload?.startQuery,
	);
	const fieldErrors: RouteFieldErrors = {};
	const spatialConstraintResult = normalizeSpatialConstraintInput(
		payloadRecord,
		requestedMode,
	);
	const avoidanceResult = normalizeRouteAvoidanceInputs(
		payloadRecord.avoidances,
	);
	const manualEditing = normalizeManualEditingInput(
		payloadRecord.manualEditing,
	);

	if (spatialConstraintResult.error) {
		fieldErrors.spatialConstraint = spatialConstraintResult.error;
	}

	if (avoidanceResult.error) {
		fieldErrors.avoidances = avoidanceResult.error;
	}

	return {
		requestedMode,
		context: {
			event,
			payloadRecord,
			startInput,
			spatialConstraintInput: spatialConstraintResult.constraint,
			avoidanceInputs: avoidanceResult.avoidances,
			manualEditing,
			fieldErrors,
			structuredPointToPointPayload,
			structuredOutAndBackPayload,
			legacyPayload,
		},
	};
}
