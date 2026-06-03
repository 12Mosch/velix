import { formatDistance, formatDistanceInput } from "$lib/unit-settings.svelte";
export {
	formatDuration,
	formatRoundCourseTarget,
	getRouteDurationText,
} from "$lib/route-display";
import {
	type RouteQualityBand,
	isImportedRoute,
	type PlannedRoute,
	type RouteClimb,
	type SpatialConstraintEnforcement,
	type WindDirectionBucket,
} from "$lib/route-planning";
import type { WorkoutTrainingSessionKind } from "$lib/workout-plan";

export function formatCoordinateLabel(point: [number, number]) {
	return `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
}

export function formatRoundCourseDurationInput(
	durationMs: number | undefined,
): string {
	if (!durationMs || !Number.isFinite(durationMs)) {
		return "";
	}

	const totalMinutes = Math.round(durationMs / 60000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

export function formatSpatialConstraintSummary(
	route: PlannedRoute,
): string | null {
	if (!route.spatialConstraint) {
		return null;
	}

	if (route.spatialConstraint.kind === "area") {
		return `Area: ${route.spatialConstraint.label}, ${formatDistance(route.spatialConstraint.radiusMeters)}`;
	}

	return `Corridor: ${formatDistance(route.spatialConstraint.widthMeters)}`;
}

export function formatSpatialConstraintEnforcement(
	enforcement: SpatialConstraintEnforcement,
): string {
	return enforcement === "strict" ? "Keep inside" : "Prefer inside";
}

export function formatDistanceInputAttribute(meters: number): string {
	return formatDistanceInput(meters);
}

export function formatExactDistance(meters: number): string {
	return formatDistance(meters, { fractionDigits: 2 });
}

export function formatElevation(meters: number): string {
	return `${Math.round(meters).toLocaleString()} m`;
}

export function formatGrade(percent: number): string {
	return `${percent.toFixed(1)}%`;
}

export function formatWindSpeed(kmh: number): string {
	return `${Math.round(kmh).toLocaleString()} km/h`;
}

export function formatWindBucket(bucket: WindDirectionBucket): string {
	if (bucket === "headwind") return "Headwind";
	if (bucket === "cross_headwind") return "Cross-headwind";
	if (bucket === "crosswind") return "Crosswind";
	if (bucket === "cross_tailwind") return "Cross-tailwind";
	return "Tailwind";
}

export function formatWindComponent(kmh: number): string {
	if (kmh === 0) {
		return "0 km/h neutral";
	}

	const rounded = Math.round(Math.abs(kmh));
	return kmh < 0
		? `${rounded.toLocaleString()} km/h tail`
		: `${rounded.toLocaleString()} km/h head`;
}

export function formatQualityScore(score: number | null): string {
	return score === null ? "--" : String(Math.round(score));
}

export function formatQualityBand(band: RouteQualityBand | "unknown"): string {
	if (band === "excellent") return "Excellent";
	if (band === "good") return "Good";
	if (band === "mixed") return "Mixed";
	if (band === "poor") return "Poor";
	return "Unknown";
}

export function formatTrainingSessionKind(
	kind: WorkoutTrainingSessionKind | "unknown",
): string {
	if (kind === "recovery") return "Recovery";
	if (kind === "endurance") return "Endurance";
	if (kind === "tempo") return "Tempo";
	if (kind === "threshold") return "Threshold";
	if (kind === "intervals") return "Intervals";
	if (kind === "mixed") return "Mixed";
	return "Unknown";
}

export function getQualityToneClass(
	band: RouteQualityBand | "unknown",
): string {
	if (band === "excellent") {
		return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
	}
	if (band === "good") {
		return "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300";
	}
	if (band === "mixed") {
		return "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200";
	}
	if (band === "poor") {
		return "border-destructive/25 bg-destructive/10 text-destructive";
	}

	return "border-border/40 bg-secondary/60 text-muted-foreground";
}

export function getClimbLabel(climb: RouteClimb, index: number): string {
	return climb.category === "Uncategorized"
		? `Climb ${index + 1}`
		: `${climb.category} climb`;
}

export function getClimbColor(climb: RouteClimb): string {
	if (climb.category === "HC") return "rgb(127 29 29)";
	if (climb.category === "Cat 1") return "rgb(185 28 28)";
	if (climb.category === "Cat 2") return "rgb(217 119 6)";
	if (climb.category === "Cat 3") return "rgb(37 99 235)";
	if (climb.category === "Cat 4") return "rgb(22 163 74)";

	return "rgb(100 116 139)";
}

export function getRoutingProfileLabel(route: PlannedRoute | null): string {
	if (!route) {
		return "Road-bike planner";
	}

	if (isImportedRoute(route)) {
		return "Imported GPX track";
	}

	if (route.routingStrategy) {
		return route.routingStrategy;
	}

	if (route.routingProfile === "racingbike") {
		return "GraphHopper racingbike profile.";
	}

	return "GraphHopper bike profile.";
}

export function getRoutingBadgeLabel(route: PlannedRoute | null): string {
	if (!route) {
		return "Road-bike";
	}

	if (isImportedRoute(route)) {
		return "Imported GPX";
	}

	return route.routingProfile === "racingbike"
		? "Racingbike profile"
		: "Bike fallback";
}

export function getImportedRouteStopSummary(
	route: PlannedRoute | null,
): string | null {
	if (!route || !isImportedRoute(route)) {
		return null;
	}

	if (route.source.stopDerivation === "rtept") {
		return "Stops loaded from GPX route points.";
	}

	if (route.source.stopDerivation === "wpt") {
		return "Stops loaded from GPX waypoints.";
	}

	return "Stops inferred from track.";
}
