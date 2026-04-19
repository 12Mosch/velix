import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import PageTestShell from "./page-test-shell.svelte";

const { mapInstance, mapMock } = vi.hoisted(() => {
	return {
		mapInstance: {
			once: vi.fn(),
			remove: vi.fn(),
			resize: vi.fn(),
		},
		mapMock: vi.fn((_options: unknown) => {}),
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

describe("+page.svelte", () => {
	beforeEach(() => {
		mapMock.mockClear();
		mapInstance.once.mockClear();
		mapInstance.remove.mockClear();
		mapInstance.resize.mockClear();
	});

	it("renders the live map layer instead of the decorative mock map", async () => {
		render(PageTestShell);

		await expect
			.element(page.getByRole("region", { name: "Route map" }))
			.toBeInTheDocument();
		await expect.element(page.getByText("Basemap by")).toBeInTheDocument();
		await expect.poll(() => mapMock.mock.calls.length).toBe(1);

		expect(
			document.querySelector('path[d*="M 0 50 C 20 20, 40 80, 60 40"]'),
		).toBeNull();
	});
});
