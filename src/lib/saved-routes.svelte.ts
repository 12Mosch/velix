import type { PlannedRoute } from "$lib/route-planning";
import {
	createSavedRoutesRepository,
	type SavedRouteScope,
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
import { Effect } from "effect";

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
	localRoutesReady = $state(false);
	localSaveError = $state<string | null>(null);
	pendingRemoteRouteIds = $state<Set<string>>(new Set());

	initSavedRoutes(): Promise<SavedRoute[]> {
		return Effect.runPromise(savedRoutesUseCases.initSavedRoutes(this));
	}

	async setAuthUser(userId: string | null | undefined) {
		await Effect.runPromise(savedRoutesUseCases.setAuthUser(this, userId));
	}

	async applyRemoteRoutes(userId: string, routes: unknown[]) {
		await Effect.runPromise(
			savedRoutesUseCases.applyRemoteSavedRoutes(this, userId, routes),
		);
	}

	setRemoteAdapter(adapter: SavedRoutesRemoteRepository | null) {
		Effect.runSync(savedRoutesUseCases.setRemoteRepository(adapter));
	}

	async setRemoteSyncUnavailable(message: string) {
		await Effect.runPromise(
			savedRoutesUseCases.setRemoteSyncUnavailable(this, message),
		);
	}

	async runLocalMergeOnce(userId: string) {
		await Effect.runPromise(
			savedRoutesUseCases.runLocalSavedRoutesMergeOnce(this, userId),
		);
	}

	addSavedRoute(route: PlannedRoute): Promise<SavedRoute> {
		return Effect.runPromise(savedRoutesUseCases.createSavedRoute(this, route));
	}

	upsertSavedRoute(
		route: PlannedRoute,
		id?: string,
		options?: { source?: "autosave" | "explicit" | "share" },
	): Promise<SavedRoute> {
		return Effect.runPromise(
			savedRoutesUseCases.upsertSavedRoute(this, route, id, options),
		);
	}

	getSavedRouteById(id: string | null | undefined): Promise<SavedRoute | null> {
		return Effect.runPromise(savedRoutesUseCases.getSavedRouteById(this, id));
	}

	deleteSavedRoute(id: string): Promise<boolean> {
		return Effect.runPromise(savedRoutesUseCases.deleteSavedRoute(this, id));
	}

	resetSavedRoutesForTests(): Promise<void> {
		return Effect.runPromise(savedRoutesUseCases.reset(this));
	}
}

export const savedRoutesState = new SavedRoutesState();

export function initSavedRoutes() {
	return savedRoutesState.initSavedRoutes();
}

export function addSavedRoute(route: PlannedRoute) {
	return savedRoutesState.addSavedRoute(route);
}

export function upsertSavedRoute(
	route: PlannedRoute,
	id?: string,
	options?: { source?: "autosave" | "explicit" | "share" },
) {
	return savedRoutesState.upsertSavedRoute(route, id, options);
}

export function getSavedRouteById(id: string | null | undefined) {
	return savedRoutesState.getSavedRouteById(id);
}

export function deleteSavedRoute(id: string) {
	return savedRoutesState.deleteSavedRoute(id);
}

export function resetSavedRoutesForTests() {
	return savedRoutesState.resetSavedRoutesForTests();
}

function getTestSavedRouteScope(
	options: { userId?: string } = {},
): SavedRouteScope {
	return options.userId
		? { kind: "user", userId: options.userId }
		: { kind: "anonymous" };
}

export async function seedSavedRoutesForTests(
	routes: SavedRoute[],
	options: { userId?: string } = {},
) {
	const repository = createSavedRoutesRepository(createBrowserStorage());
	await repository.init();
	await repository.replaceRoutes(getTestSavedRouteScope(options), routes);
	savedRoutesState.initialized = false;
	await savedRoutesState.initSavedRoutes();
}

export async function readSavedRoutesForTests(
	options: { userId?: string } = {},
) {
	const repository = createSavedRoutesRepository(createBrowserStorage());
	await repository.init();
	return await repository.readRoutes(getTestSavedRouteScope(options));
}

export async function clearSavedRoutesForTests() {
	await resetSavedRoutesForTests();
}
