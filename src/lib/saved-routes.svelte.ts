import type { PlannedRoute } from "$lib/route-planning";
import {
	createSavedRoutesRepository,
	type SavedRouteScope,
	SYNCED_MIGRATIONS_STORAGE_KEY,
} from "$lib/saved-routes/saved-routes-repository";
import {
	type SavedRoutesAuthStatus,
	type SavedRoutesRemoteRepository,
	type SavedRouteSummaryFilters,
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
	type SavedRouteSummary,
	type SavedRouteVersion,
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
	type SavedRouteSummary,
	type SavedRouteVersion,
	type SavedRoutesAuthStatus,
	type SavedRouteSummaryFilters,
	SYNCED_MIGRATIONS_STORAGE_KEY,
};

export type SavedRoutesRemoteAdapter = SavedRoutesRemoteRepository;

const savedRoutesUseCases = new SavedRoutesUseCases(
	createSavedRoutesRepository(Effect.runSync(createBrowserStorage())),
);

class SavedRoutesState {
	initialized = $state(false);
	savedRoutes = $state<SavedRoute[]>([]);
	savedRouteSummaries = $state<SavedRouteSummary[]>([]);
	savedRouteSummariesContinueCursor = $state<string | null>(null);
	savedRouteSummariesLoading = $state(false);
	savedRouteSummaryFilters = $state<SavedRouteSummaryFilters>({});
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

	applyRemoteRoutesEffect(userId: string, routes: unknown[]) {
		return savedRoutesUseCases.applyRemoteSavedRoutes(this, userId, routes);
	}

	applyRemoteRouteSummariesEffect(
		userId: string,
		summaries: unknown[],
		continueCursor: string | null,
		filters: SavedRouteSummaryFilters = {},
	) {
		return savedRoutesUseCases.applyRemoteSavedRouteSummaries(
			this,
			userId,
			summaries,
			continueCursor,
			"replace",
			filters,
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

	runLocalMergeOnceEffect(userId: string) {
		return savedRoutesUseCases.runLocalSavedRoutesMergeOnce(this, userId);
	}

	addSavedRoute(route: PlannedRoute): Promise<SavedRoute> {
		return Effect.runPromise(savedRoutesUseCases.createSavedRoute(this, route));
	}

	addSavedRouteEffect(route: PlannedRoute) {
		return savedRoutesUseCases.createSavedRoute(this, route);
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

	upsertSavedRouteEffect(
		route: PlannedRoute,
		id?: string,
		options?: { source?: "autosave" | "explicit" | "share" },
	) {
		return savedRoutesUseCases.upsertSavedRoute(this, route, id, options);
	}

	getSavedRouteById(id: string | null | undefined): Promise<SavedRoute | null> {
		return Effect.runPromise(savedRoutesUseCases.getSavedRouteById(this, id));
	}

	getSavedRouteByIdEffect(id: string | null | undefined) {
		return savedRoutesUseCases.getSavedRouteById(this, id);
	}

	loadMoreSavedRouteSummaries(): Promise<void> {
		return Effect.runPromise(
			savedRoutesUseCases.loadMoreSavedRouteSummaries(this),
		);
	}

	loadSavedRouteSummaries(
		filters: SavedRouteSummaryFilters = {},
	): Promise<void> {
		return Effect.runPromise(
			savedRoutesUseCases.loadSavedRouteSummaries(this, filters),
		);
	}

	deleteSavedRoute(id: string): Promise<boolean> {
		return Effect.runPromise(savedRoutesUseCases.deleteSavedRoute(this, id));
	}

	deleteSavedRouteEffect(id: string) {
		return savedRoutesUseCases.deleteSavedRoute(this, id);
	}

	listSavedRouteVersions(routeId: string): Promise<SavedRouteVersion[]> {
		return Effect.runPromise(
			savedRoutesUseCases.listSavedRouteVersions(this, routeId),
		);
	}

	restoreLatestSavedRouteVersion(id: string) {
		return Effect.runPromise(
			savedRoutesUseCases.restoreLatestSavedRouteVersion(this, id),
		);
	}

	restoreLatestSavedRouteVersionEffect(id: string) {
		return savedRoutesUseCases.restoreLatestSavedRouteVersion(this, id);
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

export function addSavedRouteEffect(route: PlannedRoute) {
	return savedRoutesState.addSavedRouteEffect(route);
}

export function upsertSavedRoute(
	route: PlannedRoute,
	id?: string,
	options?: { source?: "autosave" | "explicit" | "share" },
) {
	return savedRoutesState.upsertSavedRoute(route, id, options);
}

export function upsertSavedRouteEffect(
	route: PlannedRoute,
	id?: string,
	options?: { source?: "autosave" | "explicit" | "share" },
) {
	return savedRoutesState.upsertSavedRouteEffect(route, id, options);
}

export function getSavedRouteById(id: string | null | undefined) {
	return savedRoutesState.getSavedRouteById(id);
}

export function getSavedRouteByIdEffect(id: string | null | undefined) {
	return savedRoutesState.getSavedRouteByIdEffect(id);
}

export function loadMoreSavedRouteSummaries() {
	return savedRoutesState.loadMoreSavedRouteSummaries();
}

export function loadSavedRouteSummaries(
	filters: SavedRouteSummaryFilters = {},
) {
	return savedRoutesState.loadSavedRouteSummaries(filters);
}

export function deleteSavedRoute(id: string) {
	return savedRoutesState.deleteSavedRoute(id);
}

export function deleteSavedRouteEffect(id: string) {
	return savedRoutesState.deleteSavedRouteEffect(id);
}

export function listSavedRouteVersions(routeId: string) {
	return savedRoutesState.listSavedRouteVersions(routeId);
}

export function restoreLatestSavedRouteVersion(id: string) {
	return savedRoutesState.restoreLatestSavedRouteVersion(id);
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
	const repository = createSavedRoutesRepository(
		Effect.runSync(createBrowserStorage()),
	);
	await Effect.runPromise(repository.init());
	await Effect.runPromise(
		repository.replaceRoutes(getTestSavedRouteScope(options), routes),
	);
	savedRoutesState.initialized = false;
	await savedRoutesState.initSavedRoutes();
}

export async function readSavedRoutesForTests(
	options: { userId?: string } = {},
) {
	const repository = createSavedRoutesRepository(
		Effect.runSync(createBrowserStorage()),
	);
	await Effect.runPromise(repository.init());
	return await Effect.runPromise(
		repository.readRoutes(getTestSavedRouteScope(options)),
	);
}

export async function clearSavedRoutesForTests() {
	await resetSavedRoutesForTests();
}
