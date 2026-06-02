import type { PlannedRoute, RouteWarning } from "./types";
import { getCoordinateDistanceMeters } from "./geometry";
import {
	calculateRouteGradientMetrics,
	getRouteElevationAnalysisPoints,
} from "./elevation";
import { analyzeRouteClimbs } from "./climbs";
import { getSurfaceDistanceTotals } from "./surface";
import { getRouteQuality } from "./quality";

function formatWarningPercent(value: number): string {
	return `${Math.round(value)}%`;
}

function formatWarningDistance(valueMeters: number): string {
	return `${(valueMeters / 1000).toFixed(1)} km`;
}

function formatWarningWindSpeed(valueKmh: number): string {
	return `${Math.round(valueKmh)} km/h`;
}

function formatWarningGradient(value: number): string {
	return `${value.toFixed(1)}%`;
}

function legacyRoutingWarningsAsProviderWarnings(
	routingWarnings: string[] | undefined,
): RouteWarning[] {
	return (routingWarnings ?? []).map((message) => ({
		category: "routing_provider" as const,
		code: "routing_profile_fallback" as const,
		severity: "info" as const,
		title: "Routing fallback",
		message,
	}));
}

function warningKey(warning: RouteWarning): string {
	return `${warning.category}:${warning.code}:${warning.title}`;
}

export function getRouteWarnings(route: PlannedRoute): RouteWarning[] {
	return (
		route.warnings ??
		legacyRoutingWarningsAsProviderWarnings(route.routingWarnings)
	);
}

export function getReadinessWarnings(route: PlannedRoute): RouteWarning[] {
	return getRouteWarnings(route).filter(
		(warning) => warning.category === "readiness",
	);
}

export function getProviderWarnings(route: PlannedRoute): RouteWarning[] {
	return getProviderWarningsSync(route);
}

function getProviderWarningsSync(route: PlannedRoute): RouteWarning[] {
	const warnings = [
		...(route.warnings ?? []).filter(
			(warning) => warning.category === "routing_provider",
		),
		...legacyRoutingWarningsAsProviderWarnings(route.routingWarnings),
	];
	const seen = new Set<string>();

	return warnings.filter((warning) => {
		const key = warningKey(warning);

		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
}

export function buildRouteReadinessWarnings(
	route: PlannedRoute,
): RouteWarning[] {
	const warnings: RouteWarning[] = [];
	const surfaceTotals = getSurfaceDistanceTotals(route);
	const coarseShare =
		surfaceTotals.total > 0
			? (surfaceTotals.coarse / surfaceTotals.total) * 100
			: 0;
	const mixedShare =
		surfaceTotals.total > 0
			? (surfaceTotals.mixed / surfaceTotals.total) * 100
			: 0;

	if (surfaceTotals.coarse >= 3000 || coarseShare >= 8) {
		warnings.push({
			category: "readiness",
			code: "coarse_surface_exposure",
			severity: "warning",
			title: "Coarse surface exposure",
			message:
				"This route includes enough rough or unpaved surface to affect road-bike readiness.",
			metricLabel: "Coarse",
			metricValue: `${formatWarningDistance(surfaceTotals.coarse)} (${formatWarningPercent(coarseShare)})`,
		});
	} else if (surfaceTotals.coarse >= 1000 || coarseShare >= 3) {
		warnings.push({
			category: "readiness",
			code: "coarse_surface_exposure",
			severity: "caution",
			title: "Coarse surface exposure",
			message: "This route includes notable rough or unpaved surface.",
			metricLabel: "Coarse",
			metricValue: `${formatWarningDistance(surfaceTotals.coarse)} (${formatWarningPercent(coarseShare)})`,
		});
	} else if (mixedShare >= 20) {
		warnings.push({
			category: "readiness",
			code: "mixed_surface_exposure",
			severity: "caution",
			title: "Mixed surface exposure",
			message:
				"A meaningful share of the route uses mixed, worn, or paved-stone surface.",
			metricLabel: "Mixed",
			metricValue: formatWarningPercent(mixedShare),
		});
	}

	if (
		route.source.kind === "graphhopper" &&
		route.surfaceDetails.length === 0 &&
		route.smoothnessDetails.length === 0
	) {
		warnings.push({
			category: "readiness",
			code: "surface_analysis_unavailable",
			severity: "info",
			title: "Surface analysis unavailable",
			message:
				"Surface and smoothness details were not available for this generated route.",
		});
	}

	if (route.windAnalysis) {
		const headwindShare =
			route.distanceMeters > 0
				? (route.windAnalysis.headwindDistanceMeters / route.distanceMeters) *
					100
				: 0;
		const averageHeadwind = Math.max(0, route.windAnalysis.averageHeadwindKmh);

		if (
			route.windAnalysis.maxHeadwindKmh >= 28 ||
			(headwindShare >= 35 && averageHeadwind >= 16)
		) {
			warnings.push({
				category: "readiness",
				code: "strong_headwind_exposure",
				severity: "warning",
				title: "Strong headwind exposure",
				message:
					"Headwind exposure is high enough to materially affect effort and pacing.",
				metricLabel: "Max headwind",
				metricValue: formatWarningWindSpeed(route.windAnalysis.maxHeadwindKmh),
			});
		} else if (
			route.windAnalysis.maxHeadwindKmh >= 20 ||
			(headwindShare >= 25 && averageHeadwind >= 12)
		) {
			warnings.push({
				category: "readiness",
				code: "strong_headwind_exposure",
				severity: "caution",
				title: "Strong headwind exposure",
				message:
					"Headwind exposure may make this route feel harder than its distance suggests.",
				metricLabel: "Max headwind",
				metricValue: formatWarningWindSpeed(route.windAnalysis.maxHeadwindKmh),
			});
		}

		if (route.windAnalysis.maxCrosswindKmh >= 25) {
			warnings.push({
				category: "readiness",
				code: "strong_crosswind_exposure",
				severity: "caution",
				title: "Strong crosswind exposure",
				message: "Crosswind exposure may affect handling on open sections.",
				metricLabel: "Max crosswind",
				metricValue: formatWarningWindSpeed(route.windAnalysis.maxCrosswindKmh),
			});
		}
	} else if (
		route.source.kind === "graphhopper" &&
		!getProviderWarningsSync(route).some(
			(warning) => warning.code === "wind_analysis_unavailable",
		)
	) {
		warnings.push({
			category: "readiness",
			code: "wind_analysis_unavailable",
			severity: "info",
			title: "Wind analysis unavailable",
			message: "Wind exposure could not be checked for this generated route.",
		});
	}

	const gradientMetrics = calculateRouteGradientMetrics(route);

	if ((gradientMetrics.maximumGradientPercent ?? 0) >= 16) {
		warnings.push({
			category: "readiness",
			code: "steep_gradient",
			severity: "warning",
			title: "Steep gradient",
			message: "The route includes a very steep section.",
			metricLabel: "Max grade",
			metricValue: formatWarningGradient(
				gradientMetrics.maximumGradientPercent ?? 0,
			),
		});
	} else if ((gradientMetrics.maximumGradientPercent ?? 0) >= 12) {
		warnings.push({
			category: "readiness",
			code: "steep_gradient",
			severity: "caution",
			title: "Steep gradient",
			message: "The route includes a steep section.",
			metricLabel: "Max grade",
			metricValue: formatWarningGradient(
				gradientMetrics.maximumGradientPercent ?? 0,
			),
		});
	}

	const elevationPoints = getRouteElevationAnalysisPoints(route.coordinates);
	const climbs = analyzeRouteClimbs(elevationPoints);
	const majorClimb = climbs.find((climb) =>
		["HC", "Cat 1", "Cat 2"].includes(climb.category),
	);
	const hardMajorClimb = climbs.find((climb) =>
		["HC", "Cat 1"].includes(climb.category),
	);

	if (hardMajorClimb && route.distanceMeters < 60000) {
		warnings.push({
			category: "readiness",
			code: "major_climb",
			severity: "warning",
			title: "Major climb",
			message: "This shorter route includes a Cat 1 or HC climb.",
			metricLabel: "Climb",
			metricValue: hardMajorClimb.category,
		});
	} else if (majorClimb) {
		warnings.push({
			category: "readiness",
			code: "major_climb",
			severity: "caution",
			title: "Major climb",
			message:
				"This route includes a categorized climb that may require climb-specific pacing.",
			metricLabel: "Climb",
			metricValue: majorClimb.category,
		});
	}

	if (
		route.mode === "point_to_point" &&
		route.distanceMeters >= 10000 &&
		route.coordinates.length >= 2
	) {
		const first = route.coordinates[0];
		const last = route.coordinates[route.coordinates.length - 1];
		const straightLineDistance =
			first && last ? getCoordinateDistanceMeters(first, last) : 0;
		const efficiency =
			straightLineDistance > 0
				? route.distanceMeters / straightLineDistance
				: 0;

		if (straightLineDistance >= 3000 && efficiency >= 1.8) {
			warnings.push({
				category: "readiness",
				code: "low_route_efficiency",
				severity: "caution",
				title: "Low route efficiency",
				message:
					"The route is much longer than the straight-line distance between start and finish.",
				metricLabel: "Efficiency",
				metricValue: `${efficiency.toFixed(1)}x direct`,
			});
		}
	}

	const quality = getRouteQuality(route);
	if (quality.overallScore !== null && quality.overallScore < 55) {
		warnings.push({
			category: "readiness",
			code: "low_route_quality",
			severity: quality.overallScore < 40 ? "warning" : "caution",
			title: "Low route quality",
			message:
				"Overall road-training quality is below target based on available route details.",
			metricLabel: "Quality",
			metricValue: String(Math.round(quality.overallScore)),
		});
	}

	const trafficStress = quality.subscores.trafficStress.score;
	if (trafficStress !== null && trafficStress < 50) {
		warnings.push({
			category: "readiness",
			code: "high_traffic_stress",
			severity: trafficStress < 35 ? "warning" : "caution",
			title: "High traffic stress",
			message: "Road class and access mix suggest stressful riding.",
			metricLabel: "Stress score",
			metricValue: String(Math.round(trafficStress)),
		});
	}

	const interruptionRisk = quality.subscores.interruptionRisk.score;
	if (interruptionRisk !== null && interruptionRisk < 55) {
		warnings.push({
			category: "readiness",
			code: "high_interruption_risk",
			severity: "caution",
			title: "High interruption risk",
			message:
				"Turns, restricted access, or route environments may interrupt flow.",
			metricLabel: "Risk score",
			metricValue: String(Math.round(interruptionRisk)),
		});
	}

	const urbanExposure = quality.subscores.urbanExposure.score;
	if (urbanExposure !== null && urbanExposure < 45) {
		warnings.push({
			category: "readiness",
			code: "high_urban_exposure",
			severity: "caution",
			title: "High urban exposure",
			message: "Urban-like riding makes up a large share of the route.",
			metricLabel: "Urban score",
			metricValue: String(Math.round(urbanExposure)),
		});
	}

	return warnings;
}

export function mergeRouteWarnings(
	route: PlannedRoute,
	warnings: RouteWarning[],
): PlannedRoute {
	const mergedWarnings: RouteWarning[] = [];
	const seen = new Set<string>();

	for (const warning of [...(route.warnings ?? []), ...warnings]) {
		const key = warningKey(warning);

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		mergedWarnings.push(warning);
	}

	return {
		...route,
		warnings: mergedWarnings,
	};
}
