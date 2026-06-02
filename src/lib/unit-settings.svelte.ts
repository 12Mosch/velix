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
import { Effect } from "effect";

export { DISTANCE_UNIT_STORAGE_KEY, type DistanceUnit };

const distanceUnitRepository = createPreferenceRepository<DistanceUnit>(
	Effect.runSync(createBrowserStorage()),
	DISTANCE_UNIT_STORAGE_KEY,
);

class UnitPreferenceState {
	initialized = $state(false);
	selectedDistanceUnit = $state<DistanceUnit>(fallbackDistanceUnit);

	initUnitPreference() {
		const state = this;
		return Effect.gen(function* () {
			if (state.initialized) {
				return state.selectedDistanceUnit;
			}

			state.selectedDistanceUnit = yield* initDistanceUnitPreference(
				distanceUnitRepository,
			);
			state.initialized = true;

			return state.selectedDistanceUnit;
		});
	}

	setDistanceUnitPreference(unit: DistanceUnit) {
		return setDistanceUnitPreferenceValue(distanceUnitRepository, unit).pipe(
			Effect.map((nextDistanceUnit) => {
				if (!nextDistanceUnit) {
					return false;
				}

				this.selectedDistanceUnit = nextDistanceUnit;
				return true;
			}),
		);
	}

	applyRemoteDistanceUnitPreference(unit: DistanceUnit) {
		return setDistanceUnitPreferenceValue(distanceUnitRepository, unit).pipe(
			Effect.map((nextDistanceUnit) => {
				if (!nextDistanceUnit) {
					return null;
				}

				this.selectedDistanceUnit = nextDistanceUnit;
				this.initialized = true;
				return nextDistanceUnit;
			}),
		);
	}

	resetUnitPreferenceForTests() {
		return distanceUnitRepository.clear().pipe(
			Effect.tap(() =>
				Effect.sync(() => {
					this.initialized = false;
					this.selectedDistanceUnit = fallbackDistanceUnit;
				}),
			),
		);
	}
}

export const unitPreference = new UnitPreferenceState();

export function initUnitPreference() {
	return unitPreference.initUnitPreference();
}

export function setDistanceUnitPreference(unit: DistanceUnit) {
	return unitPreference.setDistanceUnitPreference(unit);
}

export function applyRemoteDistanceUnitPreference(unit: DistanceUnit) {
	return unitPreference.applyRemoteDistanceUnitPreference(unit);
}

export function resetUnitPreferenceForTests() {
	return unitPreference.resetUnitPreferenceForTests();
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
