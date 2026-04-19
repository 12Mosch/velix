import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_MAPTILER_API_KEY: "maptiler-test-key",
		PUBLIC_STADIA_MAPS_API_KEY: "stadia-test-key",
	},
}));

import PageTestShell from "./page-test-shell.svelte";
import {
	MAP_STYLE_STORAGE_KEY,
	resetMapStylePreferenceForTests,
} from "$lib/map-style-settings.svelte";

const { mapInstance, mapMock } = vi.hoisted(() => {
	return {
		mapInstance: {
			once: vi.fn(),
			remove: vi.fn(),
			resize: vi.fn(),
			setStyle: vi.fn(),
		},
		mapMock: vi.fn(function MockMap(_options: unknown) {
			return mapInstance;
		}),
	};
});

vi.mock("maplibre-gl", () => {
	mapMock.mockImplementation(function MockMap(_options: unknown) {
		return mapInstance;
	});
	mapInstance.once.mockImplementation((event: string, callback: () => void) => {
		if (event === "load" || event === "style.load") callback();
		return mapInstance;
	});

	return {
		Map: mapMock,
		default: {
			Map: mapMock,
		},
	};
});

describe("+page.svelte", () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetMapStylePreferenceForTests();
		window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, "maptiler-outdoor");
		mapMock.mockClear();
		mapInstance.once.mockClear();
		mapInstance.remove.mockClear();
		mapInstance.resize.mockClear();
		mapInstance.setStyle.mockClear();
	});

	it("renders the live map layer and active provider attribution", async () => {
		render(PageTestShell);

		await expect
			.element(page.getByRole("region", { name: "Route map" }))
			.toBeInTheDocument();
		await expect.element(page.getByText("Basemap")).toBeInTheDocument();
		await expect.element(page.getByRole("link", { name: "MapTiler" })).toBeInTheDocument();
		await expect.element(page.getByRole("link", { name: "OpenStreetMap" })).toBeInTheDocument();
		await expect.poll(() => mapMock.mock.calls.length).toBe(1);

		expect(
			document.querySelector('path[d*="M 0 50 C 20 20, 40 80, 60 40"]'),
		).toBeNull();
		expect(document.body.textContent).not.toContain("OpenStreetMap contributors");
	});
});
