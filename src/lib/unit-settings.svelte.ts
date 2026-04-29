import {
	DISTANCE_UNIT_STORAGE_KEY,
	type DistanceUnit,
	fallbackDistanceUnit,
	formatDistance as formatDistanceForUnit,
	formatDistanceInput as formatDistanceInputForUnit,
	formatDistanceValue as formatDistanceValueForUnit,
	getMapLibreScaleUnit as getMapLibreScaleUnitForUnit,
	initDistanceUnitPreference,
	parseDistanceInputToMeters as parseDistanceInputToMetersForUnit,
	setDistanceUnitPreference as setDistanceUnitPreferenceValue,
} from "$lib/preferences/distance-unit-preferences";
import { createPreferenceRepository } from "$lib/preferences/preference-repository";
import { createBrowserStorage } from "$lib/storage/browser-storage";

export { DISTANCE_UNIT_STORAGE_KEY, type DistanceUnit };

const distanceUnitRepository = createPreferenceRepository<DistanceUnit>(
	createBrowserStorage(),
	DISTANCE_UNIT_STORAGE_KEY,
);

class UnitPreferenceState {
	initialized = $state(false);
	selectedDistanceUnit = $state<DistanceUnit>(fallbackDistanceUnit);

	initUnitPreference(): DistanceUnit {
		if (this.initialized) {
			return this.selectedDistanceUnit;
		}

		this.initialized = true;
		this.selectedDistanceUnit = initDistanceUnitPreference(
			distanceUnitRepository,
		);

		return this.selectedDistanceUnit;
	}

	setDistanceUnitPreference(unit: DistanceUnit): boolean {
		const nextDistanceUnit = setDistanceUnitPreferenceValue(
			distanceUnitRepository,
			unit,
		);

		if (!nextDistanceUnit) {
			return false;
		}

		this.selectedDistanceUnit = nextDistanceUnit;
		return true;
	}

	resetUnitPreferenceForTests() {
		this.initialized = false;
		this.selectedDistanceUnit = fallbackDistanceUnit;
		distanceUnitRepository.clear();
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
	return getMapLibreScaleUnitForUnit(unitPreference.selectedDistanceUnit);
}

export function formatDistanceValue(
	meters: number,
	options: { fractionDigits?: number } = {},
): string {
	return formatDistanceValueForUnit(
		meters,
		unitPreference.selectedDistanceUnit,
		options,
	);
}

export function formatDistance(
	meters: number,
	options: { fractionDigits?: number } = {},
): string {
	return formatDistanceForUnit(
		meters,
		unitPreference.selectedDistanceUnit,
		options,
	);
}

export function formatDistanceInput(
	distanceMeters: number | null | undefined,
): string {
	return formatDistanceInputForUnit(
		distanceMeters,
		unitPreference.selectedDistanceUnit,
	);
}

export function parseDistanceInputToMeters(value: string): number | null {
	return parseDistanceInputToMetersForUnit(
		value,
		unitPreference.selectedDistanceUnit,
	);
}
