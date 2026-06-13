import type { PlannedRoute } from "$lib/route-planning";
import type {
	SavedRouteScope,
	SavedRoutesRepository,
} from "$lib/saved-routes/saved-routes-repository";
import {
	dedupeSavedRoutesById,
	SavedRoutesRepositoryError,
} from "$lib/saved-routes/saved-routes-repository";
import {
	buildSavedRoute,
	buildSavedRouteVersion,
	cloneSavedRoute,
	normalizeSavedRouteVersions,
	normalizeRemoteSavedRoutes,
	serializeSavedRouteForRemote,
	type RemoteSavedRoutePayload,
	type RemoteSavedRouteVersionPayload,
	type SavedRoute,
	type SavedRouteVersion,
} from "$lib/saved-routes-core";
import {
	fromRemoteAdapter,
	haveRoutePayloadsChanged,
	sortSavedRouteVersionsNewestFirst,
	toSavedRoutesOperationError,
} from "$lib/saved-routes/saved-routes-use-case-helpers";
import { Effect } from "effect";

export type SavedRoutesAuthStatus = "loading" | "signedOut" | "signedIn";

export type SavedRoutesRemoteRepository = {
	save: (savedRoute: RemoteSavedRoutePayload) => Effect.Effect<void, Error>;
	delete: (routeId: string) => Effect.Effect<void, Error>;
	listVersions?: (
		routeId: string,
	) => Effect.Effect<RemoteSavedRouteVersionPayload[] | unknown[], Error>;
	mergeLocalRoutes: (routes: RemoteSavedRoutePayload[]) => Effect.Effect<
		{
			inserted: number;
			skipped: number;
			invalid: number;
			duplicate: number;
		},
		Error
	>;
};

export type SavedRoutesStateModel = {
	initialized: boolean;
	savedRoutes: SavedRoute[];
	authStatus: SavedRoutesAuthStatus;
	authUserId: string | null;
	remoteReady: boolean;
	syncError: string | null;
	localRoutesReady: boolean;
	localSaveError: string | null;
	pendingRemoteRouteIds: Set<string>;
};

export class SavedRoutesUseCases {
	private remoteRepository: SavedRoutesRemoteRepository | null = null;
	private readonly inFlightMerges = new Map<string, Effect.Effect<void>>();
	private pendingRemoteSaves = new Map<string, SavedRoute>();
	private remoteSaveFlushTimer: ReturnType<typeof setTimeout> | null = null;
	private remoteSessionVersion = 0;
	private readonly remoteRouteOperations = new Map<
		string,
		{ kind: "save" | "delete"; revision: number }
	>();

	constructor(private readonly repository: SavedRoutesRepository) {}

	initSavedRoutes(state: SavedRoutesStateModel): Effect.Effect<SavedRoute[]> {
		return Effect.gen({ self: this }, function* () {
			if (state.initialized) {
				return state.savedRoutes;
			}

			yield* this.repository.init().pipe(Effect.catch(() => Effect.void));
			state.initialized = true;
			state.localRoutesReady = true;
			state.savedRoutes =
				state.authStatus === "signedIn" && state.authUserId
					? yield* this.readRoutesEffect({
							kind: "user",
							userId: state.authUserId,
						})
					: yield* this.readRoutesEffect({ kind: "anonymous" });

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
				state.savedRoutes = yield* this.readRoutesEffect({ kind: "anonymous" });
				state.syncError = null;
				return;
			}

			if (state.authUserId !== userId || state.authStatus !== "signedIn") {
				this.bumpRemoteSession();
				yield* this.setRemoteRepository(null);
				state.savedRoutes = yield* this.readRoutesEffect({
					kind: "user",
					userId,
				});
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
		return Effect.gen({ self: this }, function* () {
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
			yield* this.persistRoutesEffect(
				state,
				{ kind: "user", userId },
				mergedSavedRoutes,
			);
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
				const anonymousRoutes = yield* this.readRoutesEffect({
					kind: "anonymous",
				});
				if (anonymousRoutes.length > 0) {
					state.savedRoutes = anonymousRoutes;
					yield* this.persistRoutesEffect(
						state,
						{ kind: "user", userId: state.authUserId },
						anonymousRoutes,
					);
					yield* this.persistRoutesEffect(state, { kind: "anonymous" }, []);
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
				yield* inFlightMerge;
				return;
			}

			const remoteRepository = this.remoteRepository;
			const sessionVersion = this.remoteSessionVersion;
			const mergeEffect = Effect.gen({ self: this }, function* () {
				const migratedUserIds = yield* this.repository
					.readMergedUserIds()
					.pipe(Effect.catch(() => Effect.succeed(new Set<string>())));
				if (migratedUserIds.has(userId)) {
					return;
				}

				const localRoutes = dedupeSavedRoutesById(
					yield* this.readRoutesEffect({ kind: "anonymous" }),
				);
				if (localRoutes.length === 0) {
					migratedUserIds.add(userId);
					yield* this.repository
						.writeMergedUserIds(migratedUserIds)
						.pipe(Effect.catch(() => Effect.void));
					return;
				}

				let mergeFailed = false;
				yield* fromRemoteAdapter(
					remoteRepository.mergeLocalRoutes(
						localRoutes.map(serializeSavedRouteForRemote),
					),
				).pipe(
					Effect.mapError((cause) =>
						toSavedRoutesOperationError(
							cause,
							"Could not merge local saved routes.",
						),
					),
					Effect.catch((error) =>
						Effect.sync(() => {
							if (!this.isCurrentRemoteSession(state, userId, sessionVersion)) {
								return;
							}

							mergeFailed = true;
							state.syncError = `Could not sync local routes: ${error.message}`;
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
				yield* this.repository
					.writeMergedUserIds(migratedUserIds)
					.pipe(Effect.catch(() => Effect.void));
				state.syncError = null;
			});
			const cachedMerge = Effect.runSync(Effect.cached(mergeEffect));
			const trackedMerge = cachedMerge.pipe(
				Effect.ensuring(
					Effect.sync(() => {
						if (
							this.isCurrentRemoteSession(state, userId, sessionVersion) &&
							this.inFlightMerges.get(userId) === trackedMerge
						) {
							this.inFlightMerges.delete(userId);
						}
					}),
				),
			);

			this.inFlightMerges.set(userId, trackedMerge);
			yield* trackedMerge;
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
			yield* this.persistRouteEffect(state, savedRoute);
			yield* this.syncSavedRouteEffect(state, savedRoute, "soon");

			return savedRoute;
		});
	}

	upsertSavedRoute(
		state: SavedRoutesStateModel,
		route: PlannedRoute,
		id?: string,
		options: { source?: "autosave" | "explicit" | "share" } = {},
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
				cloneRoute: false,
			});
			const routeChanged =
				!!existingRoute &&
				this.haveRoutePayloadsChanged(existingRoute, savedRoute);

			state.savedRoutes = existingRoute
				? state.savedRoutes.map((entry) =>
						entry.id === existingRoute.id ? savedRoute : entry,
					)
				: [savedRoute, ...state.savedRoutes];
			state.syncError = null;
			if (existingRoute && routeChanged) {
				yield* this.persistRouteVersionEffect(
					state,
					buildSavedRouteVersion(existingRoute),
				);
			}
			yield* this.persistRouteEffect(state, savedRoute);
			yield* this.syncSavedRouteEffect(
				state,
				savedRoute,
				options.source === "autosave" ? "deferred" : "soon",
			);

			return savedRoute;
		});
	}

	listSavedRouteVersions(
		state: SavedRoutesStateModel,
		routeId: string,
	): Effect.Effect<SavedRouteVersion[]> {
		return Effect.gen({ self: this }, function* () {
			yield* this.initSavedRoutes(state);
			yield* this.refreshRemoteRouteVersionsEffect(state, routeId);
			const versions = yield* this.readRouteVersionsEffect(
				this.getLocalScope(state),
				routeId,
			);
			return sortSavedRouteVersionsNewestFirst(versions);
		});
	}

	restoreLatestSavedRouteVersion(
		state: SavedRoutesStateModel,
		id: string,
	): Effect.Effect<
		| { restored: true; savedRoute: SavedRoute }
		| { restored: false; reason: "not_found" | "no_version" }
	> {
		return Effect.gen({ self: this }, function* () {
			yield* this.initSavedRoutes(state);

			const currentRoute = state.savedRoutes.find((route) => route.id === id);
			if (!currentRoute) {
				return { restored: false, reason: "not_found" } as const;
			}

			const scope = this.getLocalScope(state);
			yield* this.refreshRemoteRouteVersionsEffect(state, id);
			const versions = sortSavedRouteVersionsNewestFirst(
				yield* this.readRouteVersionsEffect(scope, id),
			);
			const latestVersion = versions[0];

			if (!latestVersion) {
				return { restored: false, reason: "no_version" } as const;
			}

			const restoredRoute: SavedRoute = {
				...currentRoute,
				route: latestVersion.savedRoute.route,
			};
			const currentVersion = buildSavedRouteVersion(currentRoute);

			state.savedRoutes = state.savedRoutes.map((entry) =>
				entry.id === id ? restoredRoute : entry,
			);
			state.syncError = null;
			yield* this.persistRouteVersionEffect(state, currentVersion);
			yield* this.persistRouteEffect(state, restoredRoute);
			yield* this.syncSavedRouteEffect(state, restoredRoute, "soon");

			return {
				restored: true,
				savedRoute: cloneSavedRoute(restoredRoute),
			} as const;
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
			yield* this.deleteLocalRouteEffect(state, id);
			yield* this.deleteRemoteSavedRouteEffect(state, id);

			return true;
		});
	}

	reset(state: SavedRoutesStateModel): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			this.bumpRemoteSession();
			state.initialized = false;
			state.savedRoutes = [];
			state.authStatus = "signedOut";
			state.authUserId = null;
			state.remoteReady = false;
			state.syncError = null;
			state.localRoutesReady = false;
			state.localSaveError = null;
			state.pendingRemoteRouteIds = new Set();
			this.remoteRepository = null;
			this.inFlightMerges.clear();
			this.pendingRemoteSaves.clear();
			if (this.remoteSaveFlushTimer) {
				clearTimeout(this.remoteSaveFlushTimer);
				this.remoteSaveFlushTimer = null;
			}
			yield* this.repository.clear().pipe(Effect.catch(() => Effect.void));
		});
	}

	private getLocalScope(state: SavedRoutesStateModel): SavedRouteScope {
		return state.authStatus === "signedIn" && state.authUserId
			? { kind: "user", userId: state.authUserId }
			: { kind: "anonymous" };
	}

	private readRoutesEffect(
		scope: SavedRouteScope,
	): Effect.Effect<SavedRoute[]> {
		return this.repository
			.readRoutes(scope)
			.pipe(Effect.catch(() => Effect.succeed([])));
	}

	private readRouteVersionsEffect(
		scope: SavedRouteScope,
		routeId: string,
	): Effect.Effect<SavedRouteVersion[]> {
		return this.repository
			.readRouteVersions(scope, routeId)
			.pipe(Effect.catch(() => Effect.succeed([])));
	}

	private persistRoutesEffect(
		state: SavedRoutesStateModel,
		scope: SavedRouteScope,
		routes: SavedRoute[],
	): Effect.Effect<void> {
		return this.repository.replaceRoutes(scope, routes).pipe(
			Effect.andThen(() =>
				Effect.sync(() => {
					state.localSaveError = null;
				}),
			),
			Effect.catch((error) =>
				Effect.sync(() => {
					state.localSaveError = this.getLocalSaveErrorMessage(error);
				}),
			),
		);
	}

	private persistRouteEffect(
		state: SavedRoutesStateModel,
		savedRoute: SavedRoute,
	): Effect.Effect<void> {
		const scope = this.getLocalScope(state);
		return this.repository.upsertRoute(scope, savedRoute).pipe(
			Effect.andThen(() =>
				Effect.sync(() => {
					state.localSaveError = null;
				}),
			),
			Effect.catch((error) =>
				Effect.sync(() => {
					state.localSaveError = this.getLocalSaveErrorMessage(error);
				}),
			),
		);
	}

	private persistRouteVersionEffect(
		state: SavedRoutesStateModel,
		version: SavedRouteVersion,
	): Effect.Effect<void> {
		const scope = this.getLocalScope(state);
		return this.repository.addRouteVersion(scope, version).pipe(
			Effect.andThen(() =>
				Effect.sync(() => {
					state.localSaveError = null;
				}),
			),
			Effect.catch((error) =>
				Effect.sync(() => {
					state.localSaveError = this.getLocalSaveErrorMessage(error);
				}),
			),
		);
	}

	private refreshRemoteRouteVersionsEffect(
		state: SavedRoutesStateModel,
		routeId: string,
	): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			if (
				state.authStatus !== "signedIn" ||
				!state.authUserId ||
				!this.remoteRepository?.listVersions
			) {
				return;
			}

			const userId = state.authUserId;
			const sessionVersion = this.remoteSessionVersion;
			const remoteRepository = this.remoteRepository;
			const versions = yield* fromRemoteAdapter(
				remoteRepository.listVersions?.(routeId) ?? [],
			).pipe(
				Effect.mapError((cause) =>
					toSavedRoutesOperationError(
						cause,
						"Could not load remote route versions.",
					),
				),
				Effect.catch((error) =>
					Effect.sync(() => {
						if (this.isCurrentRemoteSession(state, userId, sessionVersion)) {
							state.syncError = `Could not load previous versions: ${error.message}`;
						}
						return null;
					}),
				),
			);

			if (
				!versions ||
				!this.isCurrentRemoteSession(state, userId, sessionVersion)
			) {
				return;
			}

			const normalizedVersions = normalizeSavedRouteVersions(versions);
			const localVersions = yield* this.readRouteVersionsEffect(
				{ kind: "user", userId },
				routeId,
			);
			const mergedVersionsById = new Map(
				localVersions.map((version) => [version.versionId, version]),
			);
			for (const version of normalizedVersions) {
				mergedVersionsById.set(version.versionId, version);
			}
			const mergedVersions = sortSavedRouteVersionsNewestFirst([
				...mergedVersionsById.values(),
			]);
			yield* this.repository
				.replaceRouteVersions({ kind: "user", userId }, routeId, mergedVersions)
				.pipe(Effect.catch(() => Effect.void));
		});
	}

	private deleteLocalRouteEffect(
		state: SavedRoutesStateModel,
		routeId: string,
	): Effect.Effect<void> {
		const scope = this.getLocalScope(state);
		return this.repository.deleteRoute(scope, routeId).pipe(
			Effect.andThen(() =>
				Effect.sync(() => {
					state.localSaveError = null;
				}),
			),
			Effect.catch((error) =>
				Effect.sync(() => {
					state.localSaveError = this.getLocalSaveErrorMessage(error);
				}),
			),
		);
	}

	private haveRoutePayloadsChanged(left: SavedRoute, right: SavedRoute) {
		return haveRoutePayloadsChanged(left, right);
	}

	private getLocalSaveErrorMessage(error: unknown) {
		const cause =
			error instanceof SavedRoutesRepositoryError ? error.cause : error;
		return cause instanceof Error
			? `Could not save route locally: ${cause.message}`
			: "Could not save route locally.";
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

	private setRemoteSaveFailureEffect(
		state: SavedRoutesStateModel,
		routeId: string,
		message: string,
	): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			yield* this.trackPendingRemoteRouteEffect(state, routeId);
			state.syncError = message;
		});
	}

	private syncSavedRouteEffect(
		state: SavedRoutesStateModel,
		savedRoute: SavedRoute,
		flushMode: "deferred" | "soon" = "deferred",
	): Effect.Effect<void> {
		return Effect.sync(() => {
			if (state.authStatus !== "signedIn" || !this.remoteRepository) {
				return;
			}

			const userId = state.authUserId;
			const sessionVersion = this.remoteSessionVersion;
			state.pendingRemoteRouteIds = new Set([
				...state.pendingRemoteRouteIds,
				savedRoute.id,
			]);
			this.advanceRemoteRouteOperation(savedRoute.id, "save");
			this.pendingRemoteSaves.set(savedRoute.id, savedRoute);
			this.scheduleRemoteSaveFlush(state, userId, sessionVersion, flushMode);
		});
	}

	private scheduleRemoteSaveFlush(
		state: SavedRoutesStateModel,
		userId: string | null,
		sessionVersion: number,
		flushMode: "deferred" | "soon",
	) {
		if (this.remoteSaveFlushTimer) {
			clearTimeout(this.remoteSaveFlushTimer);
		}

		const timer = setTimeout(
			() => {
				this.remoteSaveFlushTimer = null;
				void Effect.runPromise(
					this.flushRemoteSavesEffect(state, userId, sessionVersion),
				);
			},
			flushMode === "soon" ? 0 : 1000,
		);
		if (typeof timer === "object" && timer !== null && "unref" in timer) {
			(timer as { unref?: () => void }).unref?.();
		}
		this.remoteSaveFlushTimer = timer;
	}

	private flushRemoteSavesEffect(
		state: SavedRoutesStateModel,
		userId: string | null,
		sessionVersion: number,
	): Effect.Effect<void> {
		return Effect.gen({ self: this }, function* () {
			const remoteRepository = this.remoteRepository;
			if (
				!remoteRepository ||
				!this.isCurrentRemoteSession(state, userId, sessionVersion)
			) {
				return;
			}

			const pendingSaves = [...this.pendingRemoteSaves.values()];

			for (const savedRoute of pendingSaves) {
				const saveOperation = this.remoteRouteOperations.get(savedRoute.id);
				if (
					this.pendingRemoteSaves.get(savedRoute.id) !== savedRoute ||
					saveOperation?.kind !== "save"
				) {
					continue;
				}
				const saveRevision = saveOperation.revision;

				yield* fromRemoteAdapter(
					remoteRepository.save(serializeSavedRouteForRemote(savedRoute)),
				).pipe(
					Effect.mapError((cause) =>
						toSavedRoutesOperationError(cause, "Could not sync saved route."),
					),
					Effect.flatMap(() =>
						this.isCurrentRemoteSession(state, userId, sessionVersion) &&
						this.isCurrentRemoteRouteOperation(
							savedRoute.id,
							"save",
							saveRevision,
						)
							? Effect.sync(() => {
									if (
										this.pendingRemoteSaves.get(savedRoute.id) !== savedRoute
									) {
										return false;
									}

									this.pendingRemoteSaves.delete(savedRoute.id);
									return true;
								}).pipe(
									Effect.flatMap((clearedCurrentSave) =>
										clearedCurrentSave
											? this.clearPendingRemoteRouteEffect(
													state,
													savedRoute.id,
												).pipe(
													Effect.andThen(() =>
														Effect.sync(() => {
															state.syncError = null;
														}),
													),
												)
											: Effect.void,
									),
								)
							: Effect.void,
					),
					Effect.catch((error) =>
						this.isCurrentRemoteSession(state, userId, sessionVersion) &&
						this.isCurrentRemoteRouteOperation(
							savedRoute.id,
							"save",
							saveRevision,
						)
							? Effect.sync(
									() =>
										this.pendingRemoteSaves.get(savedRoute.id) === savedRoute,
								).pipe(
									Effect.flatMap((isCurrentSave) =>
										isCurrentSave
											? this.setRemoteSaveFailureEffect(
													state,
													savedRoute.id,
													`Could not sync saved route: ${error.message}`,
												).pipe(
													Effect.andThen(() =>
														Effect.sync(() => {
															this.scheduleRemoteSaveFlush(
																state,
																userId,
																sessionVersion,
																"deferred",
															);
														}),
													),
												)
											: Effect.void,
									),
								)
							: Effect.void,
					),
				);
			}
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
			const deleteRevision = this.advanceRemoteRouteOperation(
				routeId,
				"delete",
			);
			this.pendingRemoteSaves.delete(routeId);
			yield* this.trackPendingRemoteRouteEffect(state, routeId);
			yield* this.forkBackgroundEffect(() =>
				fromRemoteAdapter(remoteRepository.delete(routeId)).pipe(
					Effect.mapError((cause) =>
						toSavedRoutesOperationError(
							cause,
							"Could not delete synced route.",
						),
					),
					Effect.flatMap(() =>
						this.isCurrentRemoteSession(state, userId, sessionVersion) &&
						this.isCurrentRemoteRouteOperation(
							routeId,
							"delete",
							deleteRevision,
						)
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
						this.isCurrentRemoteSession(state, userId, sessionVersion) &&
						this.isCurrentRemoteRouteOperation(
							routeId,
							"delete",
							deleteRevision,
						)
							? this.setRemoteFailureEffect(
									state,
									routeId,
									`Could not delete synced route: ${error.message}`,
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
		this.pendingRemoteSaves.clear();
		this.remoteRouteOperations.clear();
		if (this.remoteSaveFlushTimer) {
			clearTimeout(this.remoteSaveFlushTimer);
			this.remoteSaveFlushTimer = null;
		}
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

	private advanceRemoteRouteOperation(
		routeId: string,
		kind: "save" | "delete",
	) {
		const revision =
			(this.remoteRouteOperations.get(routeId)?.revision ?? 0) + 1;
		this.remoteRouteOperations.set(routeId, { kind, revision });
		return revision;
	}

	private isCurrentRemoteRouteOperation(
		routeId: string,
		kind: "save" | "delete",
		revision: number,
	) {
		const operation = this.remoteRouteOperations.get(routeId);
		return operation?.kind === kind && operation.revision === revision;
	}
}
