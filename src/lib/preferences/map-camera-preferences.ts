import type { BrowserStorage } from "$lib/storage/browser-storage";

export const MAP_CAMERA_STORAGE_KEY = "velix.mapCamera";

export type MapCameraPreference = {
	center: [number, number];
	zoom: number;
	bearing: number;
	pitch: number;
};

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isValidCamera(value: unknown): value is MapCameraPreference {
	if (!value || typeof value !== "object") {
		return false;
	}

	const camera = value as Partial<MapCameraPreference>;
	if (!Array.isArray(camera.center) || camera.center.length !== 2) {
		return false;
	}

	const [lng, lat] = camera.center;

	return (
		isFiniteNumber(lng) &&
		lng >= -180 &&
		lng <= 180 &&
		isFiniteNumber(lat) &&
		lat >= -90 &&
		lat <= 90 &&
		isFiniteNumber(camera.zoom) &&
		camera.zoom >= 0 &&
		camera.zoom <= 24 &&
		isFiniteNumber(camera.bearing) &&
		camera.bearing >= -360 &&
		camera.bearing <= 360 &&
		isFiniteNumber(camera.pitch) &&
		camera.pitch >= 0 &&
		camera.pitch <= 85
	);
}

export function readMapCameraPreference(
	storage: BrowserStorage | null,
): MapCameraPreference | null {
	const storedValue = storage?.getItem(MAP_CAMERA_STORAGE_KEY);

	if (!storedValue) {
		return null;
	}

	try {
		const parsed = JSON.parse(storedValue) as unknown;

		if (isValidCamera(parsed)) {
			return parsed;
		}
	} catch {
		// Invalid preference payloads are cleared below.
	}

	storage?.removeItem(MAP_CAMERA_STORAGE_KEY);
	return null;
}

export function writeMapCameraPreference(
	storage: BrowserStorage | null,
	camera: MapCameraPreference,
) {
	if (!isValidCamera(camera)) {
		return;
	}

	storage?.setItem(MAP_CAMERA_STORAGE_KEY, JSON.stringify(camera));
}
