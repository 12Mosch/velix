import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import MapView from "./map-view.svelte";

type MockMapOptions = {
	attributionControl: boolean;
	center: [number, number];
	container: HTMLElement;
	style: {
		sources: {
			osm: {
				tiles: string[];
			};
		};
	};
	zoom: number;
};

const { mapInstance, mapMock } = vi.hoisted(() => {
	return {
		mapInstance: {
			once: vi.fn(),
			remove: vi.fn(),
			resize: vi.fn(),
		},
		mapMock: vi.fn((_options: MockMapOptions) => {}),
	};
});

vi.mock("maplibre-gl", () => {
	mapMock.mockImplementation(() => mapInstance);
	mapInstance.once.mockImplementation((event: string, callback: () => void) => {
		if (event === "load") callback();
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
		mapMock.mockClear();
		mapMock.mockImplementation(() => mapInstance);
		mapInstance.once.mockClear();
		mapInstance.remove.mockClear();
		mapInstance.resize.mockClear();
		consoleError.mockClear();
	});

	it("creates a map with the expected viewport and tears it down", async () => {
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
		expect(options.style.sources.osm.tiles).toEqual([
			"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
		]);
		expect(options.container).toBeInstanceOf(HTMLElement);

		await view.unmount();

		expect(mapInstance.remove).toHaveBeenCalledTimes(1);
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
