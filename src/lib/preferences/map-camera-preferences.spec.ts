import { describe, expect, it, vi } from "vitest";

import {
	MAP_CAMERA_STORAGE_KEY,
	readMapCameraPreference,
	writeMapCameraPreference,
} from "$lib/preferences/map-camera-preferences";
import type { BrowserStorage } from "$lib/storage/browser-storage";

function createStorage(value: string | null): BrowserStorage {
	let currentValue = value;

	return {
		getItem: vi.fn(() => currentValue),
		setItem: vi.fn((_key: string, nextValue: string) => {
			currentValue = nextValue;
		}),
		removeItem: vi.fn(() => {
			currentValue = null;
		}),
	};
}

describe("map camera preferences", () => {
	it("returns a valid stored camera", () => {
		const storage = createStorage(
			JSON.stringify({
				center: [11.57, 48.13],
				zoom: 12.5,
				bearing: 15,
				pitch: 35,
			}),
		);

		expect(readMapCameraPreference(storage)).toEqual({
			center: [11.57, 48.13],
			zoom: 12.5,
			bearing: 15,
			pitch: 35,
		});
		expect(storage.removeItem).not.toHaveBeenCalled();
	});

	it("ignores and clears invalid stored camera values", () => {
		const invalidJsonStorage = createStorage("{bad json");
		expect(readMapCameraPreference(invalidJsonStorage)).toBeNull();
		expect(invalidJsonStorage.removeItem).toHaveBeenCalledWith(
			MAP_CAMERA_STORAGE_KEY,
		);

		const outOfRangeStorage = createStorage(
			JSON.stringify({
				center: [11.57, 98],
				zoom: 12,
				bearing: 0,
				pitch: 0,
			}),
		);
		expect(readMapCameraPreference(outOfRangeStorage)).toBeNull();
		expect(outOfRangeStorage.removeItem).toHaveBeenCalledWith(
			MAP_CAMERA_STORAGE_KEY,
		);

		const extraCenterValueStorage = createStorage(
			JSON.stringify({
				center: [11.57, 48.13, 1],
				zoom: 12,
				bearing: 0,
				pitch: 0,
			}),
		);
		expect(readMapCameraPreference(extraCenterValueStorage)).toBeNull();
		expect(extraCenterValueStorage.removeItem).toHaveBeenCalledWith(
			MAP_CAMERA_STORAGE_KEY,
		);
	});

	it("writes the expected JSON shape", () => {
		const storage = createStorage(null);

		writeMapCameraPreference(storage, {
			center: [11.57, 48.13],
			zoom: 12.5,
			bearing: 15,
			pitch: 35,
		});

		expect(storage.setItem).toHaveBeenCalledWith(
			MAP_CAMERA_STORAGE_KEY,
			JSON.stringify({
				center: [11.57, 48.13],
				zoom: 12.5,
				bearing: 15,
				pitch: 35,
			}),
		);
	});
});
