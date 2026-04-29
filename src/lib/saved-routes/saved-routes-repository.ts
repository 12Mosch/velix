import {
	parseSavedRoutes,
	SAVED_ROUTES_STORAGE_KEY,
	type SavedRoute,
} from "$lib/saved-routes-core";
import type { BrowserStorage } from "$lib/storage/browser-storage";

export const SYNCED_MIGRATIONS_STORAGE_KEY =
	"velix.savedRoutes.syncedMigrations";
const SYNCED_ROUTES_STORAGE_KEY_PREFIX = "velix.savedRoutes.synced.";

export type SavedRoutesRepository = {
	readAnonymousRoutes: () => SavedRoute[];
	writeAnonymousRoutes: (savedRoutes: SavedRoute[]) => void;
	readUserRoutes: (userId: string) => SavedRoute[];
	writeUserRoutes: (userId: string, savedRoutes: SavedRoute[]) => void;
	readMergedUserIds: () => Set<string>;
	writeMergedUserIds: (userIds: Set<string>) => void;
	clear: () => void;
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

function writeRoutes(
	storage: BrowserStorage | null,
	storageKey: string,
	savedRoutes: SavedRoute[],
) {
	if (!storage) {
		return;
	}

	if (savedRoutes.length === 0) {
		storage.removeItem(storageKey);
		return;
	}

	storage.setItem(storageKey, JSON.stringify(savedRoutes));
}

export function createSavedRoutesRepository(
	storage: BrowserStorage | null,
): SavedRoutesRepository {
	return {
		readAnonymousRoutes() {
			return parseSavedRoutes(
				storage?.getItem(SAVED_ROUTES_STORAGE_KEY) ?? null,
			);
		},
		writeAnonymousRoutes(savedRoutes) {
			writeRoutes(storage, SAVED_ROUTES_STORAGE_KEY, savedRoutes);
		},
		readUserRoutes(userId) {
			return parseSavedRoutes(
				storage?.getItem(getSyncedRoutesStorageKey(userId)) ?? null,
			);
		},
		writeUserRoutes(userId, savedRoutes) {
			writeRoutes(storage, getSyncedRoutesStorageKey(userId), savedRoutes);
		},
		readMergedUserIds() {
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
				return new Set();
			}
		},
		writeMergedUserIds(userIds) {
			storage?.setItem(
				SYNCED_MIGRATIONS_STORAGE_KEY,
				JSON.stringify([...userIds]),
			);
		},
		clear() {
			if (!storage) {
				return;
			}

			const userScopedKeys: string[] = [];
			const storageLength = storage.length ?? 0;

			for (let index = 0; index < storageLength; index += 1) {
				const storageKey = storage.key?.(index);

				if (storageKey?.startsWith(SYNCED_ROUTES_STORAGE_KEY_PREFIX)) {
					userScopedKeys.push(storageKey);
				}
			}

			storage.removeItem(SAVED_ROUTES_STORAGE_KEY);
			storage.removeItem(SYNCED_MIGRATIONS_STORAGE_KEY);

			for (const storageKey of userScopedKeys) {
				storage.removeItem(storageKey);
			}
		},
	};
}
