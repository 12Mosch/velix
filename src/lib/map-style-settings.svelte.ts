import {
	type BasemapDefinition,
	type BasemapId,
	basemapOptions,
	getBasemapOptionState,
	getFallbackBasemapId,
	getSelectedBasemap as getSelectedBasemapForId,
	initMapStylePreference as initMapStylePreferenceValue,
	MAP_STYLE_STORAGE_KEY,
	resolvePreferredBasemapId,
	setMapStylePreference as setMapStylePreferenceValue,
} from "$lib/preferences/map-style-preferences";
import { createPreferenceRepository } from "$lib/preferences/preference-repository";
import { createBrowserStorage } from "$lib/storage/browser-storage";

export {
	type BasemapDefinition,
	type BasemapId,
	basemapOptions,
	getBasemapOptionState,
	MAP_STYLE_STORAGE_KEY,
	resolvePreferredBasemapId,
};

const mapStyleRepository = createPreferenceRepository<BasemapId>(
	createBrowserStorage(),
	MAP_STYLE_STORAGE_KEY,
);

class MapStylePreferenceState {
	initialized = $state(false);
	selectedBasemapId = $state<BasemapId | null>(getFallbackBasemapId());

	syncSelectedBasemap(): BasemapId | null {
		const nextBasemapId = resolvePreferredBasemapId(this.selectedBasemapId);
		this.selectedBasemapId = nextBasemapId;
		return nextBasemapId;
	}

	initMapStylePreference(): BasemapId | null {
		if (this.initialized) {
			return this.selectedBasemapId;
		}

		this.initialized = true;
		this.selectedBasemapId = initMapStylePreferenceValue(mapStyleRepository);

		return this.selectedBasemapId;
	}

	setMapStylePreference(id: BasemapId): boolean {
		const nextBasemapId = setMapStylePreferenceValue(mapStyleRepository, id);

		if (!nextBasemapId) {
			return false;
		}

		this.selectedBasemapId = nextBasemapId;
		return true;
	}

	applyRemoteMapStylePreference(id: BasemapId): BasemapId | null {
		const nextBasemapId = resolvePreferredBasemapId(id);

		if (nextBasemapId) {
			mapStyleRepository.write(nextBasemapId);
		} else {
			mapStyleRepository.clear();
		}

		this.selectedBasemapId = nextBasemapId;
		this.initialized = true;
		return nextBasemapId;
	}

	getSelectedBasemap(): BasemapDefinition | null {
		return getSelectedBasemapForId(this.selectedBasemapId);
	}

	resetMapStylePreferenceForTests() {
		this.initialized = false;
		this.selectedBasemapId = getFallbackBasemapId();
		mapStyleRepository.clear();
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

export function applyRemoteMapStylePreference(id: BasemapId): BasemapId | null {
	return mapStylePreference.applyRemoteMapStylePreference(id);
}

export function getSelectedBasemap() {
	return mapStylePreference.getSelectedBasemap();
}

export function resetMapStylePreferenceForTests() {
	mapStylePreference.resetMapStylePreferenceForTests();
}
