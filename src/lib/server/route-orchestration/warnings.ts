import type { PlannedRoute, RouteWarning } from "$lib/route-planning";
import {
	buildRouteReadinessWarnings,
	mergeRouteWarnings,
	withRouteQuality,
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
): PlannedRoute {
	const routeWithQuality = withRouteQuality(route);
	return mergeRouteWarnings(
		routeWithQuality,
		buildRouteReadinessWarnings(routeWithQuality),
	);
}

export function finalizeGeneratedRoutesWarnings(
	routes: PlannedRoute[],
): PlannedRoute[] {
	return routes.map(finalizeGeneratedRouteWarnings);
}
