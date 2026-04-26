import { browser } from "$app/environment";

import type { PlannedRoute } from "$lib/route-planning";
import {
	buildSavedRoute,
	cloneSavedRoute,
	normalizeSavedRoutes,
	parseSavedRoutes,
	SAVED_ROUTES_STORAGE_KEY,
	type SavedRoute,
} from "$lib/saved-routes-core";
export {
	buildSavedRoute,
	cloneRoute,
	isPlannedRoute,
	normalizePlannedRoute,
	parseSavedRoutes,
	SAVED_ROUTES_STORAGE_KEY,
	type SavedRoute,
} from "$lib/saved-routes-core";

export type SavedRoutesAuthStatus = "loading" | "signedOut" | "signedIn";

export type SavedRoutesRemoteAdapter = {
	save: (savedRoute: SavedRoute) => Promise<void>;
	delete: (routeId: string) => Promise<void>;
	mergeLocalRoutes: (routes: SavedRoute[]) => Promise<{
		inserted: number;
		skipped: number;
		invalid: number;
		duplicate: number;
	}>;
};

const SYNCED_MIGRATIONS_STORAGE_KEY = "velix.savedRoutes.syncedMigrations";
const inFlightMerges = new Map<string, Promise<void>>();

function getSyncedRoutesStorageKey(userId: string) {
	return `velix.savedRoutes.synced.${userId}`;
}

function readMigrationUserIds(): Set<string> {
	if (!browser) {
		return new Set();
	}

	try {
		const parsedValue = JSON.parse(
			window.localStorage.getItem(SYNCED_MIGRATIONS_STORAGE_KEY) ?? "[]",
		) as unknown;

		return new Set(
			Array.isArray(parsedValue)
				? parsedValue.filter(
						(value): value is string => typeof value === "string",
					)
				: [],
		);
	} catch {
		return new Set();
	}
}

function writeMigrationUserIds(userIds: Set<string>) {
	if (!browser) {
		return;
	}

	window.localStorage.setItem(
		SYNCED_MIGRATIONS_STORAGE_KEY,
		JSON.stringify([...userIds]),
	);
}

function dedupeSavedRoutesById(savedRoutes: SavedRoute[]): SavedRoute[] {
	const seenRouteIds = new Set<string>();
	const dedupedRoutes: SavedRoute[] = [];

	for (const savedRoute of savedRoutes) {
		if (seenRouteIds.has(savedRoute.id)) {
			continue;
		}

		seenRouteIds.add(savedRoute.id);
		dedupedRoutes.push(savedRoute);
	}

	return dedupedRoutes;
}

class SavedRoutesState {
	initialized = $state(false);
	savedRoutes = $state<SavedRoute[]>([]);
	authStatus = $state<SavedRoutesAuthStatus>("signedOut");
	authUserId = $state<string | null>(null);
	remoteReady = $state(false);
	syncError = $state<string | null>(null);
	pendingRemoteRouteIds = $state<Set<string>>(new Set());

	private remoteAdapter: SavedRoutesRemoteAdapter | null = null;

	private persistSavedRoutes() {
		if (!browser) {
			return;
		}

		if (this.authStatus === "signedIn" && this.authUserId) {
			this.persistUserScopedRoutes(this.authUserId, this.savedRoutes);
			return;
		}

		this.persistAnonymousRoutes(this.savedRoutes);
	}

	private persistAnonymousRoutes(savedRoutes: SavedRoute[]) {
		if (savedRoutes.length === 0) {
			window.localStorage.removeItem(SAVED_ROUTES_STORAGE_KEY);
			return;
		}

		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify(savedRoutes),
		);
	}

	private persistUserScopedRoutes(userId: string, savedRoutes: SavedRoute[]) {
		const storageKey = getSyncedRoutesStorageKey(userId);

		if (savedRoutes.length === 0) {
			window.localStorage.removeItem(storageKey);
			return;
		}

		window.localStorage.setItem(storageKey, JSON.stringify(savedRoutes));
	}

	private readAnonymousRoutes(): SavedRoute[] {
		if (!browser) {
			return [];
		}

		return parseSavedRoutes(
			window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY),
		);
	}

	private readUserScopedRoutes(userId: string): SavedRoute[] {
		if (!browser) {
			return [];
		}

		return parseSavedRoutes(
			window.localStorage.getItem(getSyncedRoutesStorageKey(userId)),
		);
	}

	private trackPendingRemoteRoute(routeId: string) {
		this.pendingRemoteRouteIds = new Set([
			...this.pendingRemoteRouteIds,
			routeId,
		]);
	}

	private clearPendingRemoteRoute(routeId: string) {
		const nextPendingRouteIds = new Set(this.pendingRemoteRouteIds);
		nextPendingRouteIds.delete(routeId);
		this.pendingRemoteRouteIds = nextPendingRouteIds;
	}

	private setRemoteFailure(routeId: string, message: string) {
		this.clearPendingRemoteRoute(routeId);
		this.syncError = message;
	}

	initSavedRoutes(): SavedRoute[] {
		if (!browser) {
			return this.savedRoutes;
		}

		if (this.initialized) {
			return this.savedRoutes;
		}

		this.initialized = true;
		this.savedRoutes =
			this.authStatus === "signedIn" && this.authUserId
				? this.readUserScopedRoutes(this.authUserId)
				: this.readAnonymousRoutes();

		return this.savedRoutes;
	}

	setAuthUser(userId: string | null | undefined) {
		this.initSavedRoutes();

		if (userId === undefined) {
			this.authStatus = "loading";
			this.authUserId = null;
			this.remoteReady = false;
			this.syncError = null;
			this.setRemoteAdapter(null);
			return;
		}

		if (userId === null) {
			this.authStatus = "signedOut";
			this.authUserId = null;
			this.remoteReady = false;
			this.pendingRemoteRouteIds = new Set();
			this.setRemoteAdapter(null);
			this.savedRoutes = this.readAnonymousRoutes();
			this.syncError = null;
			return;
		}

		if (this.authUserId !== userId || this.authStatus !== "signedIn") {
			this.savedRoutes = this.readUserScopedRoutes(userId);
			this.remoteReady = false;
		}

		this.authStatus = "signedIn";
		this.authUserId = userId;
		this.syncError = null;
	}

	applyRemoteRoutes(userId: string, routes: unknown[]) {
		if (this.authStatus !== "signedIn" || this.authUserId !== userId) {
			return;
		}

		const nextSavedRoutes = normalizeSavedRoutes(routes).toSorted(
			(left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
		);

		this.savedRoutes = nextSavedRoutes;
		this.remoteReady = true;
		this.syncError = null;

		if (browser) {
			this.persistUserScopedRoutes(userId, nextSavedRoutes);
		}
	}

	setRemoteAdapter(adapter: SavedRoutesRemoteAdapter | null) {
		this.remoteAdapter = adapter;
	}

	async runLocalMergeOnce(userId: string) {
		if (!browser || this.authUserId !== userId || !this.remoteAdapter) {
			return;
		}

		const inFlightMerge = inFlightMerges.get(userId);
		if (inFlightMerge) {
			await inFlightMerge;
			return;
		}

		const remoteAdapter = this.remoteAdapter;
		const mergePromise = (async () => {
			const migratedUserIds = readMigrationUserIds();
			if (migratedUserIds.has(userId)) {
				return;
			}

			const localRoutes = dedupeSavedRoutesById(this.readAnonymousRoutes());
			if (localRoutes.length === 0) {
				migratedUserIds.add(userId);
				writeMigrationUserIds(migratedUserIds);
				return;
			}

			try {
				await remoteAdapter.mergeLocalRoutes(localRoutes);
				migratedUserIds.add(userId);
				writeMigrationUserIds(migratedUserIds);
				this.syncError = null;
			} catch (error) {
				this.syncError =
					error instanceof Error
						? `Could not sync local routes: ${error.message}`
						: "Could not sync local routes.";
			}
		})().finally(() => {
			inFlightMerges.delete(userId);
		});

		inFlightMerges.set(userId, mergePromise);
		await mergePromise;
	}

	addSavedRoute(route: PlannedRoute): SavedRoute {
		this.initSavedRoutes();

		const savedRoute = buildSavedRoute(route);
		this.savedRoutes = [savedRoute, ...this.savedRoutes];
		this.syncError = null;
		this.persistSavedRoutes();

		if (this.authStatus === "signedIn" && this.remoteAdapter) {
			this.trackPendingRemoteRoute(savedRoute.id);
			void this.remoteAdapter
				.save(savedRoute)
				.then(() => {
					this.clearPendingRemoteRoute(savedRoute.id);
					this.syncError = null;
				})
				.catch((error: unknown) => {
					this.setRemoteFailure(
						savedRoute.id,
						error instanceof Error
							? `Could not sync saved route: ${error.message}`
							: "Could not sync saved route.",
					);
				});
		}

		return savedRoute;
	}

	upsertSavedRoute(route: PlannedRoute, id?: string): SavedRoute {
		this.initSavedRoutes();

		const existingRoute =
			id && id.length > 0
				? this.savedRoutes.find((savedRoute) => savedRoute.id === id)
				: undefined;
		const savedRoute = buildSavedRoute(route, {
			id: existingRoute?.id,
			createdAt: existingRoute?.createdAt,
		});

		this.savedRoutes = existingRoute
			? this.savedRoutes.map((entry) =>
					entry.id === existingRoute.id ? savedRoute : entry,
				)
			: [savedRoute, ...this.savedRoutes];
		this.syncError = null;
		this.persistSavedRoutes();

		if (this.authStatus === "signedIn" && this.remoteAdapter) {
			this.trackPendingRemoteRoute(savedRoute.id);
			void this.remoteAdapter
				.save(savedRoute)
				.then(() => {
					this.clearPendingRemoteRoute(savedRoute.id);
					this.syncError = null;
				})
				.catch((error: unknown) => {
					this.setRemoteFailure(
						savedRoute.id,
						error instanceof Error
							? `Could not sync saved route: ${error.message}`
							: "Could not sync saved route.",
					);
				});
		}

		return savedRoute;
	}

	getSavedRouteById(id: string | null | undefined): SavedRoute | null {
		if (!id) {
			return null;
		}

		this.initSavedRoutes();

		const savedRoute = this.savedRoutes.find((route) => route.id === id);

		return savedRoute ? cloneSavedRoute(savedRoute) : null;
	}

	deleteSavedRoute(id: string): boolean {
		this.initSavedRoutes();

		const nextSavedRoutes = this.savedRoutes.filter((route) => route.id !== id);

		if (nextSavedRoutes.length === this.savedRoutes.length) {
			return false;
		}

		this.savedRoutes = nextSavedRoutes;
		this.syncError = null;
		this.persistSavedRoutes();

		if (this.authStatus === "signedIn" && this.remoteAdapter) {
			this.trackPendingRemoteRoute(id);
			void this.remoteAdapter
				.delete(id)
				.then(() => {
					this.clearPendingRemoteRoute(id);
					this.syncError = null;
				})
				.catch((error: unknown) => {
					this.setRemoteFailure(
						id,
						error instanceof Error
							? `Could not delete synced route: ${error.message}`
							: "Could not delete synced route.",
					);
				});
		}

		return true;
	}

	resetSavedRoutesForTests() {
		this.initialized = false;
		this.savedRoutes = [];
		this.authStatus = "signedOut";
		this.authUserId = null;
		this.remoteReady = false;
		this.syncError = null;
		this.pendingRemoteRouteIds = new Set();
		this.remoteAdapter = null;
		inFlightMerges.clear();

		if (browser) {
			window.localStorage.removeItem(SAVED_ROUTES_STORAGE_KEY);
			window.localStorage.removeItem(SYNCED_MIGRATIONS_STORAGE_KEY);
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
