import type { BrowserStorage } from "$lib/storage/browser-storage";

export const SYNCED_MIGRATIONS_STORAGE_KEY =
	"velix.savedRoutes.syncedMigrations";
const SYNCED_ROUTES_STORAGE_KEY_PREFIX = "velix.savedRoutes.synced.";

export function getSyncedRoutesStorageKey(userId: string) {
	return `${SYNCED_ROUTES_STORAGE_KEY_PREFIX}${userId}`;
}

export function getLegacyUserStorageKeys(storage: BrowserStorage | null) {
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

export function getUserIdFromSyncedRoutesStorageKey(storageKey: string) {
	return storageKey.slice(SYNCED_ROUTES_STORAGE_KEY_PREFIX.length);
}

export function readMergedUserIds(storage: BrowserStorage | null) {
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

export function writeMergedUserIds(
	storage: BrowserStorage | null,
	userIds: Set<string>,
) {
	storage?.setItem(SYNCED_MIGRATIONS_STORAGE_KEY, JSON.stringify([...userIds]));
}
