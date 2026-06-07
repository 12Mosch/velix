import type { BrowserStorage } from "$lib/storage/browser-storage";
import { Data, Effect } from "effect";

export const MAP_CAMERA_STORAGE_KEY = "velix.mapCamera";

export type MapCameraPreference = {
	center: [number, number];
	zoom: number;
	bearing: number;
	pitch: number;
};

type MapCameraPreferenceOperation = "read" | "write" | "clearInvalid";

export class MapCameraPreferenceError extends Data.TaggedError(
	"MapCameraPreferenceError",
)<{
	readonly operation: MapCameraPreferenceOperation;
	readonly cause: unknown;
}> {}

function cameraPreferenceError(
	operation: MapCameraPreferenceOperation,
	cause: unknown,
) {
	return new MapCameraPreferenceError({ operation, cause });
}

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

export function areMapCameraPreferencesEqual(
	left: MapCameraPreference | null | undefined,
	right: MapCameraPreference | null | undefined,
): boolean {
	if (!left || !right) {
		return false;
	}

	return (
		left.center[0] === right.center[0] &&
		left.center[1] === right.center[1] &&
		left.zoom === right.zoom &&
		left.bearing === right.bearing &&
		left.pitch === right.pitch
	);
}

export const readMapCameraPreference = Effect.fn("readMapCameraPreference")(
	function* (
		storage: BrowserStorage | null,
	): Effect.fn.Return<MapCameraPreference | null, MapCameraPreferenceError> {
		const storedValue = yield* Effect.try({
			try: () => storage?.getItem(MAP_CAMERA_STORAGE_KEY),
			catch: (cause) => cameraPreferenceError("read", cause),
		});

		if (!storedValue) {
			return null;
		}

		const parsed = yield* Effect.try({
			try: () => JSON.parse(storedValue) as unknown,
			catch: () => null,
		}).pipe(Effect.orElseSucceed(() => null));

		if (isValidCamera(parsed)) {
			return parsed;
		}

		yield* Effect.try({
			try: () => storage?.removeItem(MAP_CAMERA_STORAGE_KEY),
			catch: (cause) => cameraPreferenceError("clearInvalid", cause),
		}).pipe(
			Effect.catch((error) =>
				Effect.sync(() => {
					console.error("Failed to clear invalid map camera preference", error);
				}),
			),
		);
		return null;
	},
);

export const writeMapCameraPreference = Effect.fn("writeMapCameraPreference")(
	function* (
		storage: BrowserStorage | null,
		camera: MapCameraPreference,
	): Effect.fn.Return<void, MapCameraPreferenceError> {
		if (!isValidCamera(camera)) {
			return;
		}

		yield* Effect.try({
			try: () =>
				storage?.setItem(MAP_CAMERA_STORAGE_KEY, JSON.stringify(camera)),
			catch: (cause) => cameraPreferenceError("write", cause),
		});
	},
);
