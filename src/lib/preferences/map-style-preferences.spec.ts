import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

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
		read: vi.fn(() => Effect.succeed(currentValue as BasemapId | null)),
		write: vi.fn((nextValue: BasemapId) =>
			Effect.sync(() => {
				currentValue = nextValue;
			}),
		),
		clear: vi.fn(() =>
			Effect.sync(() => {
				currentValue = null;
			}),
		),
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

		expect(Effect.runSync(initMapStylePreference(repository))).toBe(
			"maptiler-outdoor",
		);
		expect(repository.write).toHaveBeenCalledWith("maptiler-outdoor");
	});

	it("persists available basemaps and exposes selected basemap metadata", () => {
		const repository = createRepository(null);

		expect(
			Effect.runSync(setMapStylePreference(repository, "maptiler-outdoor")),
		).toBe("maptiler-outdoor");
		expect(getSelectedBasemap("maptiler-outdoor")?.label).toBe(
			"MapTiler Outdoor",
		);
	});
});
