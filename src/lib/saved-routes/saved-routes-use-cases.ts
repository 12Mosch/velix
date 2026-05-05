import type { PlannedRoute } from "$lib/route-planning";
import type { SavedRoutesRepository } from "$lib/saved-routes/saved-routes-repository";
import { dedupeSavedRoutesById } from "$lib/saved-routes/saved-routes-repository";
import {
	buildSavedRoute,
	cloneSavedRoute,
	normalizeSavedRoutes,
	type SavedRoute,
} from "$lib/saved-routes-core";

export type SavedRoutesAuthStatus = "loading" | "signedOut" | "signedIn";

export type SavedRoutesRemoteRepository = {
	save: (savedRoute: SavedRoute) => Promise<void>;
	delete: (routeId: string) => Promise<void>;
	mergeLocalRoutes: (routes: SavedRoute[]) => Promise<{
		inserted: number;
		skipped: number;
		invalid: number;
		duplicate: number;
	}>;
};

export type SavedRoutesStateModel = {
	initialized: boolean;
	savedRoutes: SavedRoute[];
	authStatus: SavedRoutesAuthStatus;
	authUserId: string | null;
	remoteReady: boolean;
	syncError: string | null;
	pendingRemoteRouteIds: Set<string>;
};

export class SavedRoutesUseCases {
	private remoteRepository: SavedRoutesRemoteRepository | null = null;
	private readonly inFlightMerges = new Map<string, Promise<void>>();

	constructor(private readonly repository: SavedRoutesRepository) {}

	initSavedRoutes(state: SavedRoutesStateModel): SavedRoute[] {
		if (state.initialized) {
			return state.savedRoutes;
		}

		state.initialized = true;
		state.savedRoutes =
			state.authStatus === "signedIn" && state.authUserId
				? this.repository.readUserRoutes(state.authUserId)
				: this.repository.readAnonymousRoutes();

		return state.savedRoutes;
	}

	setAuthUser(state: SavedRoutesStateModel, userId: string | null | undefined) {
		this.initSavedRoutes(state);

		if (userId === undefined) {
			state.authStatus = "loading";
			state.authUserId = null;
			state.remoteReady = false;
			state.syncError = null;
			this.setRemoteRepository(null);
			return;
		}

		if (userId === null) {
			state.authStatus = "signedOut";
			state.authUserId = null;
			state.remoteReady = false;
			state.pendingRemoteRouteIds = new Set();
			this.setRemoteRepository(null);
			state.savedRoutes = this.repository.readAnonymousRoutes();
			state.syncError = null;
			return;
		}

		if (state.authUserId !== userId || state.authStatus !== "signedIn") {
			state.savedRoutes = this.repository.readUserRoutes(userId);
			state.remoteReady = false;
		}

		state.authStatus = "signedIn";
		state.authUserId = userId;
		state.syncError = null;
	}

	applyRemoteSavedRoutes(
		state: SavedRoutesStateModel,
		userId: string,
		routes: unknown[],
	) {
		if (state.authStatus !== "signedIn" || state.authUserId !== userId) {
			return;
		}

		const nextSavedRoutes = normalizeSavedRoutes(routes).toSorted(
			(left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
		);

		state.savedRoutes = nextSavedRoutes;
		state.remoteReady = true;
		state.syncError = null;
		this.repository.writeUserRoutes(userId, nextSavedRoutes);
	}

	setRemoteRepository(repository: SavedRoutesRemoteRepository | null) {
		this.remoteRepository = repository;
	}

	setRemoteSyncUnavailable(state: SavedRoutesStateModel, message: string) {
		this.setRemoteRepository(null);
		state.remoteReady = true;
		state.pendingRemoteRouteIds = new Set();
		state.syncError = message;

		if (
			state.authStatus === "signedIn" &&
			state.authUserId &&
			state.savedRoutes.length === 0
		) {
			const anonymousRoutes = this.repository.readAnonymousRoutes();
			if (anonymousRoutes.length > 0) {
				state.savedRoutes = anonymousRoutes;
				this.repository.writeUserRoutes(state.authUserId, anonymousRoutes);
				this.repository.writeAnonymousRoutes([]);
			}
		}
	}

	async runLocalSavedRoutesMergeOnce(
		state: SavedRoutesStateModel,
		userId: string,
	) {
		if (state.authUserId !== userId || !this.remoteRepository) {
			return;
		}

		const inFlightMerge = this.inFlightMerges.get(userId);
		if (inFlightMerge) {
			await inFlightMerge;
			return;
		}

		const remoteRepository = this.remoteRepository;
		const mergePromise = (async () => {
			const migratedUserIds = this.repository.readMergedUserIds();
			if (migratedUserIds.has(userId)) {
				return;
			}

			const localRoutes = dedupeSavedRoutesById(
				this.repository.readAnonymousRoutes(),
			);
			if (localRoutes.length === 0) {
				migratedUserIds.add(userId);
				this.repository.writeMergedUserIds(migratedUserIds);
				return;
			}

			try {
				await remoteRepository.mergeLocalRoutes(localRoutes);
				migratedUserIds.add(userId);
				this.repository.writeMergedUserIds(migratedUserIds);
				state.syncError = null;
			} catch (error) {
				state.syncError =
					error instanceof Error
						? `Could not sync local routes: ${error.message}`
						: "Could not sync local routes.";
			}
		})().finally(() => {
			this.inFlightMerges.delete(userId);
		});

		this.inFlightMerges.set(userId, mergePromise);
		await mergePromise;
	}

	createSavedRoute(
		state: SavedRoutesStateModel,
		route: PlannedRoute,
	): SavedRoute {
		this.initSavedRoutes(state);

		const savedRoute = buildSavedRoute(route);
		state.savedRoutes = [savedRoute, ...state.savedRoutes];
		state.syncError = null;
		this.persistSavedRoutes(state);
		this.syncSavedRoute(state, savedRoute);

		return savedRoute;
	}

	upsertSavedRoute(
		state: SavedRoutesStateModel,
		route: PlannedRoute,
		id?: string,
	): SavedRoute {
		this.initSavedRoutes(state);

		const existingRoute =
			id && id.length > 0
				? state.savedRoutes.find((savedRoute) => savedRoute.id === id)
				: undefined;
		const savedRoute = buildSavedRoute(route, {
			id: existingRoute?.id,
			createdAt: existingRoute?.createdAt,
		});

		state.savedRoutes = existingRoute
			? state.savedRoutes.map((entry) =>
					entry.id === existingRoute.id ? savedRoute : entry,
				)
			: [savedRoute, ...state.savedRoutes];
		state.syncError = null;
		this.persistSavedRoutes(state);
		this.syncSavedRoute(state, savedRoute);

		return savedRoute;
	}

	getSavedRouteById(
		state: SavedRoutesStateModel,
		id: string | null | undefined,
	): SavedRoute | null {
		if (!id) {
			return null;
		}

		this.initSavedRoutes(state);

		const savedRoute = state.savedRoutes.find((route) => route.id === id);

		return savedRoute ? cloneSavedRoute(savedRoute) : null;
	}

	deleteSavedRoute(state: SavedRoutesStateModel, id: string): boolean {
		this.initSavedRoutes(state);

		const nextSavedRoutes = state.savedRoutes.filter(
			(route) => route.id !== id,
		);

		if (nextSavedRoutes.length === state.savedRoutes.length) {
			return false;
		}

		state.savedRoutes = nextSavedRoutes;
		state.syncError = null;
		this.persistSavedRoutes(state);
		this.deleteRemoteSavedRoute(state, id);

		return true;
	}

	reset(state: SavedRoutesStateModel) {
		state.initialized = false;
		state.savedRoutes = [];
		state.authStatus = "signedOut";
		state.authUserId = null;
		state.remoteReady = false;
		state.syncError = null;
		state.pendingRemoteRouteIds = new Set();
		this.remoteRepository = null;
		this.inFlightMerges.clear();
		this.repository.clear();
	}

	private persistSavedRoutes(state: SavedRoutesStateModel) {
		if (state.authStatus === "signedIn" && state.authUserId) {
			this.repository.writeUserRoutes(state.authUserId, state.savedRoutes);
			return;
		}

		this.repository.writeAnonymousRoutes(state.savedRoutes);
	}

	private trackPendingRemoteRoute(
		state: SavedRoutesStateModel,
		routeId: string,
	) {
		state.pendingRemoteRouteIds = new Set([
			...state.pendingRemoteRouteIds,
			routeId,
		]);
	}

	private clearPendingRemoteRoute(
		state: SavedRoutesStateModel,
		routeId: string,
	) {
		const nextPendingRouteIds = new Set(state.pendingRemoteRouteIds);
		nextPendingRouteIds.delete(routeId);
		state.pendingRemoteRouteIds = nextPendingRouteIds;
	}

	private setRemoteFailure(
		state: SavedRoutesStateModel,
		routeId: string,
		message: string,
	) {
		this.clearPendingRemoteRoute(state, routeId);
		state.syncError = message;
	}

	private syncSavedRoute(state: SavedRoutesStateModel, savedRoute: SavedRoute) {
		if (state.authStatus !== "signedIn" || !this.remoteRepository) {
			return;
		}

		this.trackPendingRemoteRoute(state, savedRoute.id);
		void this.remoteRepository
			.save(savedRoute)
			.then(() => {
				this.clearPendingRemoteRoute(state, savedRoute.id);
				state.syncError = null;
			})
			.catch((error: unknown) => {
				this.setRemoteFailure(
					state,
					savedRoute.id,
					error instanceof Error
						? `Could not sync saved route: ${error.message}`
						: "Could not sync saved route.",
				);
			});
	}

	private deleteRemoteSavedRoute(
		state: SavedRoutesStateModel,
		routeId: string,
	) {
		if (state.authStatus !== "signedIn" || !this.remoteRepository) {
			return;
		}

		this.trackPendingRemoteRoute(state, routeId);
		void this.remoteRepository
			.delete(routeId)
			.then(() => {
				this.clearPendingRemoteRoute(state, routeId);
				state.syncError = null;
			})
			.catch((error: unknown) => {
				this.setRemoteFailure(
					state,
					routeId,
					error instanceof Error
						? `Could not delete synced route: ${error.message}`
						: "Could not delete synced route.",
				);
			});
	}
}
