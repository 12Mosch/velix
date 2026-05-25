import {
	getRouteElevationAnalysisPoints,
	type PlannedRoute,
} from "$lib/route-planning";

export function routeHasGradientOverlayFeatures(route: PlannedRoute): boolean {
	const points = getRouteElevationAnalysisPoints(route.coordinates);

	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const current = points[index];

		if (!previous?.coordinate || !current?.coordinate) {
			continue;
		}

		const distanceMeters = current.distanceMeters - previous.distanceMeters;
		const elevationDeltaMeters =
			current.elevationMeters - previous.elevationMeters;

		if (
			Number.isFinite(distanceMeters) &&
			distanceMeters > 0 &&
			Number.isFinite(elevationDeltaMeters)
		) {
			return true;
		}
	}

	return false;
}

export function routeHasWindOverlayFeatures(route: PlannedRoute): boolean {
	if (!route.windAnalysis) {
		return false;
	}

	return route.windAnalysis.segments.some((segment) => {
		const from = Math.trunc(segment.from);
		const to = Math.trunc(segment.to);

		return (
			from === segment.from &&
			to === segment.to &&
			from >= 0 &&
			to > from &&
			to < route.coordinates.length
		);
	});
}
