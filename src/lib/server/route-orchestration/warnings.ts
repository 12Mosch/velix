import { Effect } from "effect";

import type { PlannedRoute, RouteWarning } from "$lib/route-planning";
import {
	buildRouteReadinessWarnings,
	mergeRouteWarnings,
	withRouteQuality,
} from "$lib/route-planning";

import { windUnavailableWarning } from "./constants";

export function withWindWarning(
	route: PlannedRoute,
): Effect.Effect<PlannedRoute> {
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
): Effect.Effect<PlannedRoute> {
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
): Effect.Effect<PlannedRoute> {
	return Effect.gen(function* () {
		const routeWithQuality = yield* withRouteQuality(route);
		const readinessWarnings =
			yield* buildRouteReadinessWarnings(routeWithQuality);
		return yield* mergeRouteWarnings(routeWithQuality, readinessWarnings);
	});
}

export function finalizeGeneratedRoutesWarnings(
	routes: PlannedRoute[],
): Effect.Effect<PlannedRoute[]> {
	return Effect.all(routes.map(finalizeGeneratedRouteWarnings));
}
