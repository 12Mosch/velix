import {
	normalizeSavedRoutes,
	parseSavedRoutes,
	SAVED_ROUTES_STORAGE_KEY,
	type SavedRoute,
} from "$lib/saved-routes-core";
import type { BrowserStorage } from "$lib/storage/browser-storage";

export const SYNCED_MIGRATIONS_STORAGE_KEY =
	"velix.savedRoutes.syncedMigrations";
const SYNCED_ROUTES_STORAGE_KEY_PREFIX = "velix.savedRoutes.synced.";

const SAVED_ROUTES_DB_NAME = "velix.savedRoutes";
const SAVED_ROUTES_DB_VERSION = 1;
const SAVED_ROUTES_STORE_NAME = "routes";
const SAVED_ROUTES_SCOPE_INDEX = "scope";

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

export type SavedRoutesRepository = {
	init: () => Promise<void>;
	readRoutes: (scope: SavedRouteScope) => Promise<SavedRoute[]>;
	replaceRoutes: (
		scope: SavedRouteScope,
		savedRoutes: SavedRoute[],
	) => Promise<void>;
	upsertRoute: (
		scope: SavedRouteScope,
		savedRoute: SavedRoute,
	) => Promise<void>;
	deleteRoute: (scope: SavedRouteScope, routeId: string) => Promise<void>;
	readMergedUserIds: () => Set<string>;
	writeMergedUserIds: (userIds: Set<string>) => void;
	clear: () => Promise<void>;
};

export function getSyncedRoutesStorageKey(userId: string) {
	return `${SYNCED_ROUTES_STORAGE_KEY_PREFIX}${userId}`;
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

function sortSavedRoutes(savedRoutes: SavedRoute[]) {
	return savedRoutes.toSorted(
		(left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
	);
}

function getLegacyUserStorageKeys(storage: BrowserStorage | null) {
	if (!storage) {
		return [];
	}

	const keys: string[] = [];
	const storageLength = storage.length ?? 0;

	for (let index = 0; index < storageLength; index += 1) {
		const storageKey = storage.key?.(index);

		if (storageKey?.startsWith(SYNCED_ROUTES_STORAGE_KEY_PREFIX)) {
			keys.push(storageKey);
		}
	}

	return keys;
}

function readMergedUserIds(storage: BrowserStorage | null) {
	try {
		const parsedValue = JSON.parse(
			storage?.getItem(SYNCED_MIGRATIONS_STORAGE_KEY) ?? "[]",
		) as unknown;

		return new Set(
			Array.isArray(parsedValue)
				? parsedValue.filter(
						(value): value is string => typeof value === "string",
					)
				: [],
		);
	} catch {
		return new Set<string>();
	}
}

function writeMergedUserIds(
	storage: BrowserStorage | null,
	userIds: Set<string>,
) {
	storage?.setItem(SYNCED_MIGRATIONS_STORAGE_KEY, JSON.stringify([...userIds]));
}

function normalizeRows(rows: SavedRouteIndexedDbRow[]) {
	return sortSavedRoutes(
		normalizeSavedRoutes(rows.map((row) => row.savedRoute)),
	);
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

function requestToPromise<T>(request: IDBRequest<T>) {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB request failed."));
	});
}

function transactionDone(transaction: IDBTransaction) {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
		transaction.onerror = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction failed."));
	});
}

function openSavedRoutesDb() {
	if (!globalThis.indexedDB) {
		return Promise.reject(new Error("IndexedDB is unavailable."));
	}

	return new Promise<IDBDatabase>((resolve, reject) => {
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
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("Could not open IndexedDB."));
		request.onblocked = () => reject(new Error("IndexedDB open was blocked."));
	});
}

async function getRowsForScope(db: IDBDatabase, scope: SavedRouteScope) {
	const transaction = db.transaction(SAVED_ROUTES_STORE_NAME, "readonly");
	const done = transactionDone(transaction);
	const store = transaction.objectStore(SAVED_ROUTES_STORE_NAME);
	const index = store.index(SAVED_ROUTES_SCOPE_INDEX);
	const rows = await requestToPromise<SavedRouteIndexedDbRow[]>(
		index.getAll(getSavedRouteScopeKey(scope)),
	);
	await done;
	return rows;
}

async function replaceScopeRows(
	db: IDBDatabase,
	scope: SavedRouteScope,
	savedRoutes: SavedRoute[],
) {
	const transaction = db.transaction(SAVED_ROUTES_STORE_NAME, "readwrite");
	const done = transactionDone(transaction);
	const store = transaction.objectStore(SAVED_ROUTES_STORE_NAME);
	const index = store.index(SAVED_ROUTES_SCOPE_INDEX);
	const existingRows = await requestToPromise<SavedRouteIndexedDbRow[]>(
		index.getAll(getSavedRouteScopeKey(scope)),
	);

	for (const row of existingRows) {
		store.delete(row.storageKey);
	}

	for (const savedRoute of savedRoutes) {
		store.put(toRow(scope, savedRoute));
	}

	await done;
}

function createIndexedDbDriver(db: IDBDatabase) {
	return {
		async readRoutes(scope: SavedRouteScope) {
			return normalizeRows(await getRowsForScope(db, scope));
		},
		async replaceRoutes(scope: SavedRouteScope, savedRoutes: SavedRoute[]) {
			await replaceScopeRows(db, scope, savedRoutes);
		},
		async upsertRoute(scope: SavedRouteScope, savedRoute: SavedRoute) {
			const transaction = db.transaction(SAVED_ROUTES_STORE_NAME, "readwrite");
			const done = transactionDone(transaction);
			transaction
				.objectStore(SAVED_ROUTES_STORE_NAME)
				.put(toRow(scope, savedRoute));
			await done;
		},
		async deleteRoute(scope: SavedRouteScope, routeId: string) {
			const transaction = db.transaction(SAVED_ROUTES_STORE_NAME, "readwrite");
			const done = transactionDone(transaction);
			transaction
				.objectStore(SAVED_ROUTES_STORE_NAME)
				.delete(getSavedRouteStorageKey(scope, routeId));
			await done;
		},
		async clear() {
			const transaction = db.transaction(SAVED_ROUTES_STORE_NAME, "readwrite");
			const done = transactionDone(transaction);
			transaction.objectStore(SAVED_ROUTES_STORE_NAME).clear();
			await done;
		},
	};
}

function createMemoryDriver() {
	const rows = new Map<string, SavedRouteIndexedDbRow>();

	return {
		async readRoutes(scope: SavedRouteScope) {
			return normalizeRows(
				[...rows.values()].filter(
					(row) => row.scope === getSavedRouteScopeKey(scope),
				),
			);
		},
		async replaceRoutes(scope: SavedRouteScope, savedRoutes: SavedRoute[]) {
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
		},
		async upsertRoute(scope: SavedRouteScope, savedRoute: SavedRoute) {
			const row = toRow(scope, savedRoute);
			rows.set(row.storageKey, row);
		},
		async deleteRoute(scope: SavedRouteScope, routeId: string) {
			rows.delete(getSavedRouteStorageKey(scope, routeId));
		},
		async clear() {
			rows.clear();
		},
	};
}

type SavedRoutesDriver = ReturnType<typeof createMemoryDriver>;

export function createSavedRoutesRepository(
	storage: BrowserStorage | null,
): SavedRoutesRepository {
	let initPromise: Promise<void> | null = null;
	let driver: SavedRoutesDriver | null = null;

	async function getDriver() {
		await init();
		return driver ?? createMemoryDriver();
	}

	async function migrateLegacyRoutes(nextDriver: SavedRoutesDriver) {
		if (!storage) {
			return;
		}

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
			const userId = storageKey.slice(SYNCED_ROUTES_STORAGE_KEY_PREFIX.length);
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
			await nextDriver.replaceRoutes(migration.scope, migration.routes);
		}

		for (const migration of migrations) {
			storage.removeItem(migration.storageKey);
		}
	}

	async function init() {
		if (!initPromise) {
			initPromise = (async () => {
				try {
					driver = createIndexedDbDriver(await openSavedRoutesDb());
				} catch {
					driver = createMemoryDriver();
				}

				await migrateLegacyRoutes(driver);
			})();
		}

		await initPromise;
	}

	async function clearLegacyStorage() {
		if (!storage) {
			return;
		}

		const userScopedKeys = getLegacyUserStorageKeys(storage);
		storage.removeItem(SAVED_ROUTES_STORAGE_KEY);
		storage.removeItem(SYNCED_MIGRATIONS_STORAGE_KEY);

		for (const storageKey of userScopedKeys) {
			storage.removeItem(storageKey);
		}
	}

	return {
		init,
		async readRoutes(scope) {
			return (await getDriver()).readRoutes(scope);
		},
		async replaceRoutes(scope, savedRoutes) {
			await (await getDriver()).replaceRoutes(scope, savedRoutes);
		},
		async upsertRoute(scope, savedRoute) {
			await (await getDriver()).upsertRoute(scope, savedRoute);
		},
		async deleteRoute(scope, routeId) {
			await (await getDriver()).deleteRoute(scope, routeId);
		},
		readMergedUserIds() {
			return readMergedUserIds(storage);
		},
		writeMergedUserIds(userIds) {
			writeMergedUserIds(storage, userIds);
		},
		async clear() {
			await (await getDriver()).clear();
			await clearLegacyStorage();
			initPromise = null;
		},
	};
}
