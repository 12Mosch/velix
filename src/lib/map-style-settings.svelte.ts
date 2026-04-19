import { browser } from "$app/environment";

import {
	BASEMAPS,
	type BasemapDefinition,
	getAvailableBasemaps,
	getBasemapById,
	isBasemapAvailable,
	isBasemapId,
	type BasemapId,
} from "$lib/map/basemaps";

export const MAP_STYLE_STORAGE_KEY = "velix.mapStyle";

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

class MapStylePreferenceState {
	initialized = $state(false);
	selectedBasemapId = $state<BasemapId | null>(getFallbackBasemapId());

	syncSelectedBasemap(): BasemapId | null {
		const nextBasemapId = resolvePreferredBasemapId(this.selectedBasemapId);
		this.selectedBasemapId = nextBasemapId;
		return nextBasemapId;
	}

	initMapStylePreference(): BasemapId | null {
		if (!browser) {
			return this.syncSelectedBasemap();
		}

		if (this.initialized) {
			return this.selectedBasemapId;
		}

		this.initialized = true;

		const storedBasemapId = window.localStorage.getItem(MAP_STYLE_STORAGE_KEY);
		const nextBasemapId = resolvePreferredBasemapId(storedBasemapId);

		this.selectedBasemapId = nextBasemapId;

		if (nextBasemapId) {
			window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, nextBasemapId);
		} else {
			window.localStorage.removeItem(MAP_STYLE_STORAGE_KEY);
		}

		return nextBasemapId;
	}

	setMapStylePreference(id: BasemapId): boolean {
		if (!isBasemapAvailable(id)) {
			return false;
		}

		this.selectedBasemapId = id;

		if (browser) {
			window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, id);
		}

		return true;
	}

	getSelectedBasemap(): BasemapDefinition | null {
		return this.selectedBasemapId
			? getBasemapById(this.selectedBasemapId)
			: null;
	}

	resetMapStylePreferenceForTests() {
		this.initialized = false;
		this.selectedBasemapId = getFallbackBasemapId();

		if (browser) {
			window.localStorage.removeItem(MAP_STYLE_STORAGE_KEY);
		}
	}
}

export const mapStylePreference = new MapStylePreferenceState();

export function syncSelectedBasemap(): BasemapId | null {
	return mapStylePreference.syncSelectedBasemap();
}

export function initMapStylePreference(): BasemapId | null {
	return mapStylePreference.initMapStylePreference();
}

export function setMapStylePreference(id: BasemapId): boolean {
	return mapStylePreference.setMapStylePreference(id);
}

export function getSelectedBasemap() {
	return mapStylePreference.getSelectedBasemap();
}

export function resetMapStylePreferenceForTests() {
	mapStylePreference.resetMapStylePreferenceForTests();
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
