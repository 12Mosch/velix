import type { FeatureCollection } from "geojson";
import {
	buildRouteClimbGeoJson,
	buildRouteGeoJson,
	buildRouteGradientGeoJson,
	buildRouteSurfaceGeoJson,
	buildRouteTrafficStressGeoJson,
	buildRouteWindGeoJson,
	calculateRouteGradientMetrics,
	getRouteGradientSections,
	getRouteQuality,
	getRouteTrainingSuitability,
	type PlannedRoute,
	type RouteClimb,
	type RouteGradientMetrics,
	type RouteGradientSection,
	type RouteQualityAnalysis,
	type RouteTrainingSuitabilityAnalysis,
} from "$lib/route-planning";
import {
	routeHasGradientOverlayFeatures,
	routeHasTrafficStressOverlayFeatures,
} from "$lib/route-planner/page/route-overlay-capabilities";

type CachedRouteOverlayGeoJson = {
	baseGeoJson: FeatureCollection;
	surfaceGeoJson?: FeatureCollection;
	climbGeoJsonBySignature: Map<string, FeatureCollection>;
	gradientMetrics?: RouteGradientMetrics;
	gradientSections?: RouteGradientSection[];
	routeQuality?: RouteQualityAnalysis;
	trainingSuitability?: RouteTrainingSuitabilityAnalysis | null;
	gradientOverlayAvailable?: boolean;
	gradientGeoJson?: FeatureCollection;
	windGeoJson?: FeatureCollection;
	trafficStressGeoJson?: FeatureCollection;
	trafficStressOverlayAvailable?: boolean;
};

function formatSignatureNumber(value: number | undefined, precision: number) {
	return Number.isFinite(value) ? Number(value).toFixed(precision) : "";
}

function getRouteClimbOverlaySignature(climbs: RouteClimb[]): string {
	return [
		climbs.length,
		climbs
			.map((climb) =>
				[
					formatSignatureNumber(climb.startDistanceMeters, 1),
					formatSignatureNumber(climb.endDistanceMeters, 1),
					climb.rawStartIndex,
					climb.rawEndIndex,
					climb.category,
					climb.isKeyClimb ? "1" : "0",
				].join(":"),
			)
			.join(";"),
	].join("||");
}

export function createPlannerOverlayCache() {
	const routeOverlayGeoJsonCache = new WeakMap<
		PlannedRoute,
		CachedRouteOverlayGeoJson
	>();

	function getCachedRouteOverlayGeoJson(
		route: PlannedRoute,
	): CachedRouteOverlayGeoJson {
		const cached = routeOverlayGeoJsonCache.get(route);

		if (cached) {
			return cached;
		}

		const nextCached: CachedRouteOverlayGeoJson = {
			baseGeoJson: buildRouteGeoJson(route),
			climbGeoJsonBySignature: new Map(),
		};
		routeOverlayGeoJsonCache.set(route, nextCached);

		return nextCached;
	}

	return {
		getCachedBaseRouteGeoJson(route: PlannedRoute): FeatureCollection {
			return getCachedRouteOverlayGeoJson(route).baseGeoJson;
		},
		getCachedSurfaceRouteGeoJson(route: PlannedRoute): FeatureCollection {
			const cached = getCachedRouteOverlayGeoJson(route);
			cached.surfaceGeoJson ??= buildRouteSurfaceGeoJson(route);
			return cached.surfaceGeoJson;
		},
		getCachedClimbRouteGeoJson(
			route: PlannedRoute,
			climbs: RouteClimb[],
		): FeatureCollection {
			const cached = getCachedRouteOverlayGeoJson(route);
			const climbSignature = getRouteClimbOverlaySignature(climbs);
			const cachedClimbGeoJson =
				cached.climbGeoJsonBySignature.get(climbSignature);
			if (cachedClimbGeoJson) {
				return cachedClimbGeoJson;
			}
			const climbGeoJson = buildRouteClimbGeoJson(route, climbs);
			cached.climbGeoJsonBySignature.set(climbSignature, climbGeoJson);
			return climbGeoJson;
		},
		getCachedGradientRouteGeoJson(route: PlannedRoute): FeatureCollection {
			const cached = getCachedRouteOverlayGeoJson(route);
			cached.gradientGeoJson ??= buildRouteGradientGeoJson(route);
			return cached.gradientGeoJson;
		},
		getCachedRouteGradientOverlayAvailable(route: PlannedRoute): boolean {
			const cached = getCachedRouteOverlayGeoJson(route);
			cached.gradientOverlayAvailable ??=
				routeHasGradientOverlayFeatures(route);
			return cached.gradientOverlayAvailable;
		},
		getCachedRouteGradientMetrics(route: PlannedRoute): RouteGradientMetrics {
			const cached = getCachedRouteOverlayGeoJson(route);
			cached.gradientMetrics ??= calculateRouteGradientMetrics(route);
			return cached.gradientMetrics;
		},
		getCachedRouteGradientSections(
			route: PlannedRoute,
		): RouteGradientSection[] {
			const cached = getCachedRouteOverlayGeoJson(route);
			cached.gradientSections ??= getRouteGradientSections(route);
			return cached.gradientSections;
		},
		getCachedRouteQuality(route: PlannedRoute): RouteQualityAnalysis {
			const cached = getCachedRouteOverlayGeoJson(route);
			cached.routeQuality ??= getRouteQuality(route);
			return cached.routeQuality;
		},
		getCachedRouteTrainingSuitability(
			route: PlannedRoute,
		): RouteTrainingSuitabilityAnalysis | null {
			const cached = getCachedRouteOverlayGeoJson(route);
			if (cached.trainingSuitability === undefined) {
				cached.trainingSuitability = getRouteTrainingSuitability(route);
			}
			return cached.trainingSuitability;
		},
		getCachedWindRouteGeoJson(route: PlannedRoute): FeatureCollection {
			const cached = getCachedRouteOverlayGeoJson(route);
			cached.windGeoJson ??= buildRouteWindGeoJson(route);
			return cached.windGeoJson;
		},
		getCachedTrafficStressRouteGeoJson(route: PlannedRoute): FeatureCollection {
			const cached = getCachedRouteOverlayGeoJson(route);
			cached.trafficStressGeoJson ??= buildRouteTrafficStressGeoJson(route);
			return cached.trafficStressGeoJson;
		},
		getCachedRouteTrafficStressOverlayAvailable(route: PlannedRoute): boolean {
			const cached = getCachedRouteOverlayGeoJson(route);
			if (cached.trafficStressOverlayAvailable === undefined) {
				cached.trafficStressOverlayAvailable =
					routeHasTrafficStressOverlayFeatures(route);
			}
			return cached.trafficStressOverlayAvailable;
		},
	};
}

export type PlannerOverlayCache = ReturnType<typeof createPlannerOverlayCache>;
