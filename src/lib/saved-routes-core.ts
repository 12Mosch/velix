import { Schema } from "effect";

import {
	PlannedRouteSchema,
	RemoteSavedRoutePayloadSchema,
	RouteModeSchema,
} from "./route-api-schema";
import type {
	ManualRouteEditingState,
	PlannedRoute,
	RoundCourseTarget,
	RouteMode,
} from "./route-planning";
import {
	getRouteSegmentCount,
	sanitizeLockedSegmentIndexes,
} from "./route-planning";

export const SAVED_ROUTES_STORAGE_KEY = "velix.savedRoutes";

export type SavedRoute = {
	id: string;
	createdAt: string;
	route: PlannedRoute;
};

export type RemoteSavedRoutePayload = {
	id: string;
	createdAt: string;
	routeJson: string;
};

export type SavedRouteSummary = {
	id: string;
	createdAt: string;
	mode: RouteMode;
	sourceKind: PlannedRoute["source"]["kind"];
	sourceHasDuration?: boolean;
	startLabel: string;
	destinationLabel: string;
	waypointLabels: string[];
	distanceMeters: number;
	ascendMeters: number;
	durationMs: number;
	requestedDistanceMeters?: number;
	roundCourseTarget?: RoundCourseTarget;
};

export type RemoteSavedRouteSummaryPayload = SavedRouteSummary;

export type SavedRouteVersion = {
	versionId: string;
	routeId: string;
	capturedAt: string;
	savedRoute: SavedRoute;
};

export type RemoteSavedRouteVersionPayload = {
	versionId: string;
	routeId: string;
	capturedAt: string;
	savedRoute: RemoteSavedRoutePayload;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function decodeOrNull<S extends Schema.Decoder<unknown, never>>(
	schema: S,
	value: unknown,
): S["Type"] | null {
	try {
		return Schema.decodeUnknownSync(schema)(value);
	} catch {
		return null;
	}
}

function isSameRoutePoint(left: [number, number], right: [number, number]) {
	return left[0] === right[0] && left[1] === right[1];
}

function normalizeDateString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const ms = Date.parse(value);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function isClosedPolygon(polygon: [number, number][]) {
	const firstPoint = polygon[0];
	const lastPoint = polygon[polygon.length - 1];

	return !!firstPoint && !!lastPoint && isSameRoutePoint(firstPoint, lastPoint);
}

function hasAtLeastTwoCoordinates(route: PlannedRoute) {
	return route.coordinates.length >= 2;
}

function normalizeLegacyPlannedRouteInput(
	value: Record<string, unknown>,
): Record<string, unknown> | null {
	const requestedDistanceMeters =
		value.requestedDistanceMeters === undefined
			? undefined
			: typeof value.requestedDistanceMeters === "number" &&
					Number.isFinite(value.requestedDistanceMeters)
				? value.requestedDistanceMeters
				: null;

	if (requestedDistanceMeters === null) {
		return null;
	}

	const candidate: Record<string, unknown> = {
		...value,
		mode: decodeOrNull(RouteModeSchema, value.mode) ?? "point_to_point",
		source: value.source ?? { kind: "graphhopper" },
		waypoints: value.waypoints ?? [],
		instructions: value.instructions ?? [],
	};
	delete candidate.manualEditing;

	if (requestedDistanceMeters !== undefined) {
		candidate.requestedDistanceMeters = requestedDistanceMeters;
	}

	if (
		value.roundCourseTarget === undefined &&
		requestedDistanceMeters !== undefined
	) {
		candidate.roundCourseTarget = {
			kind: "distance",
			distanceMeters: requestedDistanceMeters,
		};
	}

	return candidate;
}

function normalizeManualEditing(
	value: unknown,
	route: PlannedRoute,
): ManualRouteEditingState | undefined | null {
	if (value === undefined) {
		return undefined;
	}

	if (!isRecord(value) || !Array.isArray(value.lockedSegmentIndexes)) {
		return null;
	}

	if (!value.lockedSegmentIndexes.every((index) => Number.isInteger(index))) {
		return null;
	}

	if (route.coordinates.length < 2) {
		return undefined;
	}

	const lockedSegmentIndexes = sanitizeLockedSegmentIndexes(
		value.lockedSegmentIndexes,
		getRouteSegmentCount(route),
	);

	return lockedSegmentIndexes.length > 0
		? {
				lockedSegmentIndexes,
			}
		: undefined;
}

export function normalizePlannedRoute(value: unknown): PlannedRoute | null {
	if (!isRecord(value)) {
		return null;
	}

	const candidate = normalizeLegacyPlannedRouteInput(value);
	if (!candidate) {
		return null;
	}

	const normalizedRoute = decodeOrNull(PlannedRouteSchema, candidate);
	if (!normalizedRoute || !hasAtLeastTwoCoordinates(normalizedRoute)) {
		return null;
	}

	if (normalizedRoute.spatialConstraint) {
		const polygon = normalizedRoute.spatialConstraint.polygon;
		if (polygon.length < 4 || !isClosedPolygon(polygon)) {
			return null;
		}
	}

	if (normalizedRoute.avoidances) {
		for (const avoidance of normalizedRoute.avoidances) {
			if (
				avoidance.kind !== "road_segment" ||
				avoidance.centerline.length < 2 ||
				avoidance.polygon.length < 4 ||
				!isClosedPolygon(avoidance.polygon)
			) {
				return null;
			}
		}
	}

	const manualEditing = normalizeManualEditing(
		value.manualEditing,
		normalizedRoute,
	);

	if (manualEditing === null) {
		return null;
	}

	return {
		...normalizedRoute,
		...(manualEditing ? { manualEditing } : {}),
	};
}

export function isPlannedRoute(value: unknown): value is PlannedRoute {
	return normalizePlannedRoute(value) !== null;
}

const RawSavedRouteSchema = Schema.Struct({
	id: Schema.String,
	createdAt: Schema.String,
	route: Schema.Unknown,
});

const RawSavedRouteVersionSchema = Schema.Struct({
	versionId: Schema.String,
	routeId: Schema.String,
	capturedAt: Schema.String,
	savedRoute: Schema.Unknown,
});

const RawSavedRouteSummarySchema = Schema.Struct({
	id: Schema.String,
	createdAt: Schema.String,
	mode: RouteModeSchema,
	sourceKind: Schema.Literals(["graphhopper", "gpx_import"]),
	sourceHasDuration: Schema.optionalKey(Schema.Boolean),
	startLabel: Schema.String,
	destinationLabel: Schema.String,
	waypointLabels: Schema.Array(Schema.String),
	distanceMeters: Schema.Finite,
	ascendMeters: Schema.Finite,
	durationMs: Schema.Finite,
	requestedDistanceMeters: Schema.optionalKey(Schema.Finite),
	roundCourseTarget: Schema.optionalKey(Schema.Unknown),
});

function getNormalizedSavedRoute(value: unknown): SavedRoute | null {
	const candidate = decodeOrNull(RawSavedRouteSchema, value);
	if (!candidate || candidate.id.length === 0) {
		return null;
	}

	const createdAt = normalizeDateString(candidate.createdAt);
	const route = normalizePlannedRoute(candidate.route);

	return createdAt && route ? { id: candidate.id, createdAt, route } : null;
}

export function isSavedRoute(value: unknown): value is SavedRoute {
	return getNormalizedSavedRoute(value) !== null;
}

function getNormalizedSavedRouteVersion(
	value: unknown,
): SavedRouteVersion | null {
	const candidate = decodeOrNull(RawSavedRouteVersionSchema, value);
	if (
		!candidate ||
		candidate.versionId.length === 0 ||
		candidate.routeId.length === 0
	) {
		return null;
	}

	const capturedAt = normalizeDateString(candidate.capturedAt);
	const savedRoute = getNormalizedSavedRoute(candidate.savedRoute);

	return capturedAt && savedRoute && savedRoute.id === candidate.routeId
		? {
				versionId: candidate.versionId,
				routeId: candidate.routeId,
				capturedAt,
				savedRoute,
			}
		: null;
}

function getNormalizedSavedRouteSummary(
	value: unknown,
): SavedRouteSummary | null {
	const candidate = decodeOrNull(RawSavedRouteSummarySchema, value);
	if (!candidate || candidate.id.length === 0) {
		return null;
	}

	const createdAt = normalizeDateString(candidate.createdAt);
	if (!createdAt) {
		return null;
	}

	const normalizedRoundCourseTarget =
		candidate.roundCourseTarget === undefined
			? undefined
			: normalizeRoundCourseTarget(candidate.roundCourseTarget);

	if (
		candidate.roundCourseTarget !== undefined &&
		!normalizedRoundCourseTarget
	) {
		return null;
	}

	return {
		id: candidate.id,
		createdAt,
		mode: candidate.mode,
		sourceKind: candidate.sourceKind,
		...(candidate.sourceKind === "gpx_import"
			? { sourceHasDuration: candidate.sourceHasDuration ?? false }
			: {}),
		startLabel: candidate.startLabel,
		destinationLabel: candidate.destinationLabel,
		waypointLabels: [...candidate.waypointLabels],
		distanceMeters: candidate.distanceMeters,
		ascendMeters: candidate.ascendMeters,
		durationMs: candidate.durationMs,
		...(candidate.requestedDistanceMeters === undefined
			? {}
			: { requestedDistanceMeters: candidate.requestedDistanceMeters }),
		...(normalizedRoundCourseTarget
			? { roundCourseTarget: normalizedRoundCourseTarget }
			: {}),
	};
}

export function isSavedRouteVersion(
	value: unknown,
): value is SavedRouteVersion {
	return getNormalizedSavedRouteVersion(value) !== null;
}

export function parseSavedRoutes(rawValue: string | null): SavedRoute[] {
	if (!rawValue) {
		return [];
	}

	try {
		const parsedValue = JSON.parse(rawValue) as unknown;

		if (!Array.isArray(parsedValue)) {
			return [];
		}

		return normalizeSavedRoutes(parsedValue);
	} catch {
		return [];
	}
}

export function normalizeSavedRoutes(values: unknown[]): SavedRoute[] {
	return values.flatMap((entry) => {
		const savedRoute = getNormalizedSavedRoute(entry);

		if (!savedRoute) {
			return [];
		}

		return [savedRoute];
	});
}

export function normalizeSavedRouteVersions(
	values: unknown[],
): SavedRouteVersion[] {
	return values.flatMap((entry) => {
		const savedRouteVersion =
			deserializeRemoteSavedRouteVersion(entry) ??
			getNormalizedSavedRouteVersion(entry);

		return savedRouteVersion ? [savedRouteVersion] : [];
	});
}

function normalizeRoundCourseTarget(value: unknown): RoundCourseTarget | null {
	if (!isRecord(value) || typeof value.kind !== "string") {
		return null;
	}

	if (value.kind === "distance") {
		return typeof value.distanceMeters === "number" &&
			Number.isFinite(value.distanceMeters)
			? { kind: "distance", distanceMeters: value.distanceMeters }
			: null;
	}

	if (value.kind === "duration") {
		return typeof value.durationMs === "number" &&
			Number.isFinite(value.durationMs)
			? { kind: "duration", durationMs: value.durationMs }
			: null;
	}

	if (value.kind === "ascend") {
		return typeof value.ascendMeters === "number" &&
			Number.isFinite(value.ascendMeters)
			? { kind: "ascend", ascendMeters: value.ascendMeters }
			: null;
	}

	if (value.kind === "workout") {
		return typeof value.durationMs === "number" &&
			Number.isFinite(value.durationMs) &&
			typeof value.distanceMeters === "number" &&
			Number.isFinite(value.distanceMeters) &&
			typeof value.estimatedSpeedMetersPerHour === "number" &&
			Number.isFinite(value.estimatedSpeedMetersPerHour) &&
			typeof value.weightedIntensity === "number" &&
			Number.isFinite(value.weightedIntensity)
			? {
					kind: "workout",
					durationMs: value.durationMs,
					distanceMeters: value.distanceMeters,
					estimatedSpeedMetersPerHour: value.estimatedSpeedMetersPerHour,
					weightedIntensity: value.weightedIntensity,
				}
			: null;
	}

	return null;
}

export function summarizeSavedRoute(savedRoute: SavedRoute): SavedRouteSummary {
	const route = savedRoute.route;
	return {
		id: savedRoute.id,
		createdAt: savedRoute.createdAt,
		mode: route.mode,
		sourceKind: route.source.kind,
		...(route.source.kind === "gpx_import"
			? { sourceHasDuration: route.source.hasDuration }
			: {}),
		startLabel: route.startLabel,
		destinationLabel: route.destinationLabel,
		waypointLabels: route.waypoints.map((waypoint) => waypoint.label),
		distanceMeters: route.distanceMeters,
		ascendMeters: route.ascendMeters,
		durationMs: route.durationMs,
		...(route.requestedDistanceMeters === undefined
			? {}
			: { requestedDistanceMeters: route.requestedDistanceMeters }),
		...(route.roundCourseTarget
			? { roundCourseTarget: route.roundCourseTarget }
			: {}),
	};
}

export function normalizeSavedRouteSummary(
	value: unknown,
): SavedRouteSummary | null {
	return getNormalizedSavedRouteSummary(value);
}

export function normalizeSavedRouteSummaries(
	values: unknown[],
): SavedRouteSummary[] {
	return values.flatMap((entry) => {
		const summary = getNormalizedSavedRouteSummary(entry);
		return summary ? [summary] : [];
	});
}

export function serializeSavedRouteForRemote(
	savedRoute: SavedRoute,
): RemoteSavedRoutePayload {
	const normalizedSavedRoute = getNormalizedSavedRoute(savedRoute);

	if (!normalizedSavedRoute) {
		throw new Error("Saved route payload is invalid.");
	}

	return {
		id: normalizedSavedRoute.id,
		createdAt: normalizedSavedRoute.createdAt,
		routeJson: JSON.stringify(normalizedSavedRoute.route),
	};
}

export function deserializeRemoteSavedRoute(value: unknown): SavedRoute | null {
	const candidate = decodeOrNull(RemoteSavedRoutePayloadSchema, value);
	if (!candidate || candidate.id.length === 0) {
		return null;
	}

	const createdAt = normalizeDateString(candidate.createdAt);
	if (!createdAt) {
		return null;
	}

	let parsedRoute: unknown;
	try {
		parsedRoute = JSON.parse(candidate.routeJson) as unknown;
	} catch {
		return null;
	}

	const route = normalizePlannedRoute(parsedRoute);
	if (!route) {
		return null;
	}

	return {
		id: candidate.id,
		createdAt,
		route,
	};
}

export function normalizeRemoteSavedRoutes(values: unknown[]): SavedRoute[] {
	return values.flatMap((entry) => {
		const savedRoute =
			deserializeRemoteSavedRoute(entry) ?? getNormalizedSavedRoute(entry);

		if (!savedRoute) {
			return [];
		}

		return [savedRoute];
	});
}

export function serializeSavedRouteVersionForRemote(
	version: SavedRouteVersion,
): RemoteSavedRouteVersionPayload {
	const normalizedVersion = getNormalizedSavedRouteVersion(version);

	if (!normalizedVersion) {
		throw new Error("Saved route version payload is invalid.");
	}

	return {
		versionId: normalizedVersion.versionId,
		routeId: normalizedVersion.routeId,
		capturedAt: normalizedVersion.capturedAt,
		savedRoute: serializeSavedRouteForRemote(normalizedVersion.savedRoute),
	};
}

export function deserializeRemoteSavedRouteVersion(
	value: unknown,
): SavedRouteVersion | null {
	if (!isRecord(value)) {
		return null;
	}

	const versionId = value.versionId;
	const routeId = value.routeId;
	const capturedAt = normalizeDateString(value.capturedAt);
	const savedRoute = deserializeRemoteSavedRoute(value.savedRoute);

	if (
		typeof versionId !== "string" ||
		versionId.length === 0 ||
		typeof routeId !== "string" ||
		routeId.length === 0 ||
		!capturedAt ||
		!savedRoute ||
		savedRoute.id !== routeId
	) {
		return null;
	}

	return {
		versionId,
		routeId,
		capturedAt,
		savedRoute,
	};
}

function toStructuredCloneable(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => toStructuredCloneable(entry));
	}

	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				toStructuredCloneable(entry),
			]),
		);
	}

	return value;
}

export function cloneRoute(route: PlannedRoute): PlannedRoute {
	return structuredClone(toStructuredCloneable(route)) as PlannedRoute;
}

export function cloneSavedRoute(savedRoute: SavedRoute): SavedRoute {
	return {
		...savedRoute,
		route: cloneRoute(savedRoute.route),
	};
}

export function cloneSavedRouteVersion(
	version: SavedRouteVersion,
): SavedRouteVersion {
	return {
		...version,
		savedRoute: cloneSavedRoute(version.savedRoute),
	};
}

export type BuildSavedRouteOptions = {
	id?: string;
	createdAt?: string;
	cloneRoute?: boolean;
};

function createRouteId(prefix: string) {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
	);
}

export function buildSavedRoute(
	route: PlannedRoute,
	options: BuildSavedRouteOptions = {},
): SavedRoute {
	const routeId =
		options.id && options.id.length > 0 ? options.id : createRouteId("route");
	const createdAtMs =
		typeof options.createdAt === "string" ? Date.parse(options.createdAt) : NaN;
	const createdAt = Number.isFinite(createdAtMs)
		? new Date(createdAtMs).toISOString()
		: new Date().toISOString();

	return {
		id: routeId,
		createdAt,
		route: options.cloneRoute === false ? route : cloneRoute(route),
	};
}

export function buildSavedRouteVersion(
	savedRoute: SavedRoute,
	options: { versionId?: string; capturedAt?: string } = {},
): SavedRouteVersion {
	const capturedAtMs =
		typeof options.capturedAt === "string"
			? Date.parse(options.capturedAt)
			: NaN;
	const capturedAt = Number.isFinite(capturedAtMs)
		? new Date(capturedAtMs).toISOString()
		: new Date().toISOString();

	return {
		versionId:
			options.versionId && options.versionId.length > 0
				? options.versionId
				: createRouteId("version"),
		routeId: savedRoute.id,
		capturedAt,
		savedRoute: cloneSavedRoute(savedRoute),
	};
}
