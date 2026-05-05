import type { PlannedRoute } from "$lib/route-planning";
import {
	createSavedRoutesRepository,
	SYNCED_MIGRATIONS_STORAGE_KEY,
} from "$lib/saved-routes/saved-routes-repository";
import {
	type SavedRoutesAuthStatus,
	type SavedRoutesRemoteRepository,
	SavedRoutesUseCases,
} from "$lib/saved-routes/saved-routes-use-cases";
import {
	buildSavedRoute,
	cloneRoute,
	isPlannedRoute,
	normalizePlannedRoute,
	parseSavedRoutes,
	SAVED_ROUTES_STORAGE_KEY,
	type SavedRoute,
} from "$lib/saved-routes-core";
import { createBrowserStorage } from "$lib/storage/browser-storage";

export {
	buildSavedRoute,
	cloneRoute,
	isPlannedRoute,
	normalizePlannedRoute,
	parseSavedRoutes,
	SAVED_ROUTES_STORAGE_KEY,
	type SavedRoute,
	type SavedRoutesAuthStatus,
	SYNCED_MIGRATIONS_STORAGE_KEY,
};

export type SavedRoutesRemoteAdapter = SavedRoutesRemoteRepository;

const savedRoutesUseCases = new SavedRoutesUseCases(
	createSavedRoutesRepository(createBrowserStorage()),
);

class SavedRoutesState {
	initialized = $state(false);
	savedRoutes = $state<SavedRoute[]>([]);
	authStatus = $state<SavedRoutesAuthStatus>("signedOut");
	authUserId = $state<string | null>(null);
	remoteReady = $state(false);
	syncError = $state<string | null>(null);
	pendingRemoteRouteIds = $state<Set<string>>(new Set());

	initSavedRoutes(): SavedRoute[] {
		return savedRoutesUseCases.initSavedRoutes(this);
	}

	setAuthUser(userId: string | null | undefined) {
		savedRoutesUseCases.setAuthUser(this, userId);
	}

	applyRemoteRoutes(userId: string, routes: unknown[]) {
		savedRoutesUseCases.applyRemoteSavedRoutes(this, userId, routes);
	}

	setRemoteAdapter(adapter: SavedRoutesRemoteRepository | null) {
		savedRoutesUseCases.setRemoteRepository(adapter);
	}

	setRemoteSyncUnavailable(message: string) {
		savedRoutesUseCases.setRemoteSyncUnavailable(this, message);
	}

	async runLocalMergeOnce(userId: string) {
		await savedRoutesUseCases.runLocalSavedRoutesMergeOnce(this, userId);
	}

	addSavedRoute(route: PlannedRoute): SavedRoute {
		return savedRoutesUseCases.createSavedRoute(this, route);
	}

	upsertSavedRoute(route: PlannedRoute, id?: string): SavedRoute {
		return savedRoutesUseCases.upsertSavedRoute(this, route, id);
	}

	getSavedRouteById(id: string | null | undefined): SavedRoute | null {
		return savedRoutesUseCases.getSavedRouteById(this, id);
	}

	deleteSavedRoute(id: string): boolean {
		return savedRoutesUseCases.deleteSavedRoute(this, id);
	}

	resetSavedRoutesForTests() {
		savedRoutesUseCases.reset(this);
	}
}

export const savedRoutesState = new SavedRoutesState();

export function initSavedRoutes() {
	return savedRoutesState.initSavedRoutes();
}

export function addSavedRoute(route: PlannedRoute) {
	return savedRoutesState.addSavedRoute(route);
}

export function upsertSavedRoute(route: PlannedRoute, id?: string) {
	return savedRoutesState.upsertSavedRoute(route, id);
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
