import type { PlannedRoute, RoundCourseTarget } from "$lib/route-planning";
import { isImportedRoute } from "$lib/route-planning";
import { formatDistance } from "$lib/unit-settings.svelte";

export function formatDuration(durationMs: number): string {
	const totalMinutes = Math.round(durationMs / 60000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	if (hours === 0) {
		return `${minutes} min`;
	}

	return `${hours}:${minutes.toString().padStart(2, "0")} h`;
}

export function formatWaypointSummary(
	waypoints: Array<{ label: string }>,
): string | null {
	if (waypoints.length === 0) {
		return null;
	}

	return `Via: ${waypoints.map((waypoint) => waypoint.label).join(" -> ")}`;
}

export function isRoundCourseRoute(route: { mode: string }): boolean {
	return route.mode === "round_course";
}

export function isOutAndBackRoute(route: { mode: string }): boolean {
	return route.mode === "out_and_back";
}

export function getRoundCourseTarget(
	route: PlannedRoute | null | undefined,
): RoundCourseTarget | null {
	if (!route || !isRoundCourseRoute(route)) {
		return null;
	}

	if (route.roundCourseTarget) {
		return route.roundCourseTarget;
	}

	if (
		typeof route.requestedDistanceMeters === "number" &&
		Number.isFinite(route.requestedDistanceMeters)
	) {
		return {
			kind: "distance",
			distanceMeters: route.requestedDistanceMeters,
		};
	}

	return null;
}

export function formatRoundCourseTarget(
	target: RoundCourseTarget | null | undefined,
): string {
	if (!target) {
		return "";
	}

	if (target.kind === "distance") {
		return formatDistance(target.distanceMeters);
	}

	if (target.kind === "duration") {
		return formatDuration(target.durationMs);
	}

	return `${Math.round(target.ascendMeters).toLocaleString()} m up`;
}

export function getRouteDurationText(
	route: PlannedRoute | null | undefined,
): string {
	if (!route) {
		return "";
	}

	if (isImportedRoute(route) && !route.source.hasDuration) {
		return "Time unavailable";
	}

	return formatDuration(route.durationMs);
}

export function getRouteLegText(route: PlannedRoute): string {
	if (isRoundCourseRoute(route)) {
		return "Returns to start";
	}

	if (isOutAndBackRoute(route)) {
		return `to ${route.destinationLabel} and back`;
	}

	return `to ${route.destinationLabel}`;
}

export function getRouteTitle(route: PlannedRoute): string {
	if (isRoundCourseRoute(route)) {
		return `${route.startLabel} loop`;
	}

	return `${route.startLabel} to ${route.destinationLabel}`;
}

export function formatElevationGain(meters: number): string {
	return `${Math.round(meters).toLocaleString()} m`;
}
