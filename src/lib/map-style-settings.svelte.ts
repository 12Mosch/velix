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
import { Effect } from "effect";

export {
	type BasemapDefinition,
	type BasemapId,
	basemapOptions,
	getBasemapOptionState,
	MAP_STYLE_STORAGE_KEY,
	resolvePreferredBasemapId,
};

const mapStyleRepository = createPreferenceRepository<BasemapId>(
	Effect.runSync(createBrowserStorage()),
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

	initMapStylePreference() {
		const state = this;
		return Effect.gen(function* () {
			if (state.initialized) {
				return state.selectedBasemapId;
			}

			state.selectedBasemapId =
				yield* initMapStylePreferenceValue(mapStyleRepository);
			state.initialized = true;

			return state.selectedBasemapId;
		});
	}

	setMapStylePreference(id: BasemapId) {
		return setMapStylePreferenceValue(mapStyleRepository, id).pipe(
			Effect.map((nextBasemapId) => {
				if (!nextBasemapId) {
					return false;
				}

				this.selectedBasemapId = nextBasemapId;
				return true;
			}),
		);
	}

	applyRemoteMapStylePreference(id: BasemapId) {
		const state = this;
		return Effect.gen(function* () {
			const nextBasemapId = resolvePreferredBasemapId(id);

			if (nextBasemapId) {
				yield* mapStyleRepository.write(nextBasemapId);
			} else {
				yield* mapStyleRepository.clear();
			}

			state.selectedBasemapId = nextBasemapId;
			state.initialized = true;
			return nextBasemapId;
		});
	}

	getSelectedBasemap(): BasemapDefinition | null {
		return getSelectedBasemapForId(this.selectedBasemapId);
	}

	resetMapStylePreferenceForTests() {
		return mapStyleRepository.clear().pipe(
			Effect.tap(() =>
				Effect.sync(() => {
					this.initialized = false;
					this.selectedBasemapId = getFallbackBasemapId();
				}),
			),
		);
	}
}

export const mapStylePreference = new MapStylePreferenceState();

export function syncSelectedBasemap(): BasemapId | null {
	return mapStylePreference.syncSelectedBasemap();
}

export function initMapStylePreference() {
	return mapStylePreference.initMapStylePreference();
}

export function setMapStylePreference(id: BasemapId) {
	return mapStylePreference.setMapStylePreference(id);
}

export function applyRemoteMapStylePreference(id: BasemapId) {
	return mapStylePreference.applyRemoteMapStylePreference(id);
}

export function getSelectedBasemap() {
	return mapStylePreference.getSelectedBasemap();
}

export function resetMapStylePreferenceForTests() {
	return mapStylePreference.resetMapStylePreferenceForTests();
}
