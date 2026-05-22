import { describe, expect, it } from "vitest";

import { BASEMAPS } from "$lib/map/basemaps";
import {
	basemapIdValues,
	distanceUnitValues,
	isBasemapIdValue,
	isDistanceUnit,
	isThemeMode,
	themeModeValues,
} from "$lib/preferences/user-preference-values";

describe("user preference values", () => {
	it("accepts valid theme modes and rejects invalid values", () => {
		for (const value of themeModeValues) {
			expect(isThemeMode(value)).toBe(true);
		}

		expect(isThemeMode("contrast")).toBe(false);
		expect(isThemeMode(null)).toBe(false);
	});

	it("accepts valid basemap ids and rejects invalid values", () => {
		for (const value of basemapIdValues) {
			expect(isBasemapIdValue(value)).toBe(true);
		}

		expect(isBasemapIdValue("missing-basemap")).toBe(false);
		expect(isBasemapIdValue(null)).toBe(false);
	});

	it("matches the configured basemap definitions", () => {
		expect([...basemapIdValues].sort()).toEqual(
			BASEMAPS.map((basemap) => basemap.id).sort(),
		);
	});

	it("accepts valid distance units and rejects invalid values", () => {
		for (const value of distanceUnitValues) {
			expect(isDistanceUnit(value)).toBe(true);
		}

		expect(isDistanceUnit("meters")).toBe(false);
		expect(isDistanceUnit(null)).toBe(false);
	});
});
