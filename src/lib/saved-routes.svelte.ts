import { browser } from "$app/environment";

import type { PlannedRoute } from "$lib/route-planning";

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

function isRouteCoordinate(
	value: unknown,
): value is PlannedRoute["coordinates"][number] {
	if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
		return false;
	}

	return value.every(isFiniteNumber);
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

export function isPlannedRoute(value: unknown): value is PlannedRoute {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value.startLabel === "string" &&
		typeof value.destinationLabel === "string" &&
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

	return (
		typeof candidate.id === "string" &&
		candidate.id.length > 0 &&
		typeof candidate.createdAt === "string" &&
		Number.isFinite(Date.parse(candidate.createdAt)) &&
		isPlannedRoute(candidate.route)
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

		return parsedValue.filter(isSavedRoute);
	} catch {
		return [];
	}
}

function cloneRoute(route: PlannedRoute): PlannedRoute {
	return JSON.parse(JSON.stringify(route)) as PlannedRoute;
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
