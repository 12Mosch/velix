import {
	BASEMAPS,
	type BasemapDefinition,
	type BasemapId,
	getAvailableBasemaps,
	getBasemapById,
	isBasemapAvailable,
	isBasemapId,
} from "$lib/map/basemaps";
import type {
	PreferenceRepository,
	PreferenceRepositoryError,
} from "$lib/preferences/preference-repository";
import { Effect } from "effect";

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

export const initMapStylePreference = Effect.fn("initMapStylePreference")(
	function* (
		repository: PreferenceRepository<BasemapId>,
	): Effect.fn.Return<BasemapId | null, PreferenceRepositoryError> {
		const nextBasemapId = resolvePreferredBasemapId(yield* repository.read());

		if (nextBasemapId) {
			yield* repository.write(nextBasemapId);
		} else {
			yield* repository.clear();
		}

		return nextBasemapId;
	},
);

export const setMapStylePreference = Effect.fn("setMapStylePreference")(
	function* (
		repository: PreferenceRepository<BasemapId>,
		id: BasemapId,
	): Effect.fn.Return<BasemapId | null, PreferenceRepositoryError> {
		if (!isBasemapAvailable(id)) {
			return null;
		}

		yield* repository.write(id);
		return id;
	},
);

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
