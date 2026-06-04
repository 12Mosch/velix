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
	signature: string;
	baseGeoJson: FeatureCollection;
	surfaceGeoJson?: FeatureCollection;
	climbGeoJsonBySignature: Map<string, FeatureCollection>;
	gradientMetrics?: RouteGradientMetrics;
	gradientSections?: RouteGradientSection[];
	routeQuality?: RouteQualityAnalysis;
	trainingSuitability?: RouteTrainingSuitabilityAnalysis | null;
	gradientOverlayAvailable?: boolean;
	gradientGeoJson?: FeatureCollection;
	windSignature?: string;
	windGeoJson?: FeatureCollection;
	trafficStressSignature?: string;
	trafficStressGeoJson?: FeatureCollection;
	trafficStressOverlayAvailableSignature?: string;
	trafficStressOverlayAvailable?: boolean;
};

function formatSignatureNumber(value: number | undefined, precision: number) {
	return Number.isFinite(value) ? Number(value).toFixed(precision) : "";
}

function getCoordinateSignature(
	coordinate: PlannedRoute["coordinates"][number] | undefined,
) {
	if (!coordinate) {
		return "";
	}

	return [
		formatSignatureNumber(coordinate[0], 6),
		formatSignatureNumber(coordinate[1], 6),
		formatSignatureNumber(coordinate[2], 1),
	].join(",");
}

function getCoordinateFingerprint(route: PlannedRoute) {
	let hash = 2166136261;

	for (const coordinate of route.coordinates) {
		for (const value of [
			Math.round((coordinate[0] ?? 0) * 1_000_000),
			Math.round((coordinate[1] ?? 0) * 1_000_000),
			Math.round((coordinate[2] ?? 0) * 10),
		]) {
			hash ^= value;
			hash = Math.imul(hash, 16777619) >>> 0;
		}
	}

	const middleIndex = Math.floor(route.coordinates.length / 2);

	return [
		route.coordinates.length,
		getCoordinateSignature(route.coordinates[0]),
		getCoordinateSignature(route.coordinates[middleIndex]),
		getCoordinateSignature(route.coordinates[route.coordinates.length - 1]),
		hash.toString(36),
	].join("|");
}

function getRouteSourceSignature(route: PlannedRoute) {
	if (route.source.kind === "gpx_import") {
		return [
			route.source.kind,
			route.source.filename,
			route.source.stopDerivation,
			route.source.hasDuration ? "1" : "0",
		].join(":");
	}

	return route.source.kind;
}

function getRouteWaypointSignature(route: PlannedRoute) {
	return route.waypoints
		.map(
			(waypoint) =>
				`${waypoint.label}:${getCoordinateSignature(waypoint.coordinate)}`,
		)
		.join(";");
}

function getRouteOverlaySignature(route: PlannedRoute): string {
	return [
		route.mode,
		getRouteSourceSignature(route),
		route.startLabel,
		route.destinationLabel,
		getRouteWaypointSignature(route),
		getCoordinateFingerprint(route),
		formatSignatureNumber(route.distanceMeters, 1),
		formatSignatureNumber(route.durationMs, 0),
		formatSignatureNumber(route.ascendMeters, 1),
		formatSignatureNumber(route.descendMeters, 1),
		route.surfaceDetails.length,
		route.smoothnessDetails.length,
		route.windAnalysis?.segments.length ?? 0,
	].join("||");
}

function getRouteClimbOverlaySignature(
	route: PlannedRoute,
	climbs: RouteClimb[],
): string {
	return [
		getRouteOverlaySignature(route),
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

function getRouteWindOverlaySignature(route: PlannedRoute): string {
	return [
		getRouteOverlaySignature(route),
		route.windAnalysis?.segments.length ?? 0,
		route.windAnalysis?.segments
			.map((segment) =>
				[
					segment.from,
					segment.to,
					segment.bucket,
					formatSignatureNumber(segment.speedKmh, 1),
					formatSignatureNumber(segment.directionDegrees, 1),
					formatSignatureNumber(segment.routeBearingDegrees, 1),
					formatSignatureNumber(segment.relativeAngleDegrees, 1),
					formatSignatureNumber(segment.headwindComponentKmh, 1),
					formatSignatureNumber(segment.crosswindComponentKmh, 1),
				].join(":"),
			)
			.join(";") ?? "",
	].join("||");
}

function getRouteDetailSignature(
	details: PlannedRoute["roadClassDetails"],
): string {
	return (
		details
			?.map((detail) => [detail.from, detail.to, detail.value].join(":"))
			.join(";") ?? ""
	);
}

function getRouteTrafficStressOverlaySignature(route: PlannedRoute): string {
	return [
		getRouteOverlaySignature(route),
		getRouteDetailSignature(route.roadClassDetails),
		getRouteDetailSignature(route.roadAccessDetails),
		getRouteDetailSignature(route.bikeNetworkDetails),
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
		const signature = getRouteOverlaySignature(route);
		const cached = routeOverlayGeoJsonCache.get(route);

		if (cached?.signature === signature) {
			return cached;
		}

		const nextCached: CachedRouteOverlayGeoJson = {
			signature,
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
			const climbSignature = getRouteClimbOverlaySignature(route, climbs);
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
			const windSignature = getRouteWindOverlaySignature(route);
			if (cached.windGeoJson && cached.windSignature === windSignature) {
				return cached.windGeoJson;
			}
			cached.windGeoJson = buildRouteWindGeoJson(route);
			cached.windSignature = windSignature;
			return cached.windGeoJson;
		},
		getCachedTrafficStressRouteGeoJson(route: PlannedRoute): FeatureCollection {
			const cached = getCachedRouteOverlayGeoJson(route);
			const trafficStressSignature =
				getRouteTrafficStressOverlaySignature(route);
			if (
				cached.trafficStressGeoJson &&
				cached.trafficStressSignature === trafficStressSignature
			) {
				return cached.trafficStressGeoJson;
			}
			cached.trafficStressGeoJson = buildRouteTrafficStressGeoJson(route);
			cached.trafficStressSignature = trafficStressSignature;
			return cached.trafficStressGeoJson;
		},
		getCachedRouteTrafficStressOverlayAvailable(route: PlannedRoute): boolean {
			const cached = getCachedRouteOverlayGeoJson(route);
			const trafficStressSignature =
				getRouteTrafficStressOverlaySignature(route);
			if (
				cached.trafficStressOverlayAvailableSignature ===
					trafficStressSignature &&
				typeof cached.trafficStressOverlayAvailable === "boolean"
			) {
				return cached.trafficStressOverlayAvailable;
			}
			cached.trafficStressOverlayAvailable =
				routeHasTrafficStressOverlayFeatures(route);
			cached.trafficStressOverlayAvailableSignature = trafficStressSignature;
			return cached.trafficStressOverlayAvailable;
		},
	};
}

export type PlannerOverlayCache = ReturnType<typeof createPlannerOverlayCache>;
