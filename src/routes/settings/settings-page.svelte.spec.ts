import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_MAPTILER_API_KEY: "maptiler-test-key",
		PUBLIC_STADIA_MAPS_API_KEY: "stadia-test-key",
	},
}));

const mapRemoveMock = vi.fn();
const mapMock = vi.fn(function MockMap(_options: unknown) {
	return {
		remove: mapRemoveMock,
	};
});

vi.mock("maplibre-gl", () => ({
	Map: mapMock,
	default: {
		Map: mapMock,
	},
}));

import SettingsPage from "./+page.svelte";
import {
	MAP_STYLE_STORAGE_KEY,
	resetMapStylePreferenceForTests,
} from "$lib/map-style-settings.svelte";
import {
	DISTANCE_UNIT_STORAGE_KEY,
	resetUnitPreferenceForTests,
} from "$lib/unit-settings.svelte";

describe("settings page", () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetMapStylePreferenceForTests();
		resetUnitPreferenceForTests();
		mapMock.mockClear();
		mapRemoveMock.mockClear();
	});

	function getRadio(name: string) {
		return page.getByRole("radio", { name: new RegExp(`^${name}$`) });
	}

	it("renders all five basemap options with a single selected value", async () => {
		render(SettingsPage);

		await expect
			.element(page.getByRole("heading", { name: "Settings" }))
			.toBeInTheDocument();
		await expect.element(getRadio("Stadia Alidade Smooth")).toBeInTheDocument();
		await expect
			.element(getRadio("Stadia Alidade Smooth Dark"))
			.toBeInTheDocument();
		await expect.element(getRadio("Stadia Stamen Terrain")).toBeInTheDocument();
		await expect
			.element(getRadio("MapTiler Satellite Hybrid"))
			.toBeInTheDocument();
		await expect.element(getRadio("MapTiler Outdoor")).toBeInTheDocument();

		const selectedRadios = document.querySelectorAll(
			'[aria-label="Basemap style"] [role="radio"][aria-checked="true"]',
		);
		expect(selectedRadios).toHaveLength(1);
		await expect
			.element(getRadio("Stadia Alidade Smooth"))
			.toHaveAttribute("aria-checked", "true");
		await expect
			.element(getRadio("Kilometers"))
			.toHaveAttribute("aria-checked", "true");
	});

	it("persists the chosen basemap in localStorage and restores it after remount", async () => {
		const firstView = render(SettingsPage);

		await expect.element(getRadio("MapTiler Outdoor")).toBeInTheDocument();
		await getRadio("MapTiler Outdoor").click();

		await expect
			.element(getRadio("MapTiler Outdoor"))
			.toHaveAttribute("aria-checked", "true");
		expect(window.localStorage.getItem(MAP_STYLE_STORAGE_KEY)).toBe(
			"maptiler-outdoor",
		);

		await firstView.unmount();

		const persistedBasemapId = window.localStorage.getItem(
			MAP_STYLE_STORAGE_KEY,
		);
		resetMapStylePreferenceForTests();
		if (persistedBasemapId) {
			window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, persistedBasemapId);
		}

		render(SettingsPage);

		await expect
			.element(getRadio("MapTiler Outdoor"))
			.toHaveAttribute("aria-checked", "true");
	});

	it("persists the chosen distance unit in localStorage and restores it after remount", async () => {
		const firstView = render(SettingsPage);

		await expect
			.element(getRadio("Kilometers"))
			.toHaveAttribute("aria-checked", "true");
		await expect.element(getRadio("Miles")).toBeInTheDocument();
		await getRadio("Miles").click();

		await expect
			.element(getRadio("Miles"))
			.toHaveAttribute("aria-checked", "true");
		expect(window.localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY)).toBe("mi");

		await firstView.unmount();

		const persistedDistanceUnit = window.localStorage.getItem(
			DISTANCE_UNIT_STORAGE_KEY,
		);
		resetUnitPreferenceForTests();
		if (persistedDistanceUnit) {
			window.localStorage.setItem(
				DISTANCE_UNIT_STORAGE_KEY,
				persistedDistanceUnit,
			);
		}

		render(SettingsPage);

		await expect
			.element(getRadio("Miles"))
			.toHaveAttribute("aria-checked", "true");
	});
});
