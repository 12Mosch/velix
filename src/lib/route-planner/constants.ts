import type { SpatialConstraintEnforcement } from "$lib/route-planning";
import type { CompletionTarget, PlannerMode } from "./types";

export const chartW = 800;
export const padY = 5;
export const maxRoutePoints = 5;
export const maxWaypoints = maxRoutePoints - 2;
export const maxGpxImportBytes = 2 * 1024 * 1024;
export const maxGpxGeometryPoints = 20_000;
export const minCompletionQueryLength = 3;
export const completionDebounceMs = 250;
export const desiredAlternativeRoutes = 3;
export const maxRouteEditHistoryEntries = 50;
export const maxRouteEditGeometryHistoryEntries = 5;
export const gpxFileAccept =
	".gpx,application/gpx+xml,application/xml,text/xml";
export const defaultAreaRadiusMeters = 30_000;
export const defaultCorridorWidthMeters = 10_000;
export const minRoundCourseDistanceMeters = 10_000;
export const minAreaRadiusMeters = 1_000;
export const maxAreaRadiusMeters = 250_000;
export const areaRadiusStepMeters = 1_000;
export const minCorridorWidthMeters = 2_000;
export const maxCorridorWidthMeters = 80_000;
export const corridorWidthStepMeters = 1_000;
export const defaultSpatialConstraintEnforcement: SpatialConstraintEnforcement =
	"strict";

export function formatGpxImportByteLimit(bytes = maxGpxImportBytes) {
	return `${Math.round(bytes / 1024 / 1024)} MiB`;
}

export function formatGpxGeometryPointLimit(points = maxGpxGeometryPoints) {
	return points.toLocaleString("en-US");
}

export const startCompletionTarget: CompletionTarget = { kind: "startQuery" };
export const destinationCompletionTarget: CompletionTarget = {
	kind: "destinationQuery",
};
export const constraintCenterCompletionTarget: CompletionTarget = {
	kind: "constraintCenter",
};

export const plannerModeOptions: Array<{
	mode: PlannerMode;
	label: string;
	description: string;
}> = [
	{
		mode: "point_to_point",
		label: "Point to point",
		description: "Start, optional waypoints, and a destination.",
	},
	{
		mode: "round_course",
		label: "Round course",
		description: "Loop from one start point with a target ride distance.",
	},
	{
		mode: "out_and_back",
		label: "Out and back",
		description: "Start, turnaround, then return on the same road.",
	},
];
