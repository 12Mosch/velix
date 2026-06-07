import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import {
	MAP_CAMERA_STORAGE_KEY,
	areMapCameraPreferencesEqual,
	type MapCameraPreference,
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
	it("compares identical camera values as equal", () => {
		expect(
			areMapCameraPreferencesEqual(
				{
					center: [11.57, 48.13],
					zoom: 12.5,
					bearing: 15,
					pitch: 35,
				},
				{
					center: [11.57, 48.13],
					zoom: 12.5,
					bearing: 15,
					pitch: 35,
				},
			),
		).toBe(true);
	});

	it("compares changed camera values as different", () => {
		const camera: MapCameraPreference = {
			center: [11.57, 48.13],
			zoom: 12.5,
			bearing: 15,
			pitch: 35,
		};

		expect(
			areMapCameraPreferencesEqual(camera, {
				...camera,
				center: [11.58, 48.13],
			}),
		).toBe(false);
		expect(
			areMapCameraPreferencesEqual(camera, {
				...camera,
				zoom: 13,
			}),
		).toBe(false);
		expect(
			areMapCameraPreferencesEqual(camera, {
				...camera,
				bearing: 20,
			}),
		).toBe(false);
		expect(
			areMapCameraPreferencesEqual(camera, {
				...camera,
				pitch: 40,
			}),
		).toBe(false);
	});

	it("compares nullish camera values as different", () => {
		const camera: MapCameraPreference = {
			center: [11.57, 48.13],
			zoom: 12.5,
			bearing: 15,
			pitch: 35,
		};

		expect(areMapCameraPreferencesEqual(null, camera)).toBe(false);
		expect(areMapCameraPreferencesEqual(camera, null)).toBe(false);
		expect(areMapCameraPreferencesEqual(undefined, camera)).toBe(false);
		expect(areMapCameraPreferencesEqual(camera, undefined)).toBe(false);
	});

	it("returns a valid stored camera", () => {
		const storage = createStorage(
			JSON.stringify({
				center: [11.57, 48.13],
				zoom: 12.5,
				bearing: 15,
				pitch: 35,
			}),
		);

		expect(Effect.runSync(readMapCameraPreference(storage))).toEqual({
			center: [11.57, 48.13],
			zoom: 12.5,
			bearing: 15,
			pitch: 35,
		});
		expect(storage.removeItem).not.toHaveBeenCalled();
	});

	it("ignores and clears invalid stored camera values", () => {
		const invalidJsonStorage = createStorage("{bad json");
		expect(
			Effect.runSync(readMapCameraPreference(invalidJsonStorage)),
		).toBeNull();
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
		expect(
			Effect.runSync(readMapCameraPreference(outOfRangeStorage)),
		).toBeNull();
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
		expect(
			Effect.runSync(readMapCameraPreference(extraCenterValueStorage)),
		).toBeNull();
		expect(extraCenterValueStorage.removeItem).toHaveBeenCalledWith(
			MAP_CAMERA_STORAGE_KEY,
		);
	});

	it("writes the expected JSON shape", () => {
		const storage = createStorage(null);

		Effect.runSync(
			writeMapCameraPreference(storage, {
				center: [11.57, 48.13],
				zoom: 12.5,
				bearing: 15,
				pitch: 35,
			}),
		);

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
