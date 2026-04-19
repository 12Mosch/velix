import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_MAPTILER_API_KEY: "maptiler-test-key",
		PUBLIC_STADIA_MAPS_API_KEY: "stadia-test-key",
	},
}));

import MapView from "./map-view.svelte";
import {
	MAP_STYLE_STORAGE_KEY,
	resetMapStylePreferenceForTests,
	setMapStylePreference,
} from "$lib/map-style-settings.svelte";

type MockMapOptions = {
	attributionControl: boolean;
	center: [number, number];
	container: HTMLElement;
	style: string;
	zoom: number;
};

const { mapInstance, mapMock } = vi.hoisted(() => {
	return {
		mapInstance: {
			once: vi.fn(),
			remove: vi.fn(),
			resize: vi.fn(),
			setStyle: vi.fn(),
		},
		mapMock: vi.fn(function MockMap(_options: MockMapOptions) {
			return mapInstance;
		}),
	};
});

vi.mock("maplibre-gl", () => {
	mapMock.mockImplementation(function MockMap(_options: MockMapOptions) {
		return mapInstance;
	});
	mapInstance.once.mockImplementation((event: string, callback: () => void) => {
		if (event === "load" || event === "style.load") {
			callback();
		}

		return mapInstance;
	});

	return {
		Map: mapMock,
		default: {
			Map: mapMock,
		},
	};
});

describe("MapView", () => {
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

	beforeEach(() => {
		window.localStorage.clear();
		resetMapStylePreferenceForTests();
		mapMock.mockClear();
		mapMock.mockImplementation(function MockMap(_options: MockMapOptions) {
			return mapInstance;
		});
		mapInstance.once.mockClear();
		mapInstance.remove.mockClear();
		mapInstance.resize.mockClear();
		mapInstance.setStyle.mockClear();
		consoleError.mockClear();
	});

	it("creates a map with the selected provider style and tears it down", async () => {
		window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, "maptiler-outdoor");

		const view = render(MapView, {
			ariaLabel: "Test map",
			initialCenter: [11.5, 47.2],
			initialZoom: 9,
		});

		await expect
			.element(page.getByRole("region", { name: "Test map" }))
			.toBeInTheDocument();
		await expect.poll(() => mapMock.mock.calls.length).toBe(1);

		const options = mapMock.mock.calls[0]?.[0];
		expect(options).toBeDefined();
		if (!options) {
			throw new Error("Expected MapLibre constructor options to be defined");
		}

		expect(options.attributionControl).toBe(false);
		expect(options.center).toEqual([11.5, 47.2]);
		expect(options.zoom).toBe(9);
		expect(options.style).toBe(
			"https://api.maptiler.com/maps/outdoor-v2/style.json?key=maptiler-test-key",
		);
		expect(options.container).toBeInstanceOf(HTMLElement);

		await view.unmount();

		expect(mapInstance.remove).toHaveBeenCalledTimes(1);
	});

	it("updates the active map style without recreating the map", async () => {
		render(MapView);

		await expect.poll(() => mapMock.mock.calls.length).toBe(1);

		expect(mapInstance.setStyle).not.toHaveBeenCalled();

		expect(setMapStylePreference("maptiler-satellite-hybrid")).toBe(true);

		await expect.poll(() => mapInstance.setStyle.mock.calls.length).toBe(1);
		expect(mapInstance.setStyle).toHaveBeenCalledWith(
			"https://api.maptiler.com/maps/hybrid/style.json?key=maptiler-test-key",
		);
		expect(mapMock).toHaveBeenCalledTimes(1);
	});

	it("handles constructor failures without throwing unhandled rejections", async () => {
		mapMock.mockImplementationOnce(() => {
			throw new Error("WebGL unavailable");
		});

		const view = render(MapView);

		await expect
			.element(page.getByRole("region", { name: "Route map" }))
			.toBeInTheDocument();
		await expect.poll(() => consoleError.mock.calls.length).toBe(1);
		await expect
			.element(page.getByRole("region", { name: "Route map" }))
			.toHaveAttribute("aria-busy", "false");

		expect(consoleError.mock.calls[0]?.[0]).toBe(
			"Failed to initialize MapLibre map",
		);
		expect(mapInstance.remove).not.toHaveBeenCalled();

		await view.unmount();
	});
});
