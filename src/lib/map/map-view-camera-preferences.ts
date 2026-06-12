import { Effect } from "effect";
import type { Map as MapLibreMap } from "maplibre-gl";

import {
	type MapCameraPreference,
	readMapCameraPreference,
	writeMapCameraPreference,
} from "$lib/preferences/map-camera-preferences";
import { createBrowserStorage } from "$lib/storage/browser-storage";

const cameraPreferenceEvents = [
	"moveend",
	"zoomend",
	"rotateend",
	"pitchend",
] as const;

export function readStoredMapCameraPreference() {
	return (
		Effect.runSync(
			Effect.gen(function* () {
				const storage = yield* createBrowserStorage();
				return yield* readMapCameraPreference(storage);
			}),
		) ?? undefined
	);
}

export function writeStoredMapCameraPreference(
	camera: MapCameraPreference,
): void {
	Effect.runSync(
		Effect.gen(function* () {
			const storage = yield* createBrowserStorage();
			yield* writeMapCameraPreference(storage, camera);
		}),
	);
}

export function attachMapCameraPreferenceListeners(
	map: MapLibreMap | null,
	onCameraChange: () => void,
) {
	if (!map || typeof map.on !== "function" || typeof map.off !== "function") {
		return () => {};
	}

	for (const event of cameraPreferenceEvents) {
		map.on(event, onCameraChange);
	}

	return () => {
		if (!map || typeof map.off !== "function") {
			return;
		}

		for (const event of cameraPreferenceEvents) {
			map.off(event, onCameraChange);
		}
	};
}
