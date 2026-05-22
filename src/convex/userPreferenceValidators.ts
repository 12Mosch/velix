import { v } from "convex/values";

import {
	basemapIdValues,
	distanceUnitValues,
	themeModeValues,
	type BasemapId,
	type DistanceUnit,
	type ThemeMode,
} from "../lib/preferences/user-preference-values";

function literalUnion<const Values extends readonly [string, ...string[]]>(
	values: Values,
) {
	const validators = values.map((value) => v.literal(value)) as [
		ReturnType<typeof v.literal<Values[number]>>,
		...Array<ReturnType<typeof v.literal<Values[number]>>>,
	];

	return v.union(...validators);
}

export const themeModeValidator = literalUnion(themeModeValues);
export const mapStyleValidator = literalUnion(basemapIdValues);
export const distanceUnitValidator = literalUnion(distanceUnitValues);

export const optionalThemeModeValidator = v.optional(themeModeValidator);
export const optionalMapStyleValidator = v.optional(mapStyleValidator);
export const optionalDistanceUnitValidator = v.optional(distanceUnitValidator);

export const userPreferencesPatchValidator = v.object({
	themeMode: optionalThemeModeValidator,
	mapStyle: optionalMapStyleValidator,
	distanceUnit: optionalDistanceUnitValidator,
});

export type { BasemapId, DistanceUnit, ThemeMode };
