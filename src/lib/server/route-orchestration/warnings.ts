import type { PlannedRoute, RouteWarning } from "$lib/route-planning";
import {
	buildRouteReadinessWarnings,
	calculateRouteQuality,
	mergeRouteWarnings,
	withRouteTrainingSuitability,
} from "$lib/route-planning";

import { windUnavailableWarning } from "./constants";

export function withWindWarning(route: PlannedRoute): PlannedRoute {
	return mergeRouteWarnings(route, [
		{
			category: "routing_provider",
			code: "wind_analysis_unavailable",
			severity: "info",
			title: "Wind analysis unavailable",
			message: windUnavailableWarning,
		},
	]);
}

export function withProviderWarning(
	route: PlannedRoute,
	message: string,
	title = "Routing fallback",
): PlannedRoute {
	const warning: RouteWarning = {
		category: "routing_provider",
		code: "routing_profile_fallback",
		severity: "info",
		title,
		message,
	};

	return mergeRouteWarnings(route, [warning]);
}

export function finalizeGeneratedRouteWarnings(
	route: PlannedRoute,
	options: { suppressDeferredWindWarning?: boolean } = {},
): PlannedRoute {
	const providerWarnings = (route.warnings ?? []).filter(
		(warning) => warning.category === "routing_provider",
	);
	const routeWithoutGeneratedAnalyses = {
		...route,
		warnings: providerWarnings.length > 0 ? providerWarnings : undefined,
		routeQuality: calculateRouteQuality(route),
	};
	const routeWithAnalysis = withRouteTrainingSuitability(
		routeWithoutGeneratedAnalyses,
	);
	const readinessWarnings = buildRouteReadinessWarnings(
		routeWithAnalysis,
	).filter(
		(warning) =>
			!options.suppressDeferredWindWarning ||
			warning.code !== "wind_analysis_unavailable",
	);
	return mergeRouteWarnings(routeWithAnalysis, readinessWarnings);
}

export function finalizeGeneratedRoutesWarnings(
	routes: PlannedRoute[],
	options: { suppressDeferredWindWarning?: boolean } = {},
): PlannedRoute[] {
	return routes.map((route) => finalizeGeneratedRouteWarnings(route, options));
}
