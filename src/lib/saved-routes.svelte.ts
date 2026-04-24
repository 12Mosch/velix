import { browser } from "$app/environment";

import type {
	ImportedRouteStopDerivation,
	PlannedRoute,
	ResolvedRouteSpatialConstraint,
	RoundCourseTarget,
	RouteSource,
	RouteMode,
	RouteWaypoint,
	SpatialConstraintEnforcement,
} from "$lib/route-planning";

export const SAVED_ROUTES_STORAGE_KEY = "velix.savedRoutes";

export type SavedRoute = {
	id: string;
	createdAt: string;
	route: PlannedRoute;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isRouteMode(value: unknown): value is RouteMode {
	return (
		value === "point_to_point" ||
		value === "round_course" ||
		value === "out_and_back"
	);
}

function isImportedRouteStopDerivation(
	value: unknown,
): value is ImportedRouteStopDerivation {
	return value === "rtept" || value === "wpt" || value === "track";
}

function isRouteCoordinate(
	value: unknown,
): value is PlannedRoute["coordinates"][number] {
	if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
		return false;
	}

	return value.every(isFiniteNumber);
}

function isRoutePoint(value: unknown): value is [number, number] {
	return (
		Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber)
	);
}

function isRouteBounds(value: unknown): value is PlannedRoute["bounds"] {
	return (
		Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber)
	);
}

function isRouteDetailInterval(
	value: unknown,
): value is PlannedRoute["surfaceDetails"][number] {
	if (!isRecord(value)) {
		return false;
	}

	return (
		isFiniteNumber(value.from) &&
		isFiniteNumber(value.to) &&
		typeof value.value === "string"
	);
}

function isRouteWaypoint(value: unknown): value is RouteWaypoint {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value.label === "string" && isRouteCoordinate(value.coordinate);
}

function isRoundCourseTarget(value: unknown): value is RoundCourseTarget {
	if (!isRecord(value) || typeof value.kind !== "string") {
		return false;
	}

	if (value.kind === "distance") {
		return isFiniteNumber(value.distanceMeters);
	}

	if (value.kind === "duration") {
		return isFiniteNumber(value.durationMs);
	}

	if (value.kind === "ascend") {
		return isFiniteNumber(value.ascendMeters);
	}

	return false;
}

function isSpatialConstraintEnforcement(
	value: unknown,
): value is SpatialConstraintEnforcement {
	return value === "strict" || value === "preferred";
}

function isSameRoutePoint(left: [number, number], right: [number, number]) {
	return left[0] === right[0] && left[1] === right[1];
}

function normalizeSpatialConstraint(
	value: unknown,
): ResolvedRouteSpatialConstraint | undefined | null {
	if (value === undefined) {
		return undefined;
	}

	if (!isRecord(value) || !isSpatialConstraintEnforcement(value.enforcement)) {
		return null;
	}

	const polygon = value.polygon;
	if (
		!Array.isArray(polygon) ||
		polygon.length < 4 ||
		!polygon.every(isRoutePoint)
	) {
		return null;
	}
	const firstPoint = polygon[0];
	const lastPoint = polygon[polygon.length - 1];

	if (!firstPoint || !lastPoint || !isSameRoutePoint(firstPoint, lastPoint)) {
		return null;
	}

	if (value.kind === "area") {
		return typeof value.label === "string" &&
			isRoutePoint(value.center) &&
			isFiniteNumber(value.radiusMeters)
			? {
					kind: "area",
					label: value.label,
					center: value.center,
					radiusMeters: value.radiusMeters,
					enforcement: value.enforcement,
					polygon,
				}
			: null;
	}

	if (value.kind === "corridor") {
		return isFiniteNumber(value.widthMeters)
			? {
					kind: "corridor",
					widthMeters: value.widthMeters,
					enforcement: value.enforcement,
					polygon,
				}
			: null;
	}

	return null;
}

function normalizeRouteSource(value: unknown): RouteSource | null {
	if (value === undefined) {
		return { kind: "graphhopper" };
	}

	if (!isRecord(value) || typeof value.kind !== "string") {
		return null;
	}

	if (value.kind === "graphhopper") {
		return { kind: "graphhopper" };
	}

	if (
		value.kind === "gpx_import" &&
		typeof value.filename === "string" &&
		isImportedRouteStopDerivation(value.stopDerivation) &&
		typeof value.hasDuration === "boolean"
	) {
		return {
			kind: "gpx_import",
			filename: value.filename,
			stopDerivation: value.stopDerivation,
			hasDuration: value.hasDuration,
		};
	}

	return null;
}

export function normalizePlannedRoute(value: unknown): PlannedRoute | null {
	if (!isRecord(value)) {
		return null;
	}

	const waypointValues = value.waypoints;
	const mode = isRouteMode(value.mode) ? value.mode : "point_to_point";
	const source = normalizeRouteSource(value.source);
	const requestedDistanceMeters =
		value.requestedDistanceMeters === undefined
			? undefined
			: isFiniteNumber(value.requestedDistanceMeters)
				? value.requestedDistanceMeters
				: null;
	const roundCourseTarget =
		value.roundCourseTarget === undefined
			? requestedDistanceMeters == null
				? undefined
				: {
						kind: "distance" as const,
						distanceMeters: requestedDistanceMeters,
					}
			: isRoundCourseTarget(value.roundCourseTarget)
				? value.roundCourseTarget
				: null;
	const spatialConstraint = normalizeSpatialConstraint(value.spatialConstraint);

	if (
		source === null ||
		typeof value.startLabel !== "string" ||
		typeof value.destinationLabel !== "string" ||
		requestedDistanceMeters === null ||
		roundCourseTarget === null ||
		spatialConstraint === null ||
		(value.routingProfile !== undefined &&
			typeof value.routingProfile !== "string") ||
		(value.routingStrategy !== undefined &&
			typeof value.routingStrategy !== "string") ||
		(value.routingWarnings !== undefined &&
			(!Array.isArray(value.routingWarnings) ||
				!value.routingWarnings.every(
					(warning) => typeof warning === "string",
				))) ||
		!isRouteBounds(value.bounds) ||
		!isFiniteNumber(value.distanceMeters) ||
		!isFiniteNumber(value.durationMs) ||
		!isFiniteNumber(value.ascendMeters) ||
		!isFiniteNumber(value.descendMeters) ||
		!Array.isArray(value.coordinates) ||
		value.coordinates.length < 2 ||
		!value.coordinates.every(isRouteCoordinate) ||
		!Array.isArray(value.surfaceDetails) ||
		!value.surfaceDetails.every(isRouteDetailInterval) ||
		!Array.isArray(value.smoothnessDetails) ||
		!value.smoothnessDetails.every(isRouteDetailInterval)
	) {
		return null;
	}

	if (
		waypointValues !== undefined &&
		(!Array.isArray(waypointValues) || !waypointValues.every(isRouteWaypoint))
	) {
		return null;
	}

	return {
		mode,
		source,
		startLabel: value.startLabel,
		destinationLabel: value.destinationLabel,
		roundCourseTarget,
		spatialConstraint,
		routingProfile:
			typeof value.routingProfile === "string"
				? value.routingProfile
				: undefined,
		routingStrategy:
			typeof value.routingStrategy === "string"
				? value.routingStrategy
				: undefined,
		routingWarnings: Array.isArray(value.routingWarnings)
			? value.routingWarnings.filter(
					(warning): warning is string => typeof warning === "string",
				)
			: undefined,
		waypoints: Array.isArray(waypointValues) ? waypointValues : [],
		bounds: value.bounds,
		distanceMeters: value.distanceMeters,
		durationMs: value.durationMs,
		ascendMeters: value.ascendMeters,
		descendMeters: value.descendMeters,
		coordinates: value.coordinates,
		surfaceDetails: value.surfaceDetails,
		smoothnessDetails: value.smoothnessDetails,
	};
}

export function isPlannedRoute(value: unknown): value is PlannedRoute {
	if (!isRecord(value)) {
		return false;
	}

	return (
		normalizeRouteSource(value.source) !== null &&
		(value.mode === undefined || isRouteMode(value.mode)) &&
		typeof value.startLabel === "string" &&
		typeof value.destinationLabel === "string" &&
		(value.requestedDistanceMeters === undefined ||
			isFiniteNumber(value.requestedDistanceMeters)) &&
		(value.roundCourseTarget === undefined ||
			isRoundCourseTarget(value.roundCourseTarget)) &&
		(value.routingProfile === undefined ||
			typeof value.routingProfile === "string") &&
		(value.spatialConstraint === undefined ||
			normalizeSpatialConstraint(value.spatialConstraint) !== null) &&
		(value.routingStrategy === undefined ||
			typeof value.routingStrategy === "string") &&
		(value.routingWarnings === undefined ||
			(Array.isArray(value.routingWarnings) &&
				value.routingWarnings.every(
					(warning) => typeof warning === "string",
				))) &&
		Array.isArray(value.waypoints) &&
		value.waypoints.every(isRouteWaypoint) &&
		isRouteBounds(value.bounds) &&
		isFiniteNumber(value.distanceMeters) &&
		isFiniteNumber(value.durationMs) &&
		isFiniteNumber(value.ascendMeters) &&
		isFiniteNumber(value.descendMeters) &&
		Array.isArray(value.coordinates) &&
		value.coordinates.length >= 2 &&
		value.coordinates.every(isRouteCoordinate) &&
		Array.isArray(value.surfaceDetails) &&
		value.surfaceDetails.every(isRouteDetailInterval) &&
		Array.isArray(value.smoothnessDetails) &&
		value.smoothnessDetails.every(isRouteDetailInterval)
	);
}

function isSavedRoute(value: unknown): value is SavedRoute {
	if (!isRecord(value)) {
		return false;
	}

	const candidate = value as Partial<SavedRoute>;
	const normalizedRoute = normalizePlannedRoute(candidate.route);

	return (
		typeof candidate.id === "string" &&
		candidate.id.length > 0 &&
		typeof candidate.createdAt === "string" &&
		Number.isFinite(Date.parse(candidate.createdAt)) &&
		normalizedRoute !== null
	);
}

function parseSavedRoutes(rawValue: string | null): SavedRoute[] {
	if (!rawValue) {
		return [];
	}

	try {
		const parsedValue = JSON.parse(rawValue) as unknown;

		if (!Array.isArray(parsedValue)) {
			return [];
		}

		return parsedValue.flatMap((entry) => {
			if (!isSavedRoute(entry)) {
				return [];
			}

			const normalizedRoute = normalizePlannedRoute(entry.route);

			if (!normalizedRoute) {
				return [];
			}

			return [
				{
					id: entry.id,
					createdAt: entry.createdAt,
					route: normalizedRoute,
				},
			];
		});
	} catch {
		return [];
	}
}

function cloneRoute(route: PlannedRoute): PlannedRoute {
	return {
		...(JSON.parse(JSON.stringify(route)) as PlannedRoute),
		waypoints: route.waypoints.map((waypoint) => ({
			label: waypoint.label,
			coordinate: [...waypoint.coordinate] as RouteWaypoint["coordinate"],
		})),
	};
}

function buildSavedRoute(route: PlannedRoute): SavedRoute {
	const routeId =
		globalThis.crypto?.randomUUID?.() ??
		`route-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

	return {
		id: routeId,
		createdAt: new Date().toISOString(),
		route: cloneRoute(route),
	};
}

class SavedRoutesState {
	initialized = $state(false);
	savedRoutes = $state<SavedRoute[]>([]);

	private persistSavedRoutes() {
		if (!browser) {
			return;
		}

		if (this.savedRoutes.length === 0) {
			window.localStorage.removeItem(SAVED_ROUTES_STORAGE_KEY);
			return;
		}

		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(this.savedRoutes),
		);
	}

	initSavedRoutes(): SavedRoute[] {
		if (!browser) {
			return this.savedRoutes;
		}

		if (this.initialized) {
			return this.savedRoutes;
		}

		this.initialized = true;
		this.savedRoutes = parseSavedRoutes(
			window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY),
		);

		return this.savedRoutes;
	}

	addSavedRoute(route: PlannedRoute): SavedRoute {
		this.initSavedRoutes();

		const savedRoute = buildSavedRoute(route);
		this.savedRoutes = [savedRoute, ...this.savedRoutes];
		this.persistSavedRoutes();

		return savedRoute;
	}

	getSavedRouteById(id: string | null | undefined): SavedRoute | null {
		if (!id) {
			return null;
		}

		this.initSavedRoutes();

		const savedRoute = this.savedRoutes.find((route) => route.id === id);

		return savedRoute
			? {
					...savedRoute,
					route: cloneRoute(savedRoute.route),
				}
			: null;
	}

	deleteSavedRoute(id: string): boolean {
		this.initSavedRoutes();

		const nextSavedRoutes = this.savedRoutes.filter((route) => route.id !== id);

		if (nextSavedRoutes.length === this.savedRoutes.length) {
			return false;
		}

		this.savedRoutes = nextSavedRoutes;
		this.persistSavedRoutes();

		return true;
	}

	resetSavedRoutesForTests() {
		this.initialized = false;
		this.savedRoutes = [];

		if (browser) {
			window.localStorage.removeItem(SAVED_ROUTES_STORAGE_KEY);
		}
	}
}

export const savedRoutesState = new SavedRoutesState();

export function initSavedRoutes() {
	return savedRoutesState.initSavedRoutes();
}

export function addSavedRoute(route: PlannedRoute) {
	return savedRoutesState.addSavedRoute(route);
}

export function getSavedRouteById(id: string | null | undefined) {
	return savedRoutesState.getSavedRouteById(id);
}

export function deleteSavedRoute(id: string) {
	return savedRoutesState.deleteSavedRoute(id);
}

export function resetSavedRoutesForTests() {
	savedRoutesState.resetSavedRoutesForTests();
}
