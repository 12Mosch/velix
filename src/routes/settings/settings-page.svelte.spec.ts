import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_MAPTILER_API_KEY: "maptiler-test-key",
		PUBLIC_STADIA_MAPS_API_KEY: "stadia-test-key",
	},
}));

import SettingsPage from "./+page.svelte";
import {
	MAP_STYLE_STORAGE_KEY,
	resetMapStylePreferenceForTests,
} from "$lib/map-style-settings.svelte";

describe("settings page", () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetMapStylePreferenceForTests();
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
			'[role="radio"][aria-checked="true"]',
		);
		expect(selectedRadios).toHaveLength(1);
		await expect
			.element(getRadio("Stadia Alidade Smooth"))
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
});
