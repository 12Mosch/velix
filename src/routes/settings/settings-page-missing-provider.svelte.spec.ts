import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_MAPTILER_API_KEY: "",
		PUBLIC_STADIA_MAPS_API_KEY: "stadia-test-key",
	},
}));

import SettingsPage from "./+page.svelte";
import {
	MAP_STYLE_STORAGE_KEY,
	resetMapStylePreferenceForTests,
} from "$lib/map-style-settings.svelte";

describe("settings page with missing provider keys", () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetMapStylePreferenceForTests();
		window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, "maptiler-outdoor");
	});

	function getRadio(name: string) {
		return page.getByRole("radio", { name: new RegExp(`^${name}$`) });
	}

	it("falls back to the first available basemap and disables unavailable options", async () => {
		render(SettingsPage);

		await expect.element(getRadio("Stadia Alidade Smooth")).toHaveAttribute(
			"aria-checked",
			"true",
		);
		expect(window.localStorage.getItem(MAP_STYLE_STORAGE_KEY)).toBe(
			"stadia-alidade-smooth",
		);

		await expect.element(getRadio("MapTiler Satellite Hybrid")).toBeDisabled();
		await expect.element(getRadio("MapTiler Outdoor")).toBeDisabled();
		expect(document.body.textContent?.match(/PUBLIC_MAPTILER_API_KEY/g)?.length).toBe(2);
	});
});
