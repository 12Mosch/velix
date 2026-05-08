import type { PlannedRoute } from "$lib/route-planning";
import type { SavedRoutesRepository } from "$lib/saved-routes/saved-routes-repository";
import { dedupeSavedRoutesById } from "$lib/saved-routes/saved-routes-repository";
import {
	buildSavedRoute,
	cloneSavedRoute,
	normalizeRemoteSavedRoutes,
	serializeSavedRouteForRemote,
	type RemoteSavedRoutePayload,
	type SavedRoute,
} from "$lib/saved-routes-core";
import { Effect } from "effect";

export type SavedRoutesAuthStatus = "loading" | "signedOut" | "signedIn";

export type SavedRoutesRemoteRepository = {
	save: (savedRoute: RemoteSavedRoutePayload) => Promise<void>;
	delete: (routeId: string) => Promise<void>;
	mergeLocalRoutes: (routes: RemoteSavedRoutePayload[]) => Promise<{
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
	private remoteSessionVersion = 0;

	constructor(private readonly repository: SavedRoutesRepository) {}

	initSavedRoutes(state: SavedRoutesStateModel): Effect.Effect<SavedRoute[]> {
		return Effect.sync(() => {
			if (state.initialized) {
				return state.savedRoutes;
			}

			state.initialized = true;
			state.savedRoutes =
				state.authStatus === "signedIn" && state.authUserId
					? this.repository.readUserRoutes(state.authUserId)
					: this.repository.readAnonymousRoutes();

			return state.savedRoutes;
		});
	}

	setAuthUser(
		state: SavedRoutesStateModel,
		userId: string | null | undefined,
	): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			yield* this.initSavedRoutes(state);

			if (userId === undefined) {
				this.bumpRemoteSession();
				state.authStatus = "loading";
				state.authUserId = null;
				state.remoteReady = false;
				state.syncError = null;
				yield* this.setRemoteRepository(null);
				return;
			}

			if (userId === null) {
				this.bumpRemoteSession();
				state.authStatus = "signedOut";
				state.authUserId = null;
				state.remoteReady = false;
				state.pendingRemoteRouteIds = new Set();
				yield* this.setRemoteRepository(null);
				state.savedRoutes = this.repository.readAnonymousRoutes();
				state.syncError = null;
				return;
			}

			if (state.authUserId !== userId || state.authStatus !== "signedIn") {
				this.bumpRemoteSession();
				yield* this.setRemoteRepository(null);
				state.savedRoutes = this.repository.readUserRoutes(userId);
				state.remoteReady = false;
				state.pendingRemoteRouteIds = new Set();
			}

			state.authStatus = "signedIn";
			state.authUserId = userId;
			state.syncError = null;
		});
	}

	applyRemoteSavedRoutes(
		state: SavedRoutesStateModel,
		userId: string,
		routes: unknown[],
	): Effect.Effect<void> {
		return Effect.sync(() => {
			if (state.authStatus !== "signedIn" || state.authUserId !== userId) {
				return;
			}

			const nextSavedRoutes = normalizeRemoteSavedRoutes(routes).toSorted(
				(left, right) =>
					Date.parse(right.createdAt) - Date.parse(left.createdAt),
			);
			const localRoutesById = new Map(
				state.savedRoutes.map((savedRoute) => [savedRoute.id, savedRoute]),
			);
			const remoteRouteIds = new Set(nextSavedRoutes.map((route) => route.id));
			const mergedSavedRoutes = [
				...nextSavedRoutes.flatMap((remoteRoute) => {
					if (!state.pendingRemoteRouteIds.has(remoteRoute.id)) {
						return [remoteRoute];
					}

					const optimisticRoute = localRoutesById.get(remoteRoute.id);
					return optimisticRoute ? [optimisticRoute] : [];
				}),
				...state.savedRoutes.filter(
					(savedRoute) =>
						state.pendingRemoteRouteIds.has(savedRoute.id) &&
						!remoteRouteIds.has(savedRoute.id),
				),
			].toSorted(
				(left, right) =>
					Date.parse(right.createdAt) - Date.parse(left.createdAt),
			);

			state.savedRoutes = mergedSavedRoutes;
			state.remoteReady = true;
			state.syncError = null;
			this.repository.writeUserRoutes(userId, mergedSavedRoutes);
		});
	}

	setRemoteRepository(
		repository: SavedRoutesRemoteRepository | null,
	): Effect.Effect<void> {
		return Effect.sync(() => {
			this.remoteRepository = repository;
		});
	}

	setRemoteSyncUnavailable(
		state: SavedRoutesStateModel,
		message: string,
	): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			this.bumpRemoteSession();
			yield* this.setRemoteRepository(null);
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
		});
	}

	runLocalSavedRoutesMergeOnce(
		state: SavedRoutesStateModel,
		userId: string,
	): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			if (state.authUserId !== userId || !this.remoteRepository) {
				return;
			}

			const inFlightMerge = this.inFlightMerges.get(userId);
			if (inFlightMerge) {
				yield* Effect.tryPromise({
					try: () => inFlightMerge,
					catch: (cause) => cause,
				}).pipe(Effect.catch(() => Effect.void));
				return;
			}

			const remoteRepository = this.remoteRepository;
			const sessionVersion = this.remoteSessionVersion;
			const mergeEffect = Effect.gen({ self: this }, function* () {
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

				let mergeFailed = false;
				yield* Effect.tryPromise({
					try: () =>
						remoteRepository.mergeLocalRoutes(
							localRoutes.map(serializeSavedRouteForRemote),
						),
					catch: (cause) => cause,
				}).pipe(
					Effect.catch((error) =>
						Effect.sync(() => {
							if (!this.isCurrentRemoteSession(state, userId, sessionVersion)) {
								return;
							}

							mergeFailed = true;
							state.syncError =
								error instanceof Error
									? `Could not sync local routes: ${error.message}`
									: "Could not sync local routes.";
						}),
					),
				);

				if (
					mergeFailed ||
					!this.isCurrentRemoteSession(state, userId, sessionVersion)
				) {
					return;
				}

				migratedUserIds.add(userId);
				this.repository.writeMergedUserIds(migratedUserIds);
				state.syncError = null;
			});
			let mergePromise: Promise<void>;
			mergePromise = Effect.runPromise(mergeEffect).finally(() => {
				if (
					this.isCurrentRemoteSession(state, userId, sessionVersion) &&
					this.inFlightMerges.get(userId) === mergePromise
				) {
					this.inFlightMerges.delete(userId);
				}
			});

			this.inFlightMerges.set(userId, mergePromise);
			yield* Effect.tryPromise({
				try: () => mergePromise,
				catch: (cause) => cause,
			}).pipe(Effect.catch(() => Effect.void));
		});
	}

	createSavedRoute(
		state: SavedRoutesStateModel,
		route: PlannedRoute,
	): Effect.Effect<SavedRoute> {
		return Effect.gen({ self: this }, function* () {
			yield* this.initSavedRoutes(state);

			const savedRoute = buildSavedRoute(route);
			state.savedRoutes = [savedRoute, ...state.savedRoutes];
			state.syncError = null;
			yield* this.persistSavedRoutesEffect(state);
			yield* this.syncSavedRouteEffect(state, savedRoute);

			return savedRoute;
		});
	}

	upsertSavedRoute(
		state: SavedRoutesStateModel,
		route: PlannedRoute,
		id?: string,
	): Effect.Effect<SavedRoute> {
		return Effect.gen({ self: this }, function* () {
			yield* this.initSavedRoutes(state);

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
			yield* this.persistSavedRoutesEffect(state);
			yield* this.syncSavedRouteEffect(state, savedRoute);

			return savedRoute;
		});
	}

	getSavedRouteById(
		state: SavedRoutesStateModel,
		id: string | null | undefined,
	): Effect.Effect<SavedRoute | null> {
		return Effect.gen({ self: this }, function* () {
			if (!id) {
				return null;
			}

			yield* this.initSavedRoutes(state);

			const savedRoute = state.savedRoutes.find((route) => route.id === id);

			return savedRoute ? cloneSavedRoute(savedRoute) : null;
		});
	}

	deleteSavedRoute(
		state: SavedRoutesStateModel,
		id: string,
	): Effect.Effect<boolean> {
		return Effect.gen({ self: this }, function* () {
			yield* this.initSavedRoutes(state);

			const nextSavedRoutes = state.savedRoutes.filter(
				(route) => route.id !== id,
			);

			if (nextSavedRoutes.length === state.savedRoutes.length) {
				return false;
			}

			state.savedRoutes = nextSavedRoutes;
			state.syncError = null;
			yield* this.persistSavedRoutesEffect(state);
			yield* this.deleteRemoteSavedRouteEffect(state, id);

			return true;
		});
	}

	reset(state: SavedRoutesStateModel): Effect.Effect<void> {
		return Effect.sync(() => {
			this.bumpRemoteSession();
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
		});
	}

	private persistSavedRoutesEffect(
		state: SavedRoutesStateModel,
	): Effect.Effect<void> {
		return Effect.sync(() => {
			if (state.authStatus === "signedIn" && state.authUserId) {
				this.repository.writeUserRoutes(state.authUserId, state.savedRoutes);
				return;
			}

			this.repository.writeAnonymousRoutes(state.savedRoutes);
		});
	}

	private trackPendingRemoteRouteEffect(
		state: SavedRoutesStateModel,
		routeId: string,
	): Effect.Effect<void> {
		return Effect.sync(() => {
			state.pendingRemoteRouteIds = new Set([
				...state.pendingRemoteRouteIds,
				routeId,
			]);
		});
	}

	private clearPendingRemoteRouteEffect(
		state: SavedRoutesStateModel,
		routeId: string,
	): Effect.Effect<void> {
		return Effect.sync(() => {
			const nextPendingRouteIds = new Set(state.pendingRemoteRouteIds);
			nextPendingRouteIds.delete(routeId);
			state.pendingRemoteRouteIds = nextPendingRouteIds;
		});
	}

	private setRemoteFailureEffect(
		state: SavedRoutesStateModel,
		routeId: string,
		message: string,
	): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			yield* this.clearPendingRemoteRouteEffect(state, routeId);
			state.syncError = message;
		});
	}

	private syncSavedRouteEffect(
		state: SavedRoutesStateModel,
		savedRoute: SavedRoute,
	): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			if (state.authStatus !== "signedIn" || !this.remoteRepository) {
				return;
			}

			const remoteRepository = this.remoteRepository;
			const userId = state.authUserId;
			const sessionVersion = this.remoteSessionVersion;
			yield* this.trackPendingRemoteRouteEffect(state, savedRoute.id);
			yield* this.forkBackgroundEffect(() =>
				Effect.tryPromise({
					try: () =>
						remoteRepository.save(serializeSavedRouteForRemote(savedRoute)),
					catch: (cause) => cause,
				}).pipe(
					Effect.flatMap(() =>
						this.isCurrentRemoteSession(state, userId, sessionVersion)
							? this.clearPendingRemoteRouteEffect(state, savedRoute.id).pipe(
									Effect.andThen(() =>
										Effect.sync(() => {
											state.syncError = null;
										}),
									),
								)
							: Effect.void,
					),
					Effect.catch((error) =>
						this.isCurrentRemoteSession(state, userId, sessionVersion)
							? this.setRemoteFailureEffect(
									state,
									savedRoute.id,
									error instanceof Error
										? `Could not sync saved route: ${error.message}`
										: "Could not sync saved route.",
								)
							: Effect.void,
					),
				),
			);
		});
	}

	private deleteRemoteSavedRouteEffect(
		state: SavedRoutesStateModel,
		routeId: string,
	): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			if (state.authStatus !== "signedIn" || !this.remoteRepository) {
				return;
			}

			const remoteRepository = this.remoteRepository;
			const userId = state.authUserId;
			const sessionVersion = this.remoteSessionVersion;
			yield* this.trackPendingRemoteRouteEffect(state, routeId);
			yield* this.forkBackgroundEffect(() =>
				Effect.tryPromise({
					try: () => remoteRepository.delete(routeId),
					catch: (cause) => cause,
				}).pipe(
					Effect.flatMap(() =>
						this.isCurrentRemoteSession(state, userId, sessionVersion)
							? this.clearPendingRemoteRouteEffect(state, routeId).pipe(
									Effect.andThen(() =>
										Effect.sync(() => {
											state.syncError = null;
										}),
									),
								)
							: Effect.void,
					),
					Effect.catch((error) =>
						this.isCurrentRemoteSession(state, userId, sessionVersion)
							? this.setRemoteFailureEffect(
									state,
									routeId,
									error instanceof Error
										? `Could not delete synced route: ${error.message}`
										: "Could not delete synced route.",
								)
							: Effect.void,
					),
				),
			);
		});
	}

	private forkBackgroundEffect(
		createEffect: () => Effect.Effect<void>,
	): Effect.Effect<void> {
		return Effect.sync(() => {
			void Effect.runPromise(createEffect());
		});
	}

	private bumpRemoteSession() {
		this.remoteSessionVersion += 1;
		this.inFlightMerges.clear();
	}

	private isCurrentRemoteSession(
		state: SavedRoutesStateModel,
		userId: string | null,
		sessionVersion: number,
	) {
		return (
			this.remoteSessionVersion === sessionVersion &&
			state.authStatus === "signedIn" &&
			state.authUserId === userId
		);
	}
}
