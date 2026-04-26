import { browser } from "$app/environment";

export const DISTANCE_UNIT_STORAGE_KEY = "velix.distanceUnit";
export type DistanceUnit = "km" | "mi";

const metersPerMile = 1609.344;
const fallbackDistanceUnit: DistanceUnit = "km";

function isDistanceUnit(value: string | null): value is DistanceUnit {
	return value === "km" || value === "mi";
}

function metersToSelectedUnit(meters: number): number {
	return unitPreference.selectedDistanceUnit === "mi"
		? meters / metersPerMile
		: meters / 1000;
}

class UnitPreferenceState {
	initialized = $state(false);
	selectedDistanceUnit = $state<DistanceUnit>(fallbackDistanceUnit);

	initUnitPreference(): DistanceUnit {
		if (!browser) {
			return this.selectedDistanceUnit;
		}

		if (this.initialized) {
			return this.selectedDistanceUnit;
		}

		this.initialized = true;

		const storedDistanceUnit = window.localStorage.getItem(
			DISTANCE_UNIT_STORAGE_KEY,
		);
		const nextDistanceUnit = isDistanceUnit(storedDistanceUnit)
			? storedDistanceUnit
			: fallbackDistanceUnit;

		this.selectedDistanceUnit = nextDistanceUnit;
		window.localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, nextDistanceUnit);

		return nextDistanceUnit;
	}

	setDistanceUnitPreference(unit: DistanceUnit): boolean {
		if (!isDistanceUnit(unit)) {
			return false;
		}

		this.selectedDistanceUnit = unit;

		if (browser) {
			window.localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, unit);
		}

		return true;
	}

	resetUnitPreferenceForTests() {
		this.initialized = false;
		this.selectedDistanceUnit = fallbackDistanceUnit;

		if (browser) {
			window.localStorage.removeItem(DISTANCE_UNIT_STORAGE_KEY);
		}
	}
}

export const unitPreference = new UnitPreferenceState();

export function initUnitPreference(): DistanceUnit {
	return unitPreference.initUnitPreference();
}

export function setDistanceUnitPreference(unit: DistanceUnit): boolean {
	return unitPreference.setDistanceUnitPreference(unit);
}

export function resetUnitPreferenceForTests() {
	unitPreference.resetUnitPreferenceForTests();
}

export function getDistanceUnitLabel(): DistanceUnit {
	return unitPreference.selectedDistanceUnit;
}

export function getMapLibreScaleUnit(): "metric" | "imperial" {
	return unitPreference.selectedDistanceUnit === "mi" ? "imperial" : "metric";
}

export function formatDistanceValue(
	meters: number,
	options: { fractionDigits?: number } = {},
): string {
	const fractionDigits = options.fractionDigits ?? 1;
	return metersToSelectedUnit(meters).toFixed(fractionDigits);
}

export function formatDistance(
	meters: number,
	options: { fractionDigits?: number } = {},
): string {
	return `${formatDistanceValue(meters, options)} ${getDistanceUnitLabel()}`;
}

export function formatDistanceInput(
	distanceMeters: number | null | undefined,
): string {
	if (distanceMeters == null || !Number.isFinite(distanceMeters)) {
		return "";
	}

	return Number(metersToSelectedUnit(distanceMeters).toFixed(2)).toString();
}

export function parseDistanceInputToMeters(value: string): number | null {
	const trimmedValue = value.trim();

	if (!trimmedValue) {
		return null;
	}

	const numericValue = Number(trimmedValue.replace(",", "."));

	if (!Number.isFinite(numericValue) || numericValue < 0) {
		return null;
	}

	if (unitPreference.selectedDistanceUnit === "mi") {
		return numericValue * metersPerMile;
	}

	return numericValue * 1000;
}
