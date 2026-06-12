import {
	normalizeSavedRouteVersions,
	normalizeSavedRoutes,
	parseSavedRoutes,
	SAVED_ROUTES_STORAGE_KEY,
	type SavedRoute,
	type SavedRouteVersion,
} from "$lib/saved-routes-core";
import {
	getLegacyUserStorageKeys,
	getSyncedRoutesStorageKey,
	getUserIdFromSyncedRoutesStorageKey,
	readMergedUserIds,
	SYNCED_MIGRATIONS_STORAGE_KEY,
	writeMergedUserIds,
} from "$lib/saved-routes/saved-routes-repository-storage";
import type { BrowserStorage } from "$lib/storage/browser-storage";
import { Data, Effect } from "effect";

export { getSyncedRoutesStorageKey, SYNCED_MIGRATIONS_STORAGE_KEY };

const SAVED_ROUTES_DB_NAME = "velix.savedRoutes";
const SAVED_ROUTES_DB_VERSION = 2;
const SAVED_ROUTES_STORE_NAME = "routes";
const SAVED_ROUTE_VERSIONS_STORE_NAME = "versions";
const SAVED_ROUTES_SCOPE_INDEX = "scope";
const SAVED_ROUTE_VERSIONS_SCOPE_ROUTE_INDEX = "scopeRoute";
export const SAVED_ROUTE_VERSION_LIMIT = 10;

export type SavedRouteScope =
	| { kind: "anonymous" }
	| { kind: "user"; userId: string };

export type SavedRouteIndexedDbRow = {
	storageKey: string;
	scope: "anonymous" | `user:${string}`;
	routeId: string;
	createdAt: string;
	savedRoute: SavedRoute;
	updatedAtMs: number;
};

export type SavedRouteVersionIndexedDbRow = {
	storageKey: string;
	scope: "anonymous" | `user:${string}`;
	routeId: string;
	scopeRoute: ["anonymous" | `user:${string}`, string];
	versionId: string;
	capturedAt: string;
	savedRouteVersion: SavedRouteVersion;
	updatedAtMs: number;
};

export type SavedRoutesRepository = {
	init: () => Effect.Effect<void, SavedRoutesRepositoryError>;
	readRoutes: (
		scope: SavedRouteScope,
	) => Effect.Effect<SavedRoute[], SavedRoutesRepositoryError>;
	replaceRoutes: (
		scope: SavedRouteScope,
		savedRoutes: SavedRoute[],
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	upsertRoute: (
		scope: SavedRouteScope,
		savedRoute: SavedRoute,
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	deleteRoute: (
		scope: SavedRouteScope,
		routeId: string,
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	readRouteVersions: (
		scope: SavedRouteScope,
		routeId: string,
	) => Effect.Effect<SavedRouteVersion[], SavedRoutesRepositoryError>;
	replaceRouteVersions: (
		scope: SavedRouteScope,
		routeId: string,
		versions: SavedRouteVersion[],
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	addRouteVersion: (
		scope: SavedRouteScope,
		version: SavedRouteVersion,
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	deleteRouteVersions: (
		scope: SavedRouteScope,
		routeId: string,
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	readMergedUserIds: () => Effect.Effect<
		Set<string>,
		SavedRoutesRepositoryError
	>;
	writeMergedUserIds: (
		userIds: Set<string>,
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	clear: () => Effect.Effect<void, SavedRoutesRepositoryError>;
};

type SavedRoutesRepositoryOperation =
	| "open"
	| "init"
	| "migrateLegacyRoutes"
	| "readRoutes"
	| "replaceRoutes"
	| "upsertRoute"
	| "deleteRoute"
	| "readRouteVersions"
	| "replaceRouteVersions"
	| "addRouteVersion"
	| "deleteRouteVersions"
	| "readMergedUserIds"
	| "writeMergedUserIds"
	| "clear";

export class SavedRoutesRepositoryError extends Data.TaggedError(
	"SavedRoutesRepositoryError",
)<{
	readonly operation: SavedRoutesRepositoryOperation;
	readonly cause: unknown;
}> {}

function repositoryError(
	operation: SavedRoutesRepositoryOperation,
	cause: unknown,
) {
	return new SavedRoutesRepositoryError({ operation, cause });
}

export function dedupeSavedRoutesById(savedRoutes: SavedRoute[]): SavedRoute[] {
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

export function getSavedRouteScopeKey(scope: SavedRouteScope) {
	return scope.kind === "anonymous"
		? "anonymous"
		: (`user:${scope.userId}` as const);
}

function getSavedRouteStorageKey(scope: SavedRouteScope, routeId: string) {
	return `${getSavedRouteScopeKey(scope)}:${routeId}`;
}

function getSavedRouteVersionStorageKey(
	scope: SavedRouteScope,
	routeId: string,
	versionId: string,
) {
	return `${getSavedRouteStorageKey(scope, routeId)}:${versionId}`;
}

function sortSavedRoutes(savedRoutes: SavedRoute[]) {
	return savedRoutes.toSorted(
		(left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
	);
}

function sortSavedRouteVersions(versions: SavedRouteVersion[]) {
	return versions.toSorted(
		(left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt),
	);
}

function normalizeRows(rows: SavedRouteIndexedDbRow[]) {
	return sortSavedRoutes(
		normalizeSavedRoutes(rows.map((row) => row.savedRoute)),
	);
}

function normalizeVersionRows(rows: SavedRouteVersionIndexedDbRow[]) {
	return sortSavedRouteVersions(
		normalizeSavedRouteVersions(rows.map((row) => row.savedRouteVersion)),
	);
}

function normalizeRouteScopedVersions(
	routeId: string,
	versions: SavedRouteVersion[],
) {
	return sortSavedRouteVersions(
		versions.map((version) => ({
			...version,
			routeId,
			savedRoute: {
				...version.savedRoute,
				id: routeId,
			},
		})),
	).slice(0, SAVED_ROUTE_VERSION_LIMIT);
}

function toRow(
	scope: SavedRouteScope,
	savedRoute: SavedRoute,
): SavedRouteIndexedDbRow {
	return {
		storageKey: getSavedRouteStorageKey(scope, savedRoute.id),
		scope: getSavedRouteScopeKey(scope),
		routeId: savedRoute.id,
		createdAt: savedRoute.createdAt,
		savedRoute,
		updatedAtMs: Date.now(),
	};
}

function toVersionRow(
	scope: SavedRouteScope,
	version: SavedRouteVersion,
): SavedRouteVersionIndexedDbRow {
	const scopeKey = getSavedRouteScopeKey(scope);
	return {
		storageKey: getSavedRouteVersionStorageKey(
			scope,
			version.routeId,
			version.versionId,
		),
		scope: scopeKey,
		routeId: version.routeId,
		scopeRoute: [scopeKey, version.routeId],
		versionId: version.versionId,
		capturedAt: version.capturedAt,
		savedRouteVersion: version,
		updatedAtMs: Date.now(),
	};
}

function getIdbRequestError<T>(request: IDBRequest<T>) {
	return request.error ?? new Error("IndexedDB request failed.");
}

function getIdbTransactionError(transaction: IDBTransaction) {
	return transaction.error ?? new Error("IndexedDB transaction failed.");
}

function requestToEffect<T>(
	operation: SavedRoutesRepositoryOperation,
	request: IDBRequest<T>,
) {
	return Effect.callback<T, SavedRoutesRepositoryError>((resume) => {
		request.onsuccess = () => resume(Effect.succeed(request.result));
		request.onerror = () =>
			resume(
				Effect.fail(repositoryError(operation, getIdbRequestError(request))),
			);
	});
}

function transactionDoneEffect(
	operation: SavedRoutesRepositoryOperation,
	transaction: IDBTransaction,
) {
	return Effect.callback<void, SavedRoutesRepositoryError>((resume) => {
		transaction.oncomplete = () => resume(Effect.void);
		transaction.onabort = () =>
			resume(
				Effect.fail(
					repositoryError(operation, getIdbTransactionError(transaction)),
				),
			);
		transaction.onerror = () =>
			resume(
				Effect.fail(
					repositoryError(operation, getIdbTransactionError(transaction)),
				),
			);
	});
}

function openSavedRoutesDb() {
	if (!globalThis.indexedDB) {
		return Effect.fail(
			repositoryError("open", new Error("IndexedDB is unavailable.")),
		);
	}

	return Effect.callback<IDBDatabase, SavedRoutesRepositoryError>((resume) => {
		const request = indexedDB.open(
			SAVED_ROUTES_DB_NAME,
			SAVED_ROUTES_DB_VERSION,
		);

		request.onupgradeneeded = () => {
			const db = request.result;
			const store = db.objectStoreNames.contains(SAVED_ROUTES_STORE_NAME)
				? request.transaction?.objectStore(SAVED_ROUTES_STORE_NAME)
				: db.createObjectStore(SAVED_ROUTES_STORE_NAME, {
						keyPath: "storageKey",
					});

			if (store && !store.indexNames.contains(SAVED_ROUTES_SCOPE_INDEX)) {
				store.createIndex(SAVED_ROUTES_SCOPE_INDEX, "scope", { unique: false });
			}

			const versionStore = db.objectStoreNames.contains(
				SAVED_ROUTE_VERSIONS_STORE_NAME,
			)
				? request.transaction?.objectStore(SAVED_ROUTE_VERSIONS_STORE_NAME)
				: db.createObjectStore(SAVED_ROUTE_VERSIONS_STORE_NAME, {
						keyPath: "storageKey",
					});

			if (
				versionStore &&
				!versionStore.indexNames.contains(
					SAVED_ROUTE_VERSIONS_SCOPE_ROUTE_INDEX,
				)
			) {
				versionStore.createIndex(
					SAVED_ROUTE_VERSIONS_SCOPE_ROUTE_INDEX,
					"scopeRoute",
					{ unique: false },
				);
			}
		};
		request.onsuccess = () => resume(Effect.succeed(request.result));
		request.onerror = () =>
			resume(
				Effect.fail(
					repositoryError(
						"open",
						request.error ?? new Error("Could not open IndexedDB."),
					),
				),
			);
		request.onblocked = () =>
			resume(
				Effect.fail(
					repositoryError("open", new Error("IndexedDB open was blocked.")),
				),
			);
	});
}

function getRowsForScope(db: IDBDatabase, scope: SavedRouteScope) {
	return Effect.gen(function* () {
		const transaction = db.transaction(SAVED_ROUTES_STORE_NAME, "readonly");
		const done = transactionDoneEffect("readRoutes", transaction);
		const store = transaction.objectStore(SAVED_ROUTES_STORE_NAME);
		const index = store.index(SAVED_ROUTES_SCOPE_INDEX);
		const rows = yield* requestToEffect<SavedRouteIndexedDbRow[]>(
			"readRoutes",
			index.getAll(getSavedRouteScopeKey(scope)),
		);
		yield* done;
		return rows;
	});
}

function replaceScopeRows(
	db: IDBDatabase,
	scope: SavedRouteScope,
	savedRoutes: SavedRoute[],
) {
	return Effect.callback<void, SavedRoutesRepositoryError>((resume) => {
		const transaction = db.transaction(SAVED_ROUTES_STORE_NAME, "readwrite");
		const store = transaction.objectStore(SAVED_ROUTES_STORE_NAME);
		const index = store.index(SAVED_ROUTES_SCOPE_INDEX);
		const request = index.getAll(getSavedRouteScopeKey(scope));

		request.onsuccess = () => {
			for (const row of request.result) {
				store.delete(row.storageKey);
			}

			for (const savedRoute of savedRoutes) {
				store.put(toRow(scope, savedRoute));
			}
		};
		request.onerror = () =>
			resume(
				Effect.fail(
					repositoryError("replaceRoutes", getIdbRequestError(request)),
				),
			);
		transaction.oncomplete = () => resume(Effect.void);
		transaction.onabort = () =>
			resume(
				Effect.fail(
					repositoryError("replaceRoutes", getIdbTransactionError(transaction)),
				),
			);
		transaction.onerror = () =>
			resume(
				Effect.fail(
					repositoryError("replaceRoutes", getIdbTransactionError(transaction)),
				),
			);
	});
}

function getVersionRowsForRoute(
	db: IDBDatabase,
	scope: SavedRouteScope,
	routeId: string,
) {
	return Effect.gen(function* () {
		const transaction = db.transaction(
			SAVED_ROUTE_VERSIONS_STORE_NAME,
			"readonly",
		);
		const done = transactionDoneEffect("readRouteVersions", transaction);
		const store = transaction.objectStore(SAVED_ROUTE_VERSIONS_STORE_NAME);
		const index = store.index(SAVED_ROUTE_VERSIONS_SCOPE_ROUTE_INDEX);
		const rows = yield* requestToEffect<SavedRouteVersionIndexedDbRow[]>(
			"readRouteVersions",
			index.getAll([getSavedRouteScopeKey(scope), routeId]),
		);
		yield* done;
		return rows;
	});
}

function replaceVersionRowsForRoute(
	db: IDBDatabase,
	scope: SavedRouteScope,
	routeId: string,
	versions: SavedRouteVersion[],
) {
	return Effect.callback<void, SavedRoutesRepositoryError>((resume) => {
		const transaction = db.transaction(
			SAVED_ROUTE_VERSIONS_STORE_NAME,
			"readwrite",
		);
		const store = transaction.objectStore(SAVED_ROUTE_VERSIONS_STORE_NAME);
		const index = store.index(SAVED_ROUTE_VERSIONS_SCOPE_ROUTE_INDEX);
		const request = index.getAll([getSavedRouteScopeKey(scope), routeId]);

		request.onsuccess = () => {
			for (const row of request.result) {
				store.delete(row.storageKey);
			}

			for (const version of normalizeRouteScopedVersions(routeId, versions)) {
				store.put(toVersionRow(scope, version));
			}
		};
		request.onerror = () =>
			resume(
				Effect.fail(
					repositoryError("replaceRouteVersions", getIdbRequestError(request)),
				),
			);
		transaction.oncomplete = () => resume(Effect.void);
		transaction.onabort = () =>
			resume(
				Effect.fail(
					repositoryError(
						"replaceRouteVersions",
						getIdbTransactionError(transaction),
					),
				),
			);
		transaction.onerror = () =>
			resume(
				Effect.fail(
					repositoryError(
						"replaceRouteVersions",
						getIdbTransactionError(transaction),
					),
				),
			);
	});
}

type SavedRoutesDriver = {
	readRoutes: (
		scope: SavedRouteScope,
	) => Effect.Effect<SavedRoute[], SavedRoutesRepositoryError>;
	replaceRoutes: (
		scope: SavedRouteScope,
		savedRoutes: SavedRoute[],
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	upsertRoute: (
		scope: SavedRouteScope,
		savedRoute: SavedRoute,
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	deleteRoute: (
		scope: SavedRouteScope,
		routeId: string,
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	readRouteVersions: (
		scope: SavedRouteScope,
		routeId: string,
	) => Effect.Effect<SavedRouteVersion[], SavedRoutesRepositoryError>;
	replaceRouteVersions: (
		scope: SavedRouteScope,
		routeId: string,
		versions: SavedRouteVersion[],
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	addRouteVersion: (
		scope: SavedRouteScope,
		version: SavedRouteVersion,
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	deleteRouteVersions: (
		scope: SavedRouteScope,
		routeId: string,
	) => Effect.Effect<void, SavedRoutesRepositoryError>;
	clear: () => Effect.Effect<void, SavedRoutesRepositoryError>;
};

function createIndexedDbDriver(db: IDBDatabase): SavedRoutesDriver {
	return {
		readRoutes(scope: SavedRouteScope) {
			return getRowsForScope(db, scope).pipe(Effect.map(normalizeRows));
		},
		replaceRoutes(scope: SavedRouteScope, savedRoutes: SavedRoute[]) {
			return replaceScopeRows(db, scope, savedRoutes);
		},
		upsertRoute(scope: SavedRouteScope, savedRoute: SavedRoute) {
			return Effect.gen(function* () {
				const transaction = db.transaction(
					SAVED_ROUTES_STORE_NAME,
					"readwrite",
				);
				const done = transactionDoneEffect("upsertRoute", transaction);
				transaction
					.objectStore(SAVED_ROUTES_STORE_NAME)
					.put(toRow(scope, savedRoute));
				yield* done;
			});
		},
		deleteRoute(scope: SavedRouteScope, routeId: string) {
			return Effect.callback<void, SavedRoutesRepositoryError>((resume) => {
				const transaction = db.transaction(
					[SAVED_ROUTES_STORE_NAME, SAVED_ROUTE_VERSIONS_STORE_NAME],
					"readwrite",
				);
				transaction
					.objectStore(SAVED_ROUTES_STORE_NAME)
					.delete(getSavedRouteStorageKey(scope, routeId));
				const versionStore = transaction.objectStore(
					SAVED_ROUTE_VERSIONS_STORE_NAME,
				);
				const versionIndex = versionStore.index(
					SAVED_ROUTE_VERSIONS_SCOPE_ROUTE_INDEX,
				);
				const request = versionIndex.getAll([
					getSavedRouteScopeKey(scope),
					routeId,
				]);

				request.onsuccess = () => {
					for (const row of request.result) {
						versionStore.delete(row.storageKey);
					}
				};
				request.onerror = () =>
					resume(
						Effect.fail(
							repositoryError("deleteRoute", getIdbRequestError(request)),
						),
					);
				transaction.oncomplete = () => resume(Effect.void);
				transaction.onabort = () =>
					resume(
						Effect.fail(
							repositoryError(
								"deleteRoute",
								getIdbTransactionError(transaction),
							),
						),
					);
				transaction.onerror = () =>
					resume(
						Effect.fail(
							repositoryError(
								"deleteRoute",
								getIdbTransactionError(transaction),
							),
						),
					);
			});
		},
		readRouteVersions(scope: SavedRouteScope, routeId: string) {
			return getVersionRowsForRoute(db, scope, routeId).pipe(
				Effect.map(normalizeVersionRows),
			);
		},
		replaceRouteVersions(
			scope: SavedRouteScope,
			routeId: string,
			versions: SavedRouteVersion[],
		) {
			return replaceVersionRowsForRoute(db, scope, routeId, versions);
		},
		addRouteVersion(scope: SavedRouteScope, version: SavedRouteVersion) {
			return Effect.gen(function* () {
				const versions = normalizeVersionRows(
					yield* getVersionRowsForRoute(db, scope, version.routeId),
				);
				yield* replaceVersionRowsForRoute(db, scope, version.routeId, [
					version,
					...versions.filter((entry) => entry.versionId !== version.versionId),
				]);
			});
		},
		deleteRouteVersions(scope: SavedRouteScope, routeId: string) {
			return replaceVersionRowsForRoute(db, scope, routeId, []);
		},
		clear() {
			return Effect.gen(function* () {
				const transaction = db.transaction(
					[SAVED_ROUTES_STORE_NAME, SAVED_ROUTE_VERSIONS_STORE_NAME],
					"readwrite",
				);
				const done = transactionDoneEffect("clear", transaction);
				transaction.objectStore(SAVED_ROUTES_STORE_NAME).clear();
				transaction.objectStore(SAVED_ROUTE_VERSIONS_STORE_NAME).clear();
				yield* done;
			});
		},
	};
}

function createMemoryDriver(): SavedRoutesDriver {
	const rows = new Map<string, SavedRouteIndexedDbRow>();
	const versionRows = new Map<string, SavedRouteVersionIndexedDbRow>();
	const readRouteVersions = (scope: SavedRouteScope, routeId: string) =>
		Effect.sync(() =>
			normalizeVersionRows(
				[...versionRows.values()].filter(
					(row) =>
						row.scope === getSavedRouteScopeKey(scope) &&
						row.routeId === routeId,
				),
			),
		);
	const replaceRouteVersions = (
		scope: SavedRouteScope,
		routeId: string,
		versions: SavedRouteVersion[],
	) =>
		Effect.sync(() => {
			const scopeKey = getSavedRouteScopeKey(scope);
			for (const row of [...versionRows.values()]) {
				if (row.scope === scopeKey && row.routeId === routeId) {
					versionRows.delete(row.storageKey);
				}
			}
			for (const version of normalizeRouteScopedVersions(routeId, versions)) {
				const row = toVersionRow(scope, version);
				versionRows.set(row.storageKey, row);
			}
		});

	return {
		readRoutes(scope: SavedRouteScope) {
			return Effect.sync(() =>
				normalizeRows(
					[...rows.values()].filter(
						(row) => row.scope === getSavedRouteScopeKey(scope),
					),
				),
			);
		},
		replaceRoutes(scope: SavedRouteScope, savedRoutes: SavedRoute[]) {
			return Effect.sync(() => {
				const scopeKey = getSavedRouteScopeKey(scope);
				for (const row of [...rows.values()]) {
					if (row.scope === scopeKey) {
						rows.delete(row.storageKey);
					}
				}
				for (const savedRoute of savedRoutes) {
					const row = toRow(scope, savedRoute);
					rows.set(row.storageKey, row);
				}
			});
		},
		upsertRoute(scope: SavedRouteScope, savedRoute: SavedRoute) {
			return Effect.sync(() => {
				const row = toRow(scope, savedRoute);
				rows.set(row.storageKey, row);
			});
		},
		deleteRoute(scope: SavedRouteScope, routeId: string) {
			return Effect.sync(() => {
				rows.delete(getSavedRouteStorageKey(scope, routeId));
				for (const row of [...versionRows.values()]) {
					if (
						row.scope === getSavedRouteScopeKey(scope) &&
						row.routeId === routeId
					) {
						versionRows.delete(row.storageKey);
					}
				}
			});
		},
		readRouteVersions(scope: SavedRouteScope, routeId: string) {
			return readRouteVersions(scope, routeId);
		},
		replaceRouteVersions(
			scope: SavedRouteScope,
			routeId: string,
			versions: SavedRouteVersion[],
		) {
			return replaceRouteVersions(scope, routeId, versions);
		},
		addRouteVersion(scope: SavedRouteScope, version: SavedRouteVersion) {
			return Effect.gen(function* () {
				const versions = yield* readRouteVersions(scope, version.routeId);
				yield* replaceRouteVersions(scope, version.routeId, [
					version,
					...versions.filter((entry) => entry.versionId !== version.versionId),
				]);
			});
		},
		deleteRouteVersions(scope: SavedRouteScope, routeId: string) {
			return replaceRouteVersions(scope, routeId, []);
		},
		clear() {
			return Effect.sync(() => {
				rows.clear();
				versionRows.clear();
			});
		},
	};
}

export function createSavedRoutesRepository(
	storage: BrowserStorage | null,
): SavedRoutesRepository {
	let cachedInit: Effect.Effect<void, SavedRoutesRepositoryError> | null = null;
	let driver: SavedRoutesDriver | null = null;

	function getDriver() {
		return Effect.gen(function* () {
			yield* init();
			return driver ?? createMemoryDriver();
		});
	}

	function migrateLegacyRoutes(nextDriver: SavedRoutesDriver) {
		if (!storage) {
			return Effect.void;
		}

		return Effect.gen(function* () {
			const migrations: Array<{
				scope: SavedRouteScope;
				routes: SavedRoute[];
				storageKey: string;
			}> = [];
			const anonymousRoutes = parseSavedRoutes(
				storage.getItem(SAVED_ROUTES_STORAGE_KEY),
			);

			if (anonymousRoutes.length > 0) {
				migrations.push({
					scope: { kind: "anonymous" },
					routes: anonymousRoutes,
					storageKey: SAVED_ROUTES_STORAGE_KEY,
				});
			}

			for (const storageKey of getLegacyUserStorageKeys(storage)) {
				const userId = getUserIdFromSyncedRoutesStorageKey(storageKey);
				const routes = parseSavedRoutes(storage.getItem(storageKey));

				if (userId.length > 0 && routes.length > 0) {
					migrations.push({
						scope: { kind: "user", userId },
						routes,
						storageKey,
					});
				}
			}

			if (migrations.length === 0) {
				return;
			}

			for (const migration of migrations) {
				yield* nextDriver.replaceRoutes(migration.scope, migration.routes);
			}

			for (const migration of migrations) {
				storage.removeItem(migration.storageKey);
			}
		}).pipe(
			Effect.catchDefect((cause) =>
				Effect.fail(repositoryError("migrateLegacyRoutes", cause)),
			),
		);
	}

	function init() {
		if (!cachedInit) {
			const initProgram = Effect.gen(function* () {
				const nextDriver = yield* openSavedRoutesDb().pipe(
					Effect.map(createIndexedDbDriver),
					Effect.catchTag("SavedRoutesRepositoryError", () =>
						Effect.succeed(createMemoryDriver()),
					),
				);
				driver = nextDriver;
				yield* migrateLegacyRoutes(nextDriver);
			}).pipe(
				Effect.catchDefect((cause) =>
					Effect.fail(repositoryError("init", cause)),
				),
			);
			cachedInit = Effect.cached(initProgram).pipe(
				Effect.flatMap((effect) =>
					Effect.sync(() => {
						cachedInit = effect;
						return effect;
					}),
				),
				Effect.flatten,
			);
		}

		return cachedInit;
	}

	function clearLegacyStorage() {
		if (!storage) {
			return Effect.void;
		}

		return Effect.try({
			try: () => {
				const userScopedKeys = getLegacyUserStorageKeys(storage);
				storage.removeItem(SAVED_ROUTES_STORAGE_KEY);
				storage.removeItem(SYNCED_MIGRATIONS_STORAGE_KEY);

				for (const storageKey of userScopedKeys) {
					storage.removeItem(storageKey);
				}
			},
			catch: (cause) => repositoryError("clear", cause),
		});
	}

	return {
		init,
		readRoutes(scope) {
			return Effect.gen(function* () {
				const nextDriver = yield* getDriver();
				return yield* nextDriver.readRoutes(scope);
			});
		},
		replaceRoutes(scope, savedRoutes) {
			return Effect.gen(function* () {
				const nextDriver = yield* getDriver();
				yield* nextDriver.replaceRoutes(scope, savedRoutes);
			});
		},
		upsertRoute(scope, savedRoute) {
			return Effect.gen(function* () {
				const nextDriver = yield* getDriver();
				yield* nextDriver.upsertRoute(scope, savedRoute);
			});
		},
		deleteRoute(scope, routeId) {
			return Effect.gen(function* () {
				const nextDriver = yield* getDriver();
				yield* nextDriver.deleteRoute(scope, routeId);
			});
		},
		readRouteVersions(scope, routeId) {
			return Effect.gen(function* () {
				const nextDriver = yield* getDriver();
				return yield* nextDriver.readRouteVersions(scope, routeId);
			});
		},
		replaceRouteVersions(scope, routeId, versions) {
			return Effect.gen(function* () {
				const nextDriver = yield* getDriver();
				yield* nextDriver.replaceRouteVersions(scope, routeId, versions);
			});
		},
		addRouteVersion(scope, version) {
			return Effect.gen(function* () {
				const nextDriver = yield* getDriver();
				yield* nextDriver.addRouteVersion(scope, version);
			});
		},
		deleteRouteVersions(scope, routeId) {
			return Effect.gen(function* () {
				const nextDriver = yield* getDriver();
				yield* nextDriver.deleteRouteVersions(scope, routeId);
			});
		},
		readMergedUserIds() {
			return Effect.try({
				try: () => readMergedUserIds(storage),
				catch: (cause) => repositoryError("readMergedUserIds", cause),
			});
		},
		writeMergedUserIds(userIds) {
			return Effect.try({
				try: () => writeMergedUserIds(storage, userIds),
				catch: (cause) => repositoryError("writeMergedUserIds", cause),
			});
		},
		clear() {
			return Effect.gen(function* () {
				const nextDriver = yield* getDriver();
				yield* nextDriver.clear();
				yield* clearLegacyStorage();
				cachedInit = null;
				driver = null;
			});
		},
	};
}
