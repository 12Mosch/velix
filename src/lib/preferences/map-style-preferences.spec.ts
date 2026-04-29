import { describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_MAPTILER_API_KEY: "maptiler-test-key",
		PUBLIC_STADIA_MAPS_API_KEY: "stadia-test-key",
	},
}));

import type { BasemapId } from "$lib/map/basemaps";
import {
	getSelectedBasemap,
	initMapStylePreference,
	resolvePreferredBasemapId,
	setMapStylePreference,
} from "$lib/preferences/map-style-preferences";
import type { PreferenceRepository } from "$lib/preferences/preference-repository";

function createRepository(
	value: string | null,
): PreferenceRepository<BasemapId> {
	let currentValue = value;

	return {
		read: () => currentValue as BasemapId | null,
		write: vi.fn((nextValue: BasemapId) => {
			currentValue = nextValue;
		}),
		clear: vi.fn(() => {
			currentValue = null;
		}),
	};
}

describe("map style preferences", () => {
	it("resolves stored basemaps and falls back for invalid ids", () => {
		expect(resolvePreferredBasemapId("maptiler-outdoor")).toBe(
			"maptiler-outdoor",
		);
		expect(resolvePreferredBasemapId("missing")).toBe("stadia-alidade-smooth");
	});

	it("initializes and persists the resolved basemap", () => {
		const repository = createRepository("maptiler-outdoor");

		expect(initMapStylePreference(repository)).toBe("maptiler-outdoor");
		expect(repository.write).toHaveBeenCalledWith("maptiler-outdoor");
	});

	it("persists available basemaps and exposes selected basemap metadata", () => {
		const repository = createRepository(null);

		expect(setMapStylePreference(repository, "maptiler-outdoor")).toBe(
			"maptiler-outdoor",
		);
		expect(getSelectedBasemap("maptiler-outdoor")?.label).toBe(
			"MapTiler Outdoor",
		);
	});
});
