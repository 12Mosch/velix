import type { BrowserStorage } from "$lib/storage/browser-storage";

export type PreferenceRepository<TValue extends string> = {
	read: () => TValue | null;
	write: (value: TValue) => void;
	clear: () => void;
};

export function createPreferenceRepository<TValue extends string>(
	storage: BrowserStorage | null,
	storageKey: string,
): PreferenceRepository<TValue> {
	return {
		read() {
			return (storage?.getItem(storageKey) as TValue | null) ?? null;
		},
		write(value) {
			storage?.setItem(storageKey, value);
		},
		clear() {
			storage?.removeItem(storageKey);
		},
	};
}
