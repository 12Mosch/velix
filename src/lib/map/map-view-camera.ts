import type { LngLatBoundsLike } from "maplibre-gl";

import {
	areMapCameraPreferencesEqual,
	type MapCameraPreference,
} from "$lib/preferences/map-camera-preferences";
import type { RouteBounds } from "$lib/route-planning";

export const defaultCenter = [11.394, 47.268] as [number, number];
export const defaultZoom = 10;
export const defaultBearing = 0;
export const defaultPitch = 0;
export const mapCameraPreferenceDebounceMs = 100;

type ReadableMapCamera = {
	getCenter(): { lng: number; lat: number };
	getZoom(): number;
	getBearing(): number;
	getPitch(): number;
};

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export function isValidLngLat(value: unknown): value is [number, number] {
	if (!Array.isArray(value) || value.length !== 2) {
		return false;
	}

	const [lng, lat] = value;

	return (
		isFiniteNumber(lng) &&
		lng >= -180 &&
		lng <= 180 &&
		isFiniteNumber(lat) &&
		lat >= -90 &&
		lat <= 90
	);
}

function isValidRouteBounds(value: unknown): value is RouteBounds {
	if (!Array.isArray(value) || value.length !== 4) {
		return false;
	}

	const [minLng, minLat, maxLng, maxLat] = value;

	return (
		isValidLngLat([minLng, minLat]) &&
		isValidLngLat([maxLng, maxLat]) &&
		minLng <= maxLng &&
		minLat <= maxLat
	);
}

export function resolveRouteBounds(bounds: RouteBounds | null) {
	return isValidRouteBounds(bounds) ? bounds : null;
}

export function getBoundsKey(bounds: RouteBounds | null) {
	return resolveRouteBounds(bounds)?.join(",") ?? null;
}

export function getFitPadding() {
	if (typeof window === "undefined") {
		return 48;
	}

	const getBottomPadding = (topPadding: number, desiredPadding: number) => {
		const minimumVisibleMapHeight = window.innerWidth >= 768 ? 180 : 150;
		const maximumBottomPadding = Math.max(
			96,
			window.innerHeight - topPadding - minimumVisibleMapHeight,
		);

		return Math.min(desiredPadding, maximumBottomPadding);
	};

	if (window.innerWidth >= 768) {
		const top = 84;

		return {
			top,
			right: 48,
			bottom: getBottomPadding(top, 360),
			left: 420,
		};
	}

	const top = 88;

	return {
		top,
		right: 24,
		bottom: getBottomPadding(top, 380),
		left: 24,
	};
}

export function getFitBoundsOptions() {
	return {
		padding: getFitPadding(),
		duration: 700,
		maxZoom: 14,
	};
}

function isValidMapZoom(value: unknown): value is number {
	return isFiniteNumber(value) && value >= 0 && value <= 24;
}

function isValidMapBearing(value: unknown): value is number {
	return isFiniteNumber(value) && value >= -360 && value <= 360;
}

function isValidMapPitch(value: unknown): value is number {
	return isFiniteNumber(value) && value >= 0 && value <= 85;
}

export function resolveMapCenter(
	cameraCenter: unknown,
	initialCenter: unknown,
): [number, number] {
	if (isValidLngLat(cameraCenter)) {
		return cameraCenter;
	}

	if (isValidLngLat(initialCenter)) {
		return initialCenter;
	}

	return defaultCenter;
}

export function resolveMapZoom(cameraZoom: unknown, initialZoom: unknown) {
	if (isValidMapZoom(cameraZoom)) {
		return cameraZoom;
	}

	if (isValidMapZoom(initialZoom)) {
		return initialZoom;
	}

	return defaultZoom;
}

export function resolveMapBearing(cameraBearing: unknown) {
	return isValidMapBearing(cameraBearing) ? cameraBearing : defaultBearing;
}

export function resolveMapPitch(cameraPitch: unknown) {
	return isValidMapPitch(cameraPitch) ? cameraPitch : defaultPitch;
}

export function getCurrentMapCameraPreference(
	map: ReadableMapCamera,
): MapCameraPreference | null {
	const center = map.getCenter();
	const cameraCenter = [center.lng, center.lat] as [number, number];

	if (!isValidLngLat(cameraCenter)) {
		return null;
	}

	const zoom = map.getZoom();
	const bearing = map.getBearing();
	const pitch = map.getPitch();

	if (
		!isValidMapZoom(zoom) ||
		!isValidMapBearing(bearing) ||
		!isValidMapPitch(pitch)
	) {
		return null;
	}

	return {
		center: cameraCenter,
		zoom,
		bearing,
		pitch,
	};
}

export function shouldPersistMapCameraPreference(
	lastPersistedCameraPreference: MapCameraPreference | null,
	currentCamera: MapCameraPreference,
) {
	return !areMapCameraPreferencesEqual(
		lastPersistedCameraPreference,
		currentCamera,
	);
}

export function asLngLatBounds(bounds: RouteBounds): LngLatBoundsLike {
	return bounds as LngLatBoundsLike;
}
