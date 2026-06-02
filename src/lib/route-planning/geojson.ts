import { Array as EffectArray, Option, Result, pipe } from "effect";
import type {
	Feature,
	FeatureCollection,
	LineString,
	Point,
	Polygon,
	Position,
} from "geojson";
import type {
	PlannedRoute,
	ResolvedRouteAvoidance,
	ResolvedRouteSpatialConstraint,
	RouteBounds,
	RouteClimb,
	RouteGradientBucket,
	SpatialConstraintEnforcement,
	WindDirectionBucket,
} from "./types";
import {
	getRouteElevationAnalysisPoints,
	getRouteGradientSections,
} from "./elevation";
import { getCoordinateDistanceMeters } from "./geometry";
import {
	buildRouteSurfaceFeatures,
	classifySmoothnessSurfaceFallbackValue,
	classifySurfaceValue,
} from "./surface";
import {
	getCoordinateSegmentForRouteLeg,
	getRouteSegmentCount,
	sanitizeLockedSegmentIndexes,
} from "./editing";
import {
	getRouteTrafficStressSegments,
	type RouteTrafficStressBucket,
} from "./traffic-stress";
type RouteFeatureProperties =
	| {
			kind: "route";
	  }
	| {
			kind: "surface";
			surfaceBucket: "smooth" | "mixed" | "coarse";
	  }
	| {
			kind: "gradient";
			gradientBucket: RouteGradientBucket;
			gradientPercent: number;
	  }
	| {
			kind: "wind";
			windBucket: WindDirectionBucket;
			headwindComponentKmh: number;
			crosswindComponentKmh: number;
			speedKmh: number;
			directionDegrees: number;
	  }
	| {
			kind: "traffic_stress";
			trafficStressBucket: RouteTrafficStressBucket;
			trafficStressScore: number;
	  }
	| {
			kind: "start" | "destination" | "waypoint";
			label: string;
			order?: number;
	  };
type SpatialConstraintFeatureProperties = {
	kind: "spatial_constraint";
	constraintKind: ResolvedRouteSpatialConstraint["kind"];
	enforcement: SpatialConstraintEnforcement;
	label?: string;
	radiusMeters?: number;
	widthMeters?: number;
};
type RouteAvoidanceFeatureProperties = {
	kind: "route_avoidance";
	avoidanceKind: "road_segment";
	label: string;
	index: number;
};
type LockedSegmentFeatureProperties = {
	kind: "locked_segment";
	segmentIndex: number;
};
export function buildRouteGeoJson(route: PlannedRoute): FeatureCollection {
	const lineFeature: Feature<LineString, RouteFeatureProperties> = {
		type: "Feature",
		properties: {
			kind: "route",
		},
		geometry: {
			type: "LineString",
			coordinates: route.coordinates as Position[],
		},
	};
	const startCoordinate = route.coordinates[0];
	const destinationCoordinate = route.coordinates[route.coordinates.length - 1];
	const startFeature: Feature<Point, RouteFeatureProperties> | null =
		startCoordinate
			? {
					type: "Feature",
					properties: {
						kind: "start",
						label: route.startLabel,
					},
					geometry: {
						type: "Point",
						coordinates: startCoordinate as Position,
					},
				}
			: null;
	const destinationFeature: Feature<Point, RouteFeatureProperties> | null =
		route.mode === "point_to_point" && destinationCoordinate
			? {
					type: "Feature",
					properties: {
						kind: "destination",
						label: route.destinationLabel,
					},
					geometry: {
						type: "Point",
						coordinates: destinationCoordinate as Position,
					},
				}
			: null;
	const waypointFeatures: Feature<Point, RouteFeatureProperties>[] =
		route.waypoints.map((waypoint, index) => ({
			type: "Feature",
			properties: {
				kind: "waypoint",
				label: waypoint.label,
				order: index + 1,
			},
			geometry: {
				type: "Point",
				coordinates: waypoint.coordinate as Position,
			},
		}));
	const features: Feature[] = [lineFeature];
	if (startFeature) {
		features.push(startFeature);
	}
	features.push(...waypointFeatures);
	if (destinationFeature) {
		features.push(destinationFeature);
	}
	return {
		type: "FeatureCollection",
		features,
	};
}
export function buildRouteSurfaceGeoJson(
	route: PlannedRoute,
): FeatureCollection {
	const surfaceFeatures = buildRouteSurfaceFeatures(
		route,
		route.surfaceDetails,
		classifySurfaceValue,
	);
	const features =
		surfaceFeatures.length > 0
			? surfaceFeatures
			: buildRouteSurfaceFeatures(
					route,
					route.smoothnessDetails,
					classifySmoothnessSurfaceFallbackValue,
				);
	return {
		type: "FeatureCollection",
		features,
	};
}
export function buildRouteClimbGeoJson(
	route: PlannedRoute,
	climbs: RouteClimb[],
): FeatureCollection {
	const profilePoints = getRouteElevationAnalysisPoints(route.coordinates);
	const features: Feature<LineString>[] = climbs.map((climb, index) => {
		const coordinates = profilePoints
			.filter(
				(point) =>
					point.coordinate &&
					point.distanceMeters >= climb.startDistanceMeters &&
					point.distanceMeters <= climb.endDistanceMeters,
			)
			.map((point) => point.coordinate as Position);
		return {
			type: "Feature",
			properties: {
				kind: "climb",
				category: climb.category,
				isKeyClimb: climb.isKeyClimb,
				order: index + 1,
			},
			geometry: {
				type: "LineString",
				coordinates:
					coordinates.length >= 2
						? coordinates
						: (route.coordinates.slice(
								climb.rawStartIndex,
								climb.rawEndIndex + 1,
							) as Position[]),
			},
		};
	});
	return {
		type: "FeatureCollection",
		features,
	};
}
export function buildRouteGradientGeoJson(
	route: PlannedRoute,
): FeatureCollection<LineString, RouteFeatureProperties> {
	const sections = getRouteGradientSections(route);

	return {
		type: "FeatureCollection",
		features: sections
			.filter(
				(section) =>
					section.coordinates.length >= 2 &&
					Number.isFinite(section.distanceMeters) &&
					section.distanceMeters > 0,
			)
			.map((section) => ({
				type: "Feature" as const,
				properties: {
					kind: "gradient" as const,
					gradientBucket: section.bucket,
					gradientPercent: section.averageGradePercent,
				},
				geometry: {
					type: "LineString" as const,
					coordinates: section.coordinates as Position[],
				},
			})),
	};
}
export function buildRouteWindGeoJson(
	route: PlannedRoute,
): FeatureCollection<LineString, RouteFeatureProperties> {
	const features =
		route.windAnalysis?.segments.flatMap(
			(segment): Feature<LineString, RouteFeatureProperties>[] => {
				const from = Math.trunc(segment.from);
				const to = Math.trunc(segment.to);
				if (
					from < 0 ||
					to < 0 ||
					to <= from ||
					from !== segment.from ||
					to !== segment.to ||
					to >= route.coordinates.length
				) {
					return [];
				}
				const coordinates = route.coordinates.slice(from, to + 1) as Position[];
				if (coordinates.length < 2) {
					return [];
				}
				return [
					{
						type: "Feature",
						properties: {
							kind: "wind",
							windBucket: segment.bucket,
							headwindComponentKmh: segment.headwindComponentKmh,
							crosswindComponentKmh: segment.crosswindComponentKmh,
							speedKmh: segment.speedKmh,
							directionDegrees: segment.directionDegrees,
						},
						geometry: {
							type: "LineString",
							coordinates,
						},
					},
				];
			},
		) ?? [];
	return {
		type: "FeatureCollection",
		features,
	};
}
export function buildRouteTrafficStressGeoJson(
	route: PlannedRoute,
): FeatureCollection<LineString, RouteFeatureProperties> {
	type StressSection = {
		bucket: RouteTrafficStressBucket;
		coordinates: Position[];
		weightedScoreTotal: number;
		distanceTotal: number;
		lastSegmentIndex: number;
	};
	const sections: StressSection[] = [];

	for (const segment of getRouteTrafficStressSegments(route)) {
		const left = route.coordinates[segment.index];
		const right = route.coordinates[segment.index + 1];

		if (!left || !right) {
			continue;
		}

		const distanceMeters = getCoordinateDistanceMeters(left, right);

		if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
			continue;
		}

		const previousSection = sections[sections.length - 1];

		if (
			previousSection?.bucket === segment.bucket &&
			previousSection.lastSegmentIndex + 1 === segment.index
		) {
			previousSection.coordinates.push(right as Position);
			previousSection.weightedScoreTotal += segment.score * distanceMeters;
			previousSection.distanceTotal += distanceMeters;
			previousSection.lastSegmentIndex = segment.index;
			continue;
		}

		sections.push({
			bucket: segment.bucket,
			coordinates: [left as Position, right as Position],
			weightedScoreTotal: segment.score * distanceMeters,
			distanceTotal: distanceMeters,
			lastSegmentIndex: segment.index,
		});
	}

	return {
		type: "FeatureCollection",
		features: sections
			.filter(
				(section) =>
					section.coordinates.length >= 2 && section.distanceTotal > 0,
			)
			.map((section) => ({
				type: "Feature" as const,
				properties: {
					kind: "traffic_stress" as const,
					trafficStressBucket: section.bucket,
					trafficStressScore: Math.round(
						section.weightedScoreTotal / section.distanceTotal,
					),
				},
				geometry: {
					type: "LineString" as const,
					coordinates: section.coordinates,
				},
			})),
	};
}
export function buildSpatialConstraintGeoJson(
	constraint: ResolvedRouteSpatialConstraint,
): FeatureCollection<Polygon, SpatialConstraintFeatureProperties> {
	const firstPoint = constraint.polygon[0];
	const lastPoint = constraint.polygon[constraint.polygon.length - 1];
	const polygon =
		firstPoint &&
		lastPoint &&
		(firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1])
			? [...constraint.polygon, firstPoint]
			: constraint.polygon;
	return {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties: {
					kind: "spatial_constraint",
					constraintKind: constraint.kind,
					enforcement: constraint.enforcement,
					...(constraint.kind === "area"
						? {
								label: constraint.label,
								radiusMeters: constraint.radiusMeters,
							}
						: {
								widthMeters: constraint.widthMeters,
							}),
				},
				geometry: {
					type: "Polygon",
					coordinates: [polygon as Position[]],
				},
			},
		],
	};
}
function closeRouteAvoidancePolygon(
	polygon: [number, number][],
): [number, number][] {
	const firstPoint = polygon[0];
	const lastPoint = polygon[polygon.length - 1];
	if (!firstPoint) {
		return [];
	}
	return lastPoint &&
		firstPoint[0] === lastPoint[0] &&
		firstPoint[1] === lastPoint[1]
		? polygon
		: [...polygon, firstPoint];
}
export function buildRouteAvoidanceGeoJson(
	avoidances: ResolvedRouteAvoidance[],
): FeatureCollection<Polygon | LineString, RouteAvoidanceFeatureProperties> {
	return {
		type: "FeatureCollection",
		features: avoidances.flatMap((avoidance, index) => {
			const properties: RouteAvoidanceFeatureProperties = {
				kind: "route_avoidance",
				avoidanceKind: avoidance.kind,
				label: avoidance.label,
				index,
			};
			const features: Feature<
				Polygon | LineString,
				RouteAvoidanceFeatureProperties
			>[] = [];
			const polygon = closeRouteAvoidancePolygon(avoidance.polygon);
			if (polygon.length >= 4) {
				features.push({
					type: "Feature",
					properties,
					geometry: {
						type: "Polygon",
						coordinates: [polygon as Position[]],
					},
				});
			}
			if (avoidance.centerline.length >= 2) {
				features.push({
					type: "Feature",
					properties,
					geometry: {
						type: "LineString",
						coordinates: avoidance.centerline as Position[],
					},
				});
			}
			return features;
		}),
	};
}
export function buildLockedSegmentGeoJson(
	route: PlannedRoute,
	lockedSegmentIndexes: number[],
): FeatureCollection<LineString, LockedSegmentFeatureProperties> {
	const segmentCount = getRouteSegmentCount(route);
	const sanitizedIndexes = sanitizeLockedSegmentIndexes(
		lockedSegmentIndexes,
		segmentCount,
	);
	return {
		type: "FeatureCollection",
		features: pipe(
			sanitizedIndexes,
			EffectArray.filterMap((segmentIndex) => {
				const segment = getCoordinateSegmentForRouteLeg(route, segmentIndex);
				if (Option.isNone(segment)) {
					return Result.failVoid;
				}
				const fromIndex = Math.max(0, segment.value.fromIndex);
				const toIndex = Math.min(
					route.coordinates.length - 1,
					segment.value.toIndex,
				);
				if (toIndex <= fromIndex) {
					return Result.failVoid;
				}
				const coordinates = route.coordinates.slice(fromIndex, toIndex + 1);
				if (coordinates.length < 2) {
					return Result.failVoid;
				}
				return Result.succeed({
					type: "Feature" as const,
					properties: {
						kind: "locked_segment" as const,
						segmentIndex,
					},
					geometry: {
						type: "LineString" as const,
						coordinates: coordinates as Position[],
					},
				});
			}),
		),
	};
}
export function mergeRouteBounds(
	routes: PlannedRoute[],
): Option.Option<RouteBounds> {
	if (routes.length === 0) {
		return Option.none();
	}
	let minLng = Number.POSITIVE_INFINITY;
	let minLat = Number.POSITIVE_INFINITY;
	let maxLng = Number.NEGATIVE_INFINITY;
	let maxLat = Number.NEGATIVE_INFINITY;
	for (const route of routes) {
		const [routeMinLng, routeMinLat, routeMaxLng, routeMaxLat] = route.bounds;
		minLng = Math.min(minLng, routeMinLng);
		minLat = Math.min(minLat, routeMinLat);
		maxLng = Math.max(maxLng, routeMaxLng);
		maxLat = Math.max(maxLat, routeMaxLat);
	}
	return Option.some([minLng, minLat, maxLng, maxLat]);
}
