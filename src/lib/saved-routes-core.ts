import { Schema } from "effect";

import {
	PlannedRouteSchema,
	RemoteSavedRoutePayloadSchema,
	RouteModeSchema,
} from "./route-api-schema";
import type { ManualRouteEditingState, PlannedRoute } from "./route-planning";
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

export type BuildSavedRouteOptions = {
	id?: string;
	createdAt?: string;
};

export function buildSavedRoute(
	route: PlannedRoute,
	options: BuildSavedRouteOptions = {},
): SavedRoute {
	const routeId =
		options.id && options.id.length > 0
			? options.id
			: (globalThis.crypto?.randomUUID?.() ??
				`route-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
	const createdAtMs =
		typeof options.createdAt === "string" ? Date.parse(options.createdAt) : NaN;
	const createdAt = Number.isFinite(createdAtMs)
		? new Date(createdAtMs).toISOString()
		: new Date().toISOString();

	return {
		id: routeId,
		createdAt,
		route: cloneRoute(route),
	};
}
