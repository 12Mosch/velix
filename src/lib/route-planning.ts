import type {
	Feature,
	FeatureCollection,
	LineString,
	Point,
	Polygon,
	Position,
} from "geojson";

export type RouteBounds = [number, number, number, number];

export type RouteCoordinate = [number, number] | [number, number, number];

export type RouteInstructionType =
	| "continue"
	| "slight_left"
	| "left"
	| "sharp_left"
	| "slight_right"
	| "right"
	| "sharp_right"
	| "u_turn"
	| "roundabout"
	| "leave_roundabout"
	| "keep_left"
	| "keep_right"
	| "via"
	| "finish"
	| "unknown";

export type RouteInstruction = {
	distanceFromStartMeters: number;
	text: string;
	sign: number;
	type: RouteInstructionType;
	segmentDistanceMeters: number;
	segmentTimeMs: number;
	coordinateIndex: number;
	coordinate: RouteCoordinate;
	interval: [number, number];
};

export type RouteSuggestion = {
	label: string;
	point: [number, number];
};

export type ImportedRouteStopDerivation = "rtept" | "wpt" | "track";

export type RouteSource =
	| {
			kind: "graphhopper";
	  }
	| {
			kind: "gpx_import";
			filename: string;
			stopDerivation: ImportedRouteStopDerivation;
			hasDuration: boolean;
	  };

export type RouteMode = "point_to_point" | "round_course" | "out_and_back";

export type RouteStopInput = {
	label: string;
	point?: [number, number];
};

export type SpatialConstraintEnforcement = "strict" | "preferred";

export type RouteSpatialConstraintInput =
	| {
			kind: "area";
			center: RouteStopInput;
			radiusMeters: number;
			enforcement: SpatialConstraintEnforcement;
	  }
	| {
			kind: "corridor";
			widthMeters: number;
			enforcement: SpatialConstraintEnforcement;
	  };

export type ResolvedRouteSpatialConstraint =
	| {
			kind: "area";
			label: string;
			center: [number, number];
			radiusMeters: number;
			enforcement: SpatialConstraintEnforcement;
			polygon: [number, number][];
	  }
	| {
			kind: "corridor";
			widthMeters: number;
			enforcement: SpatialConstraintEnforcement;
			polygon: [number, number][];
	  };

export type RouteAvoidanceInput = {
	kind: "road_segment";
	centerline: [number, number][];
	bufferMeters: number;
	label?: string;
};

export type ResolvedRouteAvoidance = {
	kind: "road_segment";
	label: string;
	centerline: [number, number][];
	bufferMeters: number;
	polygon: [number, number][];
};

export type PointToPointRouteRequestPayload = {
	mode: "point_to_point";
	start: RouteStopInput;
	waypoints: RouteStopInput[];
	destination: RouteStopInput;
	spatialConstraint?: RouteSpatialConstraintInput;
	avoidances?: RouteAvoidanceInput[];
};

export type RoundCourseTarget =
	| {
			kind: "distance";
			distanceMeters: number;
	  }
	| {
			kind: "duration";
			durationMs: number;
	  }
	| {
			kind: "ascend";
			ascendMeters: number;
	  };

export type RoundCourseRouteRequestPayload = {
	mode: "round_course";
	start: RouteStopInput;
	waypoints?: RouteStopInput[];
	target: RoundCourseTarget;
	spatialConstraint?: RouteSpatialConstraintInput;
	avoidances?: RouteAvoidanceInput[];
};

export type OutAndBackRouteRequestPayload = {
	mode: "out_and_back";
	start: RouteStopInput;
	waypoints?: RouteStopInput[];
	turnaround: RouteStopInput;
	spatialConstraint?: RouteSpatialConstraintInput;
	avoidances?: RouteAvoidanceInput[];
};

export type RouteRequestPayload =
	| PointToPointRouteRequestPayload
	| RoundCourseRouteRequestPayload
	| OutAndBackRouteRequestPayload;

export type RouteDetailInterval = {
	from: number;
	to: number;
	value: string;
};

export type RouteWaypoint = {
	label: string;
	coordinate: RouteCoordinate;
};

export type ManualRouteEditingState = {
	lockedSegmentIndexes: number[];
};

export type ElevationProfilePoint = {
	distanceMeters: number;
	elevationMeters: number;
	coordinate: RouteCoordinate;
};

export type ClimbCategory =
	| "HC"
	| "Cat 1"
	| "Cat 2"
	| "Cat 3"
	| "Cat 4"
	| "Uncategorized";

export type ClimbAnalysisPoint = {
	distanceMeters: number;
	elevationMeters: number;
	coordinate?: RouteCoordinate;
	rawRouteIndex?: number;
};

export type RouteClimb = {
	startIndex: number;
	endIndex: number;
	rawStartIndex: number;
	rawEndIndex: number;
	startDistanceMeters: number;
	endDistanceMeters: number;
	distanceMeters: number;
	elevationGainMeters: number;
	averageGradePercent: number;
	maxGradePercent: number;
	score: number;
	category: ClimbCategory;
	isKeyClimb: boolean;
};

export type RouteGradientMetrics = {
	averageGradientPercent: number | null;
	maximumGradientPercent: number | null;
};

export type RouteGradientBucket =
	| "steep_down"
	| "down"
	| "mild_down"
	| "flat"
	| "mild_up"
	| "up"
	| "steep_up";

export type WindDirectionBucket =
	| "headwind"
	| "cross_headwind"
	| "crosswind"
	| "cross_tailwind"
	| "tailwind";

export type RouteWindSample = {
	coordinate: [number, number];
	speedKmh: number;
	directionDegrees: number;
	time: string;
	source: "open_meteo";
};

export type RouteWindSegment = {
	from: number;
	to: number;
	speedKmh: number;
	directionDegrees: number;
	routeBearingDegrees: number;
	relativeAngleDegrees: number;
	headwindComponentKmh: number;
	crosswindComponentKmh: number;
	bucket: WindDirectionBucket;
};

export type RouteWindAnalysis = {
	source: "open_meteo";
	fetchedAt: string;
	forecastTime: string;
	samples: RouteWindSample[];
	segments: RouteWindSegment[];
	averageHeadwindKmh: number;
	maxHeadwindKmh: number;
	averageTailwindKmh: number;
	maxCrosswindKmh: number;
	headwindDistanceMeters: number;
	tailwindDistanceMeters: number;
	crosswindDistanceMeters: number;
};

export type RouteWindSummary = {
	forecastTime: string;
	averageHeadwindKmh: number;
	averageTailwindKmh: number;
	maxHeadwindKmh: number;
	maxCrosswindKmh: number;
	headwindDistanceMeters: number;
	tailwindDistanceMeters: number;
	crosswindDistanceMeters: number;
};

export type RouteWarningSeverity = "info" | "caution" | "warning";

export type RouteWarningCategory = "readiness" | "routing_provider";

export type RouteWarningCode =
	| "coarse_surface_exposure"
	| "mixed_surface_exposure"
	| "strong_headwind_exposure"
	| "strong_crosswind_exposure"
	| "steep_gradient"
	| "major_climb"
	| "low_route_efficiency"
	| "surface_analysis_unavailable"
	| "wind_analysis_unavailable"
	| "routing_profile_fallback";

export type RouteWarning = {
	category: RouteWarningCategory;
	code: RouteWarningCode;
	severity: RouteWarningSeverity;
	title: string;
	message: string;
	metricLabel?: string;
	metricValue?: string;
};

export type PlannedRoute = {
	mode: RouteMode;
	source: RouteSource;
	startLabel: string;
	destinationLabel: string;
	requestedDistanceMeters?: number;
	roundCourseTarget?: RoundCourseTarget;
	spatialConstraint?: ResolvedRouteSpatialConstraint;
	avoidances?: ResolvedRouteAvoidance[];
	routingProfile?: string;
	routingStrategy?: string;
	warnings?: RouteWarning[];
	routingWarnings?: string[];
	manualEditing?: ManualRouteEditingState;
	waypoints: RouteWaypoint[];
	bounds: RouteBounds;
	distanceMeters: number;
	durationMs: number;
	ascendMeters: number;
	descendMeters: number;
	coordinates: RouteCoordinate[];
	instructions?: RouteInstruction[];
	surfaceDetails: RouteDetailInterval[];
	smoothnessDetails: RouteDetailInterval[];
	windAnalysis?: RouteWindAnalysis;
};

export type RouteApiSuccess = {
	routes: PlannedRoute[];
	selectedRouteIndex: number;
	roundCourseCandidateErrors?: RoundCourseCandidateError[];
};

export type RouteSuggestionsApiSuccess = {
	suggestions: RouteSuggestion[];
};

export type RouteMapOverlay = {
	id: string;
	geoJson: FeatureCollection;
	bounds: RouteBounds;
	isSelected: boolean;
};

export type RouteFieldErrors = {
	startQuery?: string;
	destinationQuery?: string;
	waypointQueries?: string[];
	roundCourseTarget?: string;
	spatialConstraint?: string;
	avoidances?: string;
};

export type RouteApiError = {
	error: string;
	fieldErrors?: RouteFieldErrors;
	roundCourseCandidateErrors?: RoundCourseCandidateError[];
};

export type RoundCourseCandidateError = {
	roundIndex: number;
	candidateIndex: number;
	sequence: number;
	requestedDistanceMeters: number;
	seed?: number;
	errorTag: string;
	message: string;
	status?: number;
};

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

const smoothSurfaceValues = new Set([
	"ASPHALT",
	"PAVED",
	"CONCRETE",
	"CONCRETE_LANES",
	"CONCRETE_PLATES",
]);

const mixedSurfaceValues = new Set([
	"PAVING_STONES",
	"SETT",
	"COBBLESTONE",
	"UNHEWN_COBBLESTONE",
	"COMPACTED",
	"FINE_GRAVEL",
	"CHIPSEAL",
]);

const coarseSurfaceValues = new Set([
	"DIRT",
	"EARTH",
	"GROUND",
	"GRASS",
	"GRAVEL",
	"MUD",
	"PEBBLESTONE",
	"ROCK",
	"SAND",
	"UNPAVED",
	"WOODCHIPS",
]);

const smoothnessSurfaceFallback = {
	smooth: new Set(["EXCELLENT", "GOOD"]),
	mixed: new Set(["INTERMEDIATE"]),
};

const earthRadiusMeters = 6371008.8;

function toDegrees(radians: number): number {
	return (radians * 180) / Math.PI;
}

function toStopPoint(
	coordinate: RouteCoordinate | [number, number],
): [number, number] {
	return [coordinate[0], coordinate[1]];
}

function normalizeDegrees(degrees: number): number {
	return ((degrees % 360) + 360) % 360;
}

function getSignedRelativeAngleDegrees(fromDegrees: number, toDegrees: number) {
	const angle = normalizeDegrees(fromDegrees - toDegrees);
	return angle > 180 ? angle - 360 : angle;
}

export function calculateBearingDegrees(
	from: RouteCoordinate | [number, number],
	to: RouteCoordinate | [number, number],
): number {
	const fromLng = toRadians(from[0]);
	const fromLat = toRadians(from[1]);
	const toLng = toRadians(to[0]);
	const toLat = toRadians(to[1]);
	const deltaLng = toLng - fromLng;
	const y = Math.sin(deltaLng) * Math.cos(toLat);
	const x =
		Math.cos(fromLat) * Math.sin(toLat) -
		Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);

	return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

export function classifyWindBucket(
	relativeAngleDegrees: number,
): WindDirectionBucket {
	const absoluteAngle = Math.abs(
		getSignedRelativeAngleDegrees(relativeAngleDegrees, 0),
	);

	if (absoluteAngle <= 30) return "headwind";
	if (absoluteAngle < 75) return "cross_headwind";
	if (absoluteAngle <= 105) return "crosswind";
	if (absoluteAngle < 150) return "cross_tailwind";
	return "tailwind";
}

export function calculateWindComponents(options: {
	speedKmh: number;
	windDirectionDegrees: number;
	routeBearingDegrees: number;
}): {
	relativeAngleDegrees: number;
	headwindComponentKmh: number;
	crosswindComponentKmh: number;
	bucket: WindDirectionBucket;
} {
	const relativeAngleDegrees = getSignedRelativeAngleDegrees(
		options.windDirectionDegrees,
		options.routeBearingDegrees,
	);
	const relativeRadians = toRadians(relativeAngleDegrees);
	const headwindComponentKmh = options.speedKmh * Math.cos(relativeRadians);
	const crosswindComponentKmh = options.speedKmh * Math.sin(relativeRadians);

	return {
		relativeAngleDegrees,
		headwindComponentKmh,
		crosswindComponentKmh,
		bucket: classifyWindBucket(relativeAngleDegrees),
	};
}

function normalizeDetailValue(value: string): string {
	return value
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function classifySurfaceValue(
	value: string,
): keyof typeof smoothnessSurfaceFallback | "coarse" | null {
	const normalizedValue = normalizeDetailValue(value);

	if (
		!normalizedValue ||
		normalizedValue === "MISSING" ||
		normalizedValue === "UNKNOWN"
	) {
		return null;
	}

	if (smoothSurfaceValues.has(normalizedValue)) {
		return "smooth";
	}

	if (mixedSurfaceValues.has(normalizedValue)) {
		return "mixed";
	}

	if (coarseSurfaceValues.has(normalizedValue)) {
		return "coarse";
	}

	return null;
}

function classifySmoothnessSurfaceFallbackValue(
	value: string,
): keyof typeof smoothnessSurfaceFallback | "coarse" | null {
	const normalizedValue = normalizeDetailValue(value);

	if (
		!normalizedValue ||
		normalizedValue === "MISSING" ||
		normalizedValue === "UNKNOWN"
	) {
		return null;
	}

	if (smoothnessSurfaceFallback.smooth.has(normalizedValue)) {
		return "smooth";
	}

	if (smoothnessSurfaceFallback.mixed.has(normalizedValue)) {
		return "mixed";
	}

	return "coarse";
}

function buildRouteSurfaceFeatures(
	route: PlannedRoute,
	details: RouteDetailInterval[],
	classify: (
		value: string,
	) => keyof typeof smoothnessSurfaceFallback | "coarse" | null,
): Feature<LineString, RouteFeatureProperties>[] {
	return details.flatMap((detail) => {
		const bucket = classify(detail.value);

		if (!bucket) {
			return [];
		}

		const from = Math.trunc(detail.from);
		const to = Math.trunc(detail.to);

		if (
			from < 0 ||
			to < 0 ||
			to <= from ||
			from !== detail.from ||
			to !== detail.to ||
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
					kind: "surface",
					surfaceBucket: bucket,
				},
				geometry: {
					type: "LineString",
					coordinates,
				},
			},
		];
	});
}

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

export function mapGraphHopperSignToInstructionType(
	sign: number,
): RouteInstructionType {
	switch (sign) {
		case -3:
			return "sharp_left";
		case -2:
			return "left";
		case -1:
			return "slight_left";
		case 0:
			return "continue";
		case 1:
			return "slight_right";
		case 2:
			return "right";
		case 3:
			return "sharp_right";
		case 4:
			return "finish";
		case 5:
			return "via";
		case 6:
			return "roundabout";
		case -6:
			return "leave_roundabout";
		case -7:
			return "keep_left";
		case 7:
			return "keep_right";
		case -98:
		case 98:
			return "u_turn";
		default:
			return "unknown";
	}
}

export function getRouteTurnCount(route: PlannedRoute): number {
	return (route.instructions ?? []).filter((instruction) => {
		if (
			instruction.type === "continue" ||
			instruction.type === "via" ||
			instruction.type === "finish"
		) {
			return false;
		}

		return instruction.type !== "unknown" || instruction.sign !== 0;
	}).length;
}

function classifyGradientBucket(
	gradientPercent: number,
): RouteGradientBucket | null {
	if (!Number.isFinite(gradientPercent)) {
		return null;
	}

	if (gradientPercent <= -6) return "steep_down";
	if (gradientPercent <= -3) return "down";
	if (gradientPercent < -1) return "mild_down";
	if (gradientPercent <= 1) return "flat";
	if (gradientPercent < 3) return "mild_up";
	if (gradientPercent < 6) return "up";
	return "steep_up";
}

export function buildRouteGradientGeoJson(
	route: PlannedRoute,
): FeatureCollection<LineString, RouteFeatureProperties> {
	const points = smoothClimbPoints(
		getRouteElevationAnalysisPoints(route.coordinates).filter(
			(point) =>
				!!point.coordinate &&
				Number.isFinite(point.distanceMeters) &&
				Number.isFinite(point.elevationMeters),
		),
	);

	type GradientSection = {
		bucket: RouteGradientBucket;
		coordinates: Position[];
		distanceMeters: number;
		elevationDeltaMeters: number;
	};
	const sections: GradientSection[] = [];

	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const current = points[index];

		if (!previous?.coordinate || !current?.coordinate) {
			continue;
		}

		const distanceMeters = current.distanceMeters - previous.distanceMeters;
		const elevationDeltaMeters =
			current.elevationMeters - previous.elevationMeters;

		if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
			continue;
		}

		const gradientPercent = (elevationDeltaMeters / distanceMeters) * 100;
		const bucket = classifyGradientBucket(gradientPercent);

		if (!bucket) {
			continue;
		}

		const previousSection = sections[sections.length - 1];

		if (previousSection?.bucket === bucket) {
			previousSection.coordinates.push(current.coordinate as Position);
			previousSection.distanceMeters += distanceMeters;
			previousSection.elevationDeltaMeters += elevationDeltaMeters;
			continue;
		}

		sections.push({
			bucket,
			coordinates: [
				previous.coordinate as Position,
				current.coordinate as Position,
			],
			distanceMeters,
			elevationDeltaMeters,
		});
	}

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
					gradientPercent:
						(section.elevationDeltaMeters / section.distanceMeters) * 100,
				},
				geometry: {
					type: "LineString" as const,
					coordinates: section.coordinates,
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

export function getWindSummary(route: PlannedRoute): RouteWindSummary | null {
	if (!route.windAnalysis) {
		return null;
	}

	return {
		forecastTime: route.windAnalysis.forecastTime,
		averageHeadwindKmh: route.windAnalysis.averageHeadwindKmh,
		averageTailwindKmh: route.windAnalysis.averageTailwindKmh,
		maxHeadwindKmh: route.windAnalysis.maxHeadwindKmh,
		maxCrosswindKmh: route.windAnalysis.maxCrosswindKmh,
		headwindDistanceMeters: route.windAnalysis.headwindDistanceMeters,
		tailwindDistanceMeters: route.windAnalysis.tailwindDistanceMeters,
		crosswindDistanceMeters: route.windAnalysis.crosswindDistanceMeters,
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

export function mergeRouteBounds(routes: PlannedRoute[]): RouteBounds | null {
	if (routes.length === 0) {
		return null;
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

	return [minLng, minLat, maxLng, maxLat];
}

export function isImportedRoute(
	route: Pick<PlannedRoute, "source"> | null | undefined,
): route is {
	source: Extract<RouteSource, { kind: "gpx_import" }>;
} {
	return route?.source.kind === "gpx_import";
}

function toRadians(value: number) {
	return (value * Math.PI) / 180;
}

function getCoordinateDistanceMeters(
	from: RouteCoordinate,
	to: RouteCoordinate,
): number {
	const [fromLon, fromLat] = from;
	const [toLon, toLat] = to;
	const latitudeDelta = toRadians(toLat - fromLat);
	const longitudeDelta = toRadians(toLon - fromLon);
	const fromLatitudeRadians = toRadians(fromLat);
	const toLatitudeRadians = toRadians(toLat);
	const haversineA =
		Math.sin(latitudeDelta / 2) ** 2 +
		Math.cos(fromLatitudeRadians) *
			Math.cos(toLatitudeRadians) *
			Math.sin(longitudeDelta / 2) ** 2;
	const haversineC =
		2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));

	return earthRadiusMeters * haversineC;
}

function projectCoordinate(
	coordinate: [number, number],
	referenceLatitude: number,
): [number, number] {
	const [longitude, latitude] = coordinate;
	const latitudeRadians = toRadians(referenceLatitude);

	return [
		toRadians(longitude) * Math.cos(latitudeRadians) * earthRadiusMeters,
		toRadians(latitude) * earthRadiusMeters,
	];
}

function getPointToSegmentDistanceMeters(
	point: [number, number],
	segmentStart: [number, number],
	segmentEnd: [number, number],
): number {
	const referenceLatitude = (point[1] + segmentStart[1] + segmentEnd[1]) / 3;
	const [pointX, pointY] = projectCoordinate(point, referenceLatitude);
	const [startX, startY] = projectCoordinate(segmentStart, referenceLatitude);
	const [endX, endY] = projectCoordinate(segmentEnd, referenceLatitude);
	const deltaX = endX - startX;
	const deltaY = endY - startY;
	const segmentLengthSquared = deltaX ** 2 + deltaY ** 2;

	if (segmentLengthSquared === 0) {
		return Math.hypot(pointX - startX, pointY - startY);
	}

	const projection =
		((pointX - startX) * deltaX + (pointY - startY) * deltaY) /
		segmentLengthSquared;
	const clampedProjection = Math.min(1, Math.max(0, projection));
	const closestX = startX + deltaX * clampedProjection;
	const closestY = startY + deltaY * clampedProjection;

	return Math.hypot(pointX - closestX, pointY - closestY);
}

function getLegDistanceMeters(
	point: [number, number],
	coordinates: [number, number][],
): number {
	if (coordinates.length === 0) {
		return Number.POSITIVE_INFINITY;
	}

	if (coordinates.length === 1) {
		return getPointToSegmentDistanceMeters(
			point,
			coordinates[0],
			coordinates[0],
		);
	}

	let nearestDistance = Number.POSITIVE_INFINITY;

	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const from = coordinates[index];
		const to = coordinates[index + 1];

		if (!from || !to) {
			continue;
		}

		nearestDistance = Math.min(
			nearestDistance,
			getPointToSegmentDistanceMeters(point, from, to),
		);
	}

	return nearestDistance;
}

function getNearestPolylineIndex(
	coordinates: RouteCoordinate[],
	target: [number, number],
	searchStartIndex: number,
): number {
	let nearestIndex = searchStartIndex;
	let nearestDistance = Number.POSITIVE_INFINITY;

	for (let index = searchStartIndex; index < coordinates.length; index += 1) {
		const coordinate = coordinates[index];

		if (!coordinate) {
			continue;
		}

		const distance = getCoordinateDistanceMeters(coordinate, target);

		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearestIndex = index;
		}
	}

	return nearestIndex;
}

export function getRouteStopInputs(route: PlannedRoute): RouteStopInput[] {
	return getEditableRouteStops(route);
}

/**
 * Returns the editable stop chain for route planning interactions.
 *
 * Point-to-point routes expose start, all waypoints, and destination.
 * Round courses expose the start plus shaping waypoints; the implicit closing
 * leg returns to the start. Out-and-back routes expose start, optional shaping
 * waypoints, and the turnaround, with mirrored return geometry handled later.
 */
export function getEditableRouteStops(route: PlannedRoute): RouteStopInput[] {
	const startCoordinate = route.coordinates[0];
	const destinationCoordinate = route.coordinates[route.coordinates.length - 1];
	const startStop = {
		label: route.startLabel,
		point: startCoordinate ? toStopPoint(startCoordinate) : undefined,
	};

	if (route.mode !== "point_to_point") {
		return [
			startStop,
			...route.waypoints.map((waypoint) => ({
				label: waypoint.label,
				point: toStopPoint(waypoint.coordinate),
			})),
		];
	}

	return [
		startStop,
		...route.waypoints.map((waypoint) => ({
			label: waypoint.label,
			point: toStopPoint(waypoint.coordinate),
		})),
		{
			label: route.destinationLabel,
			point: destinationCoordinate
				? toStopPoint(destinationCoordinate)
				: undefined,
		},
	];
}

/**
 * Counts editable legs, not raw polyline coordinate segments.
 *
 * Point-to-point and out-and-back routes have one fewer editable segment than
 * editable stops. Round courses include the implicit final segment from the
 * last shaping stop back to the start, so their segment count matches the
 * editable stop count.
 */
export function getRouteSegmentCount(route: PlannedRoute): number {
	const editableStops = getEditableRouteStops(route);

	if (route.mode === "round_course") {
		return Math.max(1, editableStops.length);
	}

	return Math.max(0, editableStops.length - 1);
}

export function sanitizeLockedSegmentIndexes(
	indexes: number[] | null | undefined,
	segmentCount: number,
): number[] {
	if (!Array.isArray(indexes) || segmentCount <= 0) {
		return [];
	}

	return [...new Set(indexes)]
		.filter(
			(index) => Number.isInteger(index) && index >= 0 && index < segmentCount,
		)
		.sort((left, right) => left - right);
}

export function isRouteStopLocked(
	stopIndex: number,
	lockedSegmentIndexes: number[],
	segmentCount: number,
	isClosedLoop = false,
): boolean {
	if (!Number.isInteger(stopIndex) || stopIndex < 0 || segmentCount <= 0) {
		return false;
	}

	const lockedSegments = new Set(
		sanitizeLockedSegmentIndexes(lockedSegmentIndexes, segmentCount),
	);

	if (lockedSegments.has(stopIndex) || lockedSegments.has(stopIndex - 1)) {
		return true;
	}

	return (
		isClosedLoop && stopIndex === 0 && lockedSegments.has(segmentCount - 1)
	);
}

function getRouteStopPolylineIndices(route: PlannedRoute): number[] {
	const editableStops = getEditableRouteStops(route);
	const stopPoints = editableStops
		.map((stop) => stop.point)
		.filter((point): point is [number, number] => !!point);

	if (
		stopPoints.length !== editableStops.length ||
		route.coordinates.length === 0
	) {
		return [];
	}

	const stopIndices: number[] = [];
	let searchStartIndex = 0;

	for (const stopPoint of stopPoints) {
		const stopIndex = getNearestPolylineIndex(
			route.coordinates,
			stopPoint,
			searchStartIndex,
		);
		stopIndices.push(stopIndex);
		searchStartIndex = stopIndex;
	}

	return stopIndices;
}

function getCoordinateSegmentForRouteLeg(
	route: PlannedRoute,
	legIndex: number,
): { fromIndex: number; toIndex: number } | null {
	const segmentCount = getRouteSegmentCount(route);

	if (
		legIndex < 0 ||
		legIndex >= segmentCount ||
		route.coordinates.length < 2
	) {
		return null;
	}

	const stopIndices = getRouteStopPolylineIndices(route);

	if (route.mode === "round_course") {
		if (stopIndices.length <= 1) {
			return {
				fromIndex: 0,
				toIndex: route.coordinates.length - 1,
			};
		}

		const fromIndex = stopIndices[legIndex] ?? 0;
		const toIndex =
			legIndex === segmentCount - 1
				? route.coordinates.length - 1
				: (stopIndices[legIndex + 1] ?? route.coordinates.length - 1);

		return toIndex > fromIndex ? { fromIndex, toIndex } : null;
	}

	const fromIndex = stopIndices[legIndex] ?? 0;
	const toIndex = stopIndices[legIndex + 1] ?? route.coordinates.length - 1;

	return toIndex > fromIndex ? { fromIndex, toIndex } : null;
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
		features: sanitizedIndexes.flatMap((segmentIndex) => {
			const segment = getCoordinateSegmentForRouteLeg(route, segmentIndex);

			if (!segment) {
				return [];
			}

			const fromIndex = Math.max(0, segment.fromIndex);
			const toIndex = Math.min(route.coordinates.length - 1, segment.toIndex);

			if (toIndex <= fromIndex) {
				return [];
			}

			const coordinates = route.coordinates.slice(fromIndex, toIndex + 1);

			if (coordinates.length < 2) {
				return [];
			}

			return [
				{
					type: "Feature" as const,
					properties: {
						kind: "locked_segment" as const,
						segmentIndex,
					},
					geometry: {
						type: "LineString" as const,
						coordinates: coordinates as Position[],
					},
				},
			];
		}),
	};
}

export function getRouteLegIndexForCoordinateSegment(
	route: PlannedRoute,
	coordinateSegmentIndex: number,
): number | null {
	const segmentCount = getRouteSegmentCount(route);

	if (
		!Number.isInteger(coordinateSegmentIndex) ||
		coordinateSegmentIndex < 0 ||
		coordinateSegmentIndex >= route.coordinates.length - 1
	) {
		return null;
	}

	for (let legIndex = 0; legIndex < segmentCount; legIndex += 1) {
		const segment = getCoordinateSegmentForRouteLeg(route, legIndex);

		if (
			segment &&
			coordinateSegmentIndex >= segment.fromIndex &&
			coordinateSegmentIndex < segment.toIndex
		) {
			return legIndex;
		}
	}

	return null;
}

function getRouteLegInsertionIndex(
	stops: RouteStopInput[],
	point: [number, number],
	route: PlannedRoute,
): number | null {
	const routeStops = getRouteStopInputs(route);

	if (routeStops.length !== stops.length || route.coordinates.length === 0) {
		return null;
	}

	for (let index = 0; index < stops.length; index += 1) {
		const stop = stops[index];
		const routeStop = routeStops[index];

		if (!stop || !routeStop) {
			return null;
		}

		if (stop.label !== routeStop.label) {
			return null;
		}

		if (
			(stop.point && !routeStop.point) ||
			(!stop.point && routeStop.point) ||
			(stop.point &&
				routeStop.point &&
				(stop.point[0] !== routeStop.point[0] ||
					stop.point[1] !== routeStop.point[1]))
		) {
			return null;
		}
	}

	const routeStopPoints = routeStops
		.map((stop) => stop.point)
		.filter((stopPoint): stopPoint is [number, number] => !!stopPoint);

	if (routeStopPoints.length !== routeStops.length) {
		return null;
	}

	const stopIndices: number[] = [];
	let searchStartIndex = 0;

	for (const stopPoint of routeStopPoints) {
		const stopIndex = getNearestPolylineIndex(
			route.coordinates,
			stopPoint,
			searchStartIndex,
		);
		stopIndices.push(stopIndex);
		searchStartIndex = stopIndex;
	}

	for (let index = 0; index < stopIndices.length - 1; index += 1) {
		const currentIndex = stopIndices[index];
		const nextIndex = stopIndices[index + 1];

		if (
			currentIndex === undefined ||
			nextIndex === undefined ||
			nextIndex <= currentIndex
		) {
			return null;
		}
	}

	let bestLegIndex = 0;
	let bestLegDistance = Number.POSITIVE_INFINITY;

	for (let index = 0; index < stopIndices.length - 1; index += 1) {
		const fromIndex = stopIndices[index];
		const toIndex = stopIndices[index + 1];

		if (fromIndex === undefined || toIndex === undefined) {
			continue;
		}

		const legCoordinates = route.coordinates
			.slice(fromIndex, toIndex + 1)
			.map((coordinate) => toStopPoint(coordinate));
		const distance = getLegDistanceMeters(
			point,
			legCoordinates.length > 0
				? legCoordinates
				: [routeStopPoints[index], routeStopPoints[index + 1]],
		);

		if (distance < bestLegDistance) {
			bestLegDistance = distance;
			bestLegIndex = index;
		}
	}

	return bestLegIndex;
}

export function getWaypointInsertionIndex(
	stops: RouteStopInput[],
	point: [number, number],
	route: PlannedRoute | null = null,
): number {
	const routedLegIndex = route
		? getRouteLegInsertionIndex(stops, point, route)
		: null;

	if (typeof routedLegIndex === "number") {
		return routedLegIndex;
	}

	const resolvedStops = stops.filter(
		(stop) => stop.label.trim().length > 0 && !!stop.point,
	);

	if (resolvedStops.length < 2) {
		return Math.max(0, Math.min(stops.length - 1, resolvedStops.length - 1));
	}

	let bestLegIndex = 0;
	let bestLegDistance = Number.POSITIVE_INFINITY;

	for (let index = 0; index < resolvedStops.length - 1; index += 1) {
		const from = resolvedStops[index]?.point;
		const to = resolvedStops[index + 1]?.point;

		if (!from || !to) {
			continue;
		}

		const distance = getLegDistanceMeters(point, [from, to]);

		if (distance < bestLegDistance) {
			bestLegDistance = distance;
			bestLegIndex = index;
		}
	}

	return bestLegIndex;
}

export function sampleElevationProfile(
	coordinates: RouteCoordinate[],
	targetSamples = 40,
): ElevationProfilePoint[] {
	if (coordinates.length === 0) {
		return [];
	}

	let totalDistanceMeters = 0;
	let previousCoordinate = coordinates[0];
	const profilePoints: ElevationProfilePoint[] = [];

	for (const [index, coordinate] of coordinates.entries()) {
		if (index > 0 && previousCoordinate) {
			totalDistanceMeters += getCoordinateDistanceMeters(
				previousCoordinate,
				coordinate,
			);
		}

		previousCoordinate = coordinate;

		const elevationMeters = coordinate[2];

		if (elevationMeters === undefined || !Number.isFinite(elevationMeters)) {
			continue;
		}

		profilePoints.push({
			distanceMeters: totalDistanceMeters,
			elevationMeters,
			coordinate,
		});
	}

	if (profilePoints.length === 0) {
		return [];
	}

	const lastProfilePoint = profilePoints[profilePoints.length - 1];

	if (!lastProfilePoint) {
		return [];
	}

	const sampleCount = Math.max(targetSamples, 1);

	if (profilePoints.length <= sampleCount) {
		return profilePoints;
	}

	if (sampleCount === 1) {
		return [profilePoints[0] ?? lastProfilePoint];
	}

	const lastIndex = profilePoints.length - 1;
	const step = lastIndex / (sampleCount - 1);

	return Array.from({ length: sampleCount }, (_, index) => {
		const sampleIndex = Math.min(lastIndex, Math.round(index * step));
		return profilePoints[sampleIndex] ?? lastProfilePoint;
	});
}

export function getRouteElevationAnalysisPoints(
	coordinates: RouteCoordinate[],
): ClimbAnalysisPoint[] {
	let totalDistanceMeters = 0;
	let previousCoordinate = coordinates[0];
	const points: ClimbAnalysisPoint[] = [];

	for (const [index, coordinate] of coordinates.entries()) {
		if (index > 0 && previousCoordinate) {
			totalDistanceMeters += getCoordinateDistanceMeters(
				previousCoordinate,
				coordinate,
			);
		}

		previousCoordinate = coordinate;

		const elevationMeters = coordinate[2];

		if (elevationMeters === undefined || !Number.isFinite(elevationMeters)) {
			continue;
		}

		points.push({
			distanceMeters: totalDistanceMeters,
			elevationMeters,
			coordinate,
			rawRouteIndex: index,
		});
	}

	return points;
}

const climbDetectionThresholds = {
	minDistanceMeters: 500,
	minGainMeters: 30,
	minAverageGradePercent: 3,
	allowedDescentDistanceMeters: 150,
	allowedElevationLossMeters: 10,
	mergeGapMeters: 300,
	smoothingWindow: 3,
	keyClimbCount: 3,
} as const;

const gradientAnalysisMinWindowMeters = 100;

function smoothClimbPoints(points: ClimbAnalysisPoint[]): ClimbAnalysisPoint[] {
	const radius = Math.floor(climbDetectionThresholds.smoothingWindow / 2);

	return points.map((point, index) => {
		if (index === 0 || index === points.length - 1) {
			return point;
		}

		let elevationTotal = 0;
		let sampleCount = 0;

		for (
			let sampleIndex = Math.max(0, index - radius);
			sampleIndex <= Math.min(points.length - 1, index + radius);
			sampleIndex += 1
		) {
			const sample = points[sampleIndex];

			if (!sample || !Number.isFinite(sample.elevationMeters)) {
				continue;
			}

			elevationTotal += sample.elevationMeters;
			sampleCount += 1;
		}

		return {
			...point,
			elevationMeters:
				sampleCount > 0 ? elevationTotal / sampleCount : point.elevationMeters,
		};
	});
}

export function calculateRouteGradientMetrics(
	route: PlannedRoute,
): RouteGradientMetrics {
	const averageGradientPercent =
		Number.isFinite(route.distanceMeters) && route.distanceMeters > 0
			? (Math.max(0, route.ascendMeters) / route.distanceMeters) * 100
			: null;

	const validPoints = getRouteElevationAnalysisPoints(route.coordinates)
		.filter(
			(point) =>
				Number.isFinite(point.distanceMeters) &&
				Number.isFinite(point.elevationMeters),
		)
		.sort((a, b) => a.distanceMeters - b.distanceMeters);

	if (validPoints.length < 2) {
		return {
			averageGradientPercent,
			maximumGradientPercent: null,
		};
	}

	const smoothedPoints = smoothClimbPoints(validPoints);
	let maximumGradientPercent: number | null = null;
	let endIndex = 1;

	for (
		let startIndex = 0;
		startIndex < smoothedPoints.length - 1;
		startIndex += 1
	) {
		const start = smoothedPoints[startIndex];

		if (!start) continue;

		endIndex = Math.max(endIndex, startIndex + 1);

		while (endIndex < smoothedPoints.length) {
			const end = smoothedPoints[endIndex];

			if (!end) break;

			if (
				end.distanceMeters - start.distanceMeters >=
				gradientAnalysisMinWindowMeters
			) {
				break;
			}

			endIndex += 1;
		}

		const end = smoothedPoints[endIndex];

		if (!end) {
			continue;
		}

		const distanceMeters = end.distanceMeters - start.distanceMeters;
		const elevationGainMeters = end.elevationMeters - start.elevationMeters;

		if (distanceMeters <= 0 || elevationGainMeters <= 0) {
			continue;
		}

		const gradientPercent = (elevationGainMeters / distanceMeters) * 100;
		maximumGradientPercent =
			maximumGradientPercent === null
				? gradientPercent
				: Math.max(maximumGradientPercent, gradientPercent);
	}

	return {
		averageGradientPercent,
		maximumGradientPercent,
	};
}

export function classifyClimbCategory(
	score: number,
	elevationGainMeters: number,
): ClimbCategory {
	if (score >= 8000 && elevationGainMeters >= 500) return "HC";
	if (score >= 4800 && elevationGainMeters >= 300) return "Cat 1";
	if (score >= 3200 && elevationGainMeters >= 200) return "Cat 2";
	if (score >= 1600 && elevationGainMeters >= 100) return "Cat 3";
	if (score >= 800 && elevationGainMeters >= 50) return "Cat 4";

	return "Uncategorized";
}

function buildClimb(
	points: ClimbAnalysisPoint[],
	startIndex: number,
	endIndex: number,
): RouteClimb | null {
	const start = points[startIndex];
	const end = points[endIndex];

	if (!start || !end || endIndex <= startIndex) {
		return null;
	}

	const distanceMeters = end.distanceMeters - start.distanceMeters;
	const elevationGainMeters = end.elevationMeters - start.elevationMeters;
	const averageGradePercent =
		distanceMeters > 0 ? (elevationGainMeters / distanceMeters) * 100 : 0;

	if (
		distanceMeters < climbDetectionThresholds.minDistanceMeters ||
		elevationGainMeters < climbDetectionThresholds.minGainMeters ||
		averageGradePercent < climbDetectionThresholds.minAverageGradePercent
	) {
		return null;
	}

	let maxGradePercent = 0;

	for (let index = startIndex; index < endIndex; index += 1) {
		const from = points[index];
		const to = points[index + 1];

		if (!from || !to) continue;

		const segmentDistanceMeters = to.distanceMeters - from.distanceMeters;
		const segmentGainMeters = to.elevationMeters - from.elevationMeters;

		if (segmentDistanceMeters <= 0 || segmentGainMeters <= 0) continue;

		maxGradePercent = Math.max(
			maxGradePercent,
			(segmentGainMeters / segmentDistanceMeters) * 100,
		);
	}

	const score = elevationGainMeters * averageGradePercent;

	return {
		startIndex,
		endIndex,
		rawStartIndex: start.rawRouteIndex ?? startIndex,
		rawEndIndex: end.rawRouteIndex ?? endIndex,
		startDistanceMeters: start.distanceMeters,
		endDistanceMeters: end.distanceMeters,
		distanceMeters,
		elevationGainMeters,
		averageGradePercent,
		maxGradePercent,
		score,
		category: classifyClimbCategory(score, elevationGainMeters),
		isKeyClimb: false,
	};
}

function mergeAdjacentClimbs(
	points: ClimbAnalysisPoint[],
	climbs: RouteClimb[],
): RouteClimb[] {
	const merged: RouteClimb[] = [];

	for (const climb of climbs) {
		const previous = merged[merged.length - 1];

		if (!previous) {
			merged.push(climb);
			continue;
		}

		const gapMeters = climb.startDistanceMeters - previous.endDistanceMeters;
		const combined = buildClimb(points, previous.startIndex, climb.endIndex);

		if (
			gapMeters < climbDetectionThresholds.mergeGapMeters &&
			combined &&
			combined.elevationGainMeters > 0
		) {
			merged[merged.length - 1] = combined;
			continue;
		}

		merged.push(climb);
	}

	return merged;
}

function markKeyClimbs(climbs: RouteClimb[]): RouteClimb[] {
	const categoryRankByCategory: Record<ClimbCategory, number> = {
		HC: 5,
		"Cat 1": 4,
		"Cat 2": 3,
		"Cat 3": 2,
		"Cat 4": 1,
		Uncategorized: 0,
	};
	const categoryRank = (climb: RouteClimb) =>
		categoryRankByCategory[climb.category] ?? 0;
	const keyClimbIndexes = new Set(
		climbs
			.map((climb, index) => ({ climb, index }))
			.sort((a, b) => {
				const categoryDelta = categoryRank(b.climb) - categoryRank(a.climb);
				return categoryDelta || b.climb.score - a.climb.score;
			})
			.slice(0, climbDetectionThresholds.keyClimbCount)
			.map(({ index }) => index),
	);

	return climbs.map((climb, index) => ({
		...climb,
		isKeyClimb: keyClimbIndexes.has(index),
	}));
}

export function analyzeRouteClimbs(points: ClimbAnalysisPoint[]): RouteClimb[] {
	const validPoints = points
		.filter(
			(point) =>
				Number.isFinite(point.distanceMeters) &&
				Number.isFinite(point.elevationMeters),
		)
		.sort((a, b) => a.distanceMeters - b.distanceMeters);

	if (validPoints.length < 2) {
		return [];
	}

	const smoothedPoints = smoothClimbPoints(validPoints);
	const climbs: RouteClimb[] = [];
	let startIndex: number | null = null;
	let interruptionStartIndex: number | null = null;
	let interruptionStartDistance = 0;
	let interruptionStartElevation = 0;

	for (let index = 1; index < smoothedPoints.length; index += 1) {
		const previous = smoothedPoints[index - 1];
		const current = smoothedPoints[index];

		if (!previous || !current) continue;

		const elevationDelta = current.elevationMeters - previous.elevationMeters;

		if (elevationDelta > 0) {
			startIndex ??= index - 1;
			interruptionStartIndex = null;
			continue;
		}

		if (startIndex === null) {
			continue;
		}

		interruptionStartIndex ??= index - 1;
		const interruptionStart = smoothedPoints[interruptionStartIndex];

		if (!interruptionStart) continue;

		interruptionStartDistance = interruptionStart.distanceMeters;
		interruptionStartElevation = interruptionStart.elevationMeters;
		const interruptionDistance =
			current.distanceMeters - interruptionStartDistance;
		const interruptionLoss =
			interruptionStartElevation - current.elevationMeters;

		if (
			interruptionDistance <=
				climbDetectionThresholds.allowedDescentDistanceMeters &&
			interruptionLoss <= climbDetectionThresholds.allowedElevationLossMeters
		) {
			continue;
		}

		const candidate = buildClimb(
			smoothedPoints,
			startIndex,
			Math.max(startIndex, interruptionStartIndex),
		);

		if (candidate) climbs.push(candidate);

		startIndex = null;
		interruptionStartIndex = null;
	}

	if (startIndex !== null) {
		const candidate = buildClimb(
			smoothedPoints,
			startIndex,
			smoothedPoints.length - 1,
		);

		if (candidate) climbs.push(candidate);
	}

	return markKeyClimbs(mergeAdjacentClimbs(smoothedPoints, climbs));
}

export function getSurfaceMix(route: PlannedRoute) {
	const totals = {
		smooth: 0,
		mixed: 0,
		coarse: 0,
	};

	for (const detail of route.surfaceDetails) {
		const span = Math.max(detail.to - detail.from, 0);
		if (span === 0) continue;
		const bucket = classifySurfaceValue(detail.value);

		if (!bucket) continue;

		totals[bucket] += span;
	}

	if (totals.smooth + totals.mixed + totals.coarse === 0) {
		for (const detail of route.smoothnessDetails) {
			const span = Math.max(detail.to - detail.from, 0);
			if (span === 0) continue;

			const normalizedValue = normalizeDetailValue(detail.value);

			if (smoothnessSurfaceFallback.smooth.has(normalizedValue)) {
				totals.smooth += span;
				continue;
			}

			if (smoothnessSurfaceFallback.mixed.has(normalizedValue)) {
				totals.mixed += span;
				continue;
			}

			totals.coarse += span;
		}
	}

	const total = totals.smooth + totals.mixed + totals.coarse;

	if (total === 0) {
		return [];
	}

	const smoothPct = Math.round((totals.smooth / total) * 100);
	const mixedPct = Math.round((totals.mixed / total) * 100);
	const coarsePct = Math.round((totals.coarse / total) * 100);

	return [
		{
			label: "Smooth asphalt",
			pct: smoothPct,
			className: "bg-emerald-500",
		},
		{
			label: "Mixed / worn",
			pct: mixedPct,
			className: "bg-amber-500",
		},
		{
			label: "Coarse / rough",
			pct: coarsePct,
			className: "bg-orange-600",
		},
	].filter((item) => item.pct > 0);
}

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

function getDetailIntervalDistanceMeters(
	route: PlannedRoute,
	detail: RouteDetailInterval,
): number {
	const from = Math.max(0, Math.trunc(detail.from));
	const to = Math.min(route.coordinates.length - 1, Math.trunc(detail.to));
	let distanceMeters = 0;

	for (let index = from; index < to; index += 1) {
		const left = route.coordinates[index];
		const right = route.coordinates[index + 1];

		if (!left || !right) continue;

		distanceMeters += getCoordinateDistanceMeters(left, right);
	}

	return distanceMeters;
}

function getSurfaceDistanceTotals(route: PlannedRoute): {
	smooth: number;
	mixed: number;
	coarse: number;
	total: number;
} {
	const totals = {
		smooth: 0,
		mixed: 0,
		coarse: 0,
	};
	const addDetails = (
		details: RouteDetailInterval[],
		classify: (value: string) => keyof typeof totals | null,
	) => {
		for (const detail of details) {
			const bucket = classify(detail.value);

			if (!bucket) continue;

			totals[bucket] += getDetailIntervalDistanceMeters(route, detail);
		}
	};

	addDetails(route.surfaceDetails, classifySurfaceValue);

	if (totals.smooth + totals.mixed + totals.coarse === 0) {
		addDetails(route.smoothnessDetails, classifySmoothnessSurfaceFallbackValue);
	}

	return {
		...totals,
		total: totals.smooth + totals.mixed + totals.coarse,
	};
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
		!getProviderWarnings(route).some(
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

	const climbs = analyzeRouteClimbs(
		getRouteElevationAnalysisPoints(route.coordinates),
	);
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
