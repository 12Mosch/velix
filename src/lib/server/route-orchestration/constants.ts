export const desiredAlternativeRoutes = 3;
export const alternativeRouteMaxWeightFactor = 1.4;
export const alternativeRouteMaxShareFactor = 0.6;
export const roundCourseDistanceSearchMultipliers = [0.9, 1, 1.1] as const;
export const broadRoundCourseSearchMultipliers = [0.75, 1, 1.25] as const;
export const tightRoundCourseSearchMultipliers = [0.9, 1, 1.1] as const;
export const roundCourseSearchSeeds = [
	[11, 37, 73],
	[109, 149, 191],
	[233, 277, 331],
] as const;
export const minRoundCourseDistanceMeters = 10_000;
export const maxRoundCourseDistanceMeters = 220_000;
export const durationTargetSpeedMetersPerHour = 22_000;
export const ascendTargetMetersPerKm = 12;
export const areaPolygonSegments = 48;
export const earthRadiusMeters = 6_371_008.8;
export const windUnavailableWarning =
	"Wind data is temporarily unavailable, so wind analysis was skipped.";
