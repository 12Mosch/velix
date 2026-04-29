import type { PreferenceRepository } from "$lib/preferences/preference-repository";

export const DISTANCE_UNIT_STORAGE_KEY = "velix.distanceUnit";
export type DistanceUnit = "km" | "mi";

const metersPerMile = 1609.344;
export const fallbackDistanceUnit: DistanceUnit = "km";

export function isDistanceUnit(value: string | null): value is DistanceUnit {
	return value === "km" || value === "mi";
}

export function initDistanceUnitPreference(
	repository: PreferenceRepository<DistanceUnit>,
): DistanceUnit {
	const storedDistanceUnit = repository.read();
	const nextDistanceUnit = isDistanceUnit(storedDistanceUnit)
		? storedDistanceUnit
		: fallbackDistanceUnit;

	repository.write(nextDistanceUnit);
	return nextDistanceUnit;
}

export function setDistanceUnitPreference(
	repository: PreferenceRepository<DistanceUnit>,
	unit: DistanceUnit,
): DistanceUnit | null {
	if (!isDistanceUnit(unit)) {
		return null;
	}

	repository.write(unit);
	return unit;
}

export function metersToDistanceUnit(
	meters: number,
	selectedDistanceUnit: DistanceUnit,
): number {
	return selectedDistanceUnit === "mi" ? meters / metersPerMile : meters / 1000;
}

export function getMapLibreScaleUnit(
	selectedDistanceUnit: DistanceUnit,
): "metric" | "imperial" {
	return selectedDistanceUnit === "mi" ? "imperial" : "metric";
}

export function formatDistanceValue(
	meters: number,
	selectedDistanceUnit: DistanceUnit,
	options: { fractionDigits?: number } = {},
): string {
	const fractionDigits = options.fractionDigits ?? 1;
	return metersToDistanceUnit(meters, selectedDistanceUnit).toFixed(
		fractionDigits,
	);
}

export function formatDistance(
	meters: number,
	selectedDistanceUnit: DistanceUnit,
	options: { fractionDigits?: number } = {},
): string {
	return `${formatDistanceValue(meters, selectedDistanceUnit, options)} ${selectedDistanceUnit}`;
}

export function formatDistanceInput(
	distanceMeters: number | null | undefined,
	selectedDistanceUnit: DistanceUnit,
): string {
	if (distanceMeters == null || !Number.isFinite(distanceMeters)) {
		return "";
	}

	return Number(
		metersToDistanceUnit(distanceMeters, selectedDistanceUnit).toFixed(2),
	).toString();
}

export function parseDistanceInputToMeters(
	value: string,
	selectedDistanceUnit: DistanceUnit,
): number | null {
	const trimmedValue = value.trim();

	if (!trimmedValue) {
		return null;
	}

	const numericValue = Number(trimmedValue.replace(",", "."));

	if (!Number.isFinite(numericValue) || numericValue < 0) {
		return null;
	}

	if (selectedDistanceUnit === "mi") {
		return numericValue * metersPerMile;
	}

	return numericValue * 1000;
}
