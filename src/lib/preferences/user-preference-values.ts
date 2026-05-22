export const themeModeValues = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof themeModeValues)[number];

export const basemapIdValues = [
	"stadia-alidade-smooth",
	"stadia-alidade-smooth-dark",
	"stadia-stamen-terrain",
	"maptiler-satellite-hybrid",
	"maptiler-outdoor",
] as const;
export type BasemapId = (typeof basemapIdValues)[number];

export const distanceUnitValues = ["km", "mi"] as const;
export type DistanceUnit = (typeof distanceUnitValues)[number];

const themeModeValueSet = new Set<string>(themeModeValues);
const basemapIdValueSet = new Set<string>(basemapIdValues);
const distanceUnitValueSet = new Set<string>(distanceUnitValues);

export function isThemeMode(value: string | null): value is ThemeMode {
	return value !== null && themeModeValueSet.has(value);
}

export function isBasemapIdValue(value: string | null): value is BasemapId {
	return value !== null && basemapIdValueSet.has(value);
}

export function isDistanceUnit(value: string | null): value is DistanceUnit {
	return value !== null && distanceUnitValueSet.has(value);
}
