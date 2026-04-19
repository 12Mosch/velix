import { browser } from "$app/environment";
import { get, writable } from "svelte/store";

import {
	BASEMAPS,
	getAvailableBasemaps,
	getBasemapById,
	isBasemapAvailable,
	isBasemapId,
	type BasemapId,
} from "$lib/map/basemaps";

export const MAP_STYLE_STORAGE_KEY = "velix.mapStyle";

let initialized = false;

function getFallbackBasemapId(): BasemapId | null {
	return getAvailableBasemaps()[0]?.id ?? null;
}

export function resolvePreferredBasemapId(
	preferredId: string | null,
): BasemapId | null {
	if (
		preferredId &&
		isBasemapId(preferredId) &&
		isBasemapAvailable(preferredId)
	) {
		return preferredId;
	}

	return getFallbackBasemapId();
}

export const selectedBasemapId = writable<BasemapId | null>(
	getFallbackBasemapId(),
);

export function syncSelectedBasemap(): BasemapId | null {
	const nextBasemapId = resolvePreferredBasemapId(get(selectedBasemapId));
	selectedBasemapId.set(nextBasemapId);
	return nextBasemapId;
}

export function initMapStylePreference(): BasemapId | null {
	if (!browser) {
		return syncSelectedBasemap();
	}

	if (initialized) {
		return get(selectedBasemapId);
	}

	initialized = true;

	const storedBasemapId = window.localStorage.getItem(MAP_STYLE_STORAGE_KEY);
	const nextBasemapId = resolvePreferredBasemapId(storedBasemapId);

	selectedBasemapId.set(nextBasemapId);

	if (nextBasemapId) {
		window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, nextBasemapId);
	} else {
		window.localStorage.removeItem(MAP_STYLE_STORAGE_KEY);
	}

	return nextBasemapId;
}

export function setMapStylePreference(id: BasemapId): boolean {
	if (!isBasemapAvailable(id)) {
		return false;
	}

	selectedBasemapId.set(id);

	if (browser) {
		window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, id);
	}

	return true;
}

export function getSelectedBasemap() {
	const basemapId = get(selectedBasemapId);
	return basemapId ? getBasemapById(basemapId) : null;
}

export function resetMapStylePreferenceForTests() {
	initialized = false;
	selectedBasemapId.set(getFallbackBasemapId());

	if (browser) {
		window.localStorage.removeItem(MAP_STYLE_STORAGE_KEY);
	}
}

export function getBasemapOptionState(id: BasemapId) {
	const basemap = getBasemapById(id);

	return {
		...basemap,
		available: isBasemapAvailable(id),
	};
}

export const basemapOptions = BASEMAPS.map((basemap) =>
	getBasemapOptionState(basemap.id),
);
