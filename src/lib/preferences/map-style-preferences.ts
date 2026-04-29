import {
	BASEMAPS,
	type BasemapDefinition,
	type BasemapId,
	getAvailableBasemaps,
	getBasemapById,
	isBasemapAvailable,
	isBasemapId,
} from "$lib/map/basemaps";
import type { PreferenceRepository } from "$lib/preferences/preference-repository";

export const MAP_STYLE_STORAGE_KEY = "velix.mapStyle";

export function getFallbackBasemapId(): BasemapId | null {
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

export function initMapStylePreference(
	repository: PreferenceRepository<BasemapId>,
): BasemapId | null {
	const nextBasemapId = resolvePreferredBasemapId(repository.read());

	if (nextBasemapId) {
		repository.write(nextBasemapId);
	} else {
		repository.clear();
	}

	return nextBasemapId;
}

export function setMapStylePreference(
	repository: PreferenceRepository<BasemapId>,
	id: BasemapId,
): BasemapId | null {
	if (!isBasemapAvailable(id)) {
		return null;
	}

	repository.write(id);
	return id;
}

export function getSelectedBasemap(
	selectedBasemapId: BasemapId | null,
): BasemapDefinition | null {
	return selectedBasemapId ? getBasemapById(selectedBasemapId) : null;
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

export type { BasemapDefinition, BasemapId };
