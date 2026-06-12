export const maxRoutePoints = 5;
export const maxWaypoints = maxRoutePoints - 2;
export const maxRouteRequestBodyBytes = 128 * 1024;
export const minRoundCourseDurationMs = 15 * 60 * 1000;
export const minRoundCourseAscendMeters = 50;
export const minRoundCourseDistanceMeters = 10_000;
export const minAreaRadiusMeters = 1_000;
export const maxAreaRadiusMeters = 250_000;
export const minCorridorWidthMeters = 2_000;
export const maxCorridorWidthMeters = 80_000;
export const maxRouteAvoidances = 5;
export const minRouteAvoidanceCenterlinePoints = 2;
export const maxRouteAvoidanceCenterlinePoints = 32;
export const defaultRouteAvoidanceBufferMeters = 35;
export const minRouteAvoidanceBufferMeters = 10;
export const maxRouteAvoidanceBufferMeters = 150;

export function getTooManyWaypointsMessage() {
	return `You can add up to ${maxWaypoints} waypoints per route.`;
}

export function getRouteRequestTooLargeMessage() {
	return "Route request payload is too large.";
}
