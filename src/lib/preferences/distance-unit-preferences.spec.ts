import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import {
	formatDistance,
	formatDistanceInput,
	getMapLibreScaleUnit,
	initDistanceUnitPreference,
	parseDistanceInputToMeters,
	setDistanceUnitPreference,
} from "$lib/preferences/distance-unit-preferences";
import type { PreferenceRepository } from "$lib/preferences/preference-repository";

function createRepository(
	value: "km" | "mi" | null,
): PreferenceRepository<"km" | "mi"> {
	let currentValue = value;

	return {
		read: vi.fn(() => Effect.succeed(currentValue)),
		write: vi.fn((nextValue: "km" | "mi") =>
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

describe("distance unit preferences", () => {
	it("initializes from stored values and falls back to kilometers", () => {
		expect(
			Effect.runSync(initDistanceUnitPreference(createRepository("mi"))),
		).toBe("mi");
		expect(
			Effect.runSync(initDistanceUnitPreference(createRepository(null))),
		).toBe("km");
	});

	it("persists valid units and rejects invalid values", () => {
		const repository = createRepository("km");

		expect(Effect.runSync(setDistanceUnitPreference(repository, "mi"))).toBe(
			"mi",
		);
		expect(
			Effect.runSync(setDistanceUnitPreference(repository, "bad" as "mi")),
		).toBeNull();
	});

	it("formats and parses distances using the selected unit", () => {
		expect(formatDistance(1609.344, "mi")).toBe("1.0 mi");
		expect(formatDistanceInput(1609.344, "mi")).toBe("1");
		expect(parseDistanceInputToMeters("1,5", "km")).toBe(1500);
		expect(parseDistanceInputToMeters("-1", "km")).toBeNull();
		expect(getMapLibreScaleUnit("mi")).toBe("imperial");
	});
});
