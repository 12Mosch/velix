import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_MAPTILER_API_KEY: "",
		PUBLIC_STADIA_MAPS_API_KEY: "",
	},
}));

import MapView from "./map-view.svelte";
import { resetMapStylePreferenceForTests } from "$lib/map-style-settings.svelte";

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

	return {
		Map: mapMock,
		default: {
			Map: mapMock,
		},
	};
});

describe("MapView without configured providers", () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetMapStylePreferenceForTests();
		mapMock.mockClear();
	});

	it("renders a clear error instead of creating a map", async () => {
		const view = render(MapView);

		await expect
			.element(page.getByRole("region", { name: "Route map" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("No map styles configured"))
			.toBeInTheDocument();
		expect(mapMock).not.toHaveBeenCalled();

		await view.unmount();
	});
});
