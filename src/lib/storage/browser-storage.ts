import { browser } from "$app/environment";

export type BrowserStorage = {
	readonly length?: number;
	getItem: (key: string) => string | null;
	key?: (index: number) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
};

export function createBrowserStorage(): BrowserStorage | null {
	if (!browser || typeof window === "undefined") {
		return null;
	}

	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
