import type { FeatureCollection } from "geojson";

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
	  }
	| {
			kind: "workout";
			durationMs: number;
			distanceMeters: number;
			estimatedSpeedMetersPerHour: number;
			weightedIntensity: number;
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

export type RouteGradientSection = {
	bucket: RouteGradientBucket;
	startDistanceMeters: number;
	endDistanceMeters: number;
	distanceMeters: number;
	elevationDeltaMeters: number;
	averageGradePercent: number;
	coordinates: RouteCoordinate[];
};

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
	| "low_route_quality"
	| "high_traffic_stress"
	| "high_interruption_risk"
	| "high_urban_exposure"
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

export type RouteQualityBand = "excellent" | "good" | "mixed" | "poor";
export type RouteQualityConfidence = "high" | "medium" | "low";
export type RouteQualityFlag = {
	code:
		| "low_route_quality"
		| "high_traffic_stress"
		| "high_interruption_risk"
		| "high_urban_exposure";
	severity: RouteWarningSeverity;
	label: string;
	summary: string;
};
export type RouteQualitySubscore = {
	score: number | null;
	label: string;
	summary: string;
	available: boolean;
	weight: number;
};
export type RouteQualityAnalysis = {
	version: 1;
	overallScore: number | null;
	band: RouteQualityBand | "unknown";
	confidence: RouteQualityConfidence;
	subscores: {
		surface: RouteQualitySubscore;
		trafficStress: RouteQualitySubscore;
		flow: RouteQualitySubscore;
		safety: RouteQualitySubscore;
		roadQuality: RouteQualitySubscore;
		urbanExposure: RouteQualitySubscore;
		interruptionRisk: RouteQualitySubscore;
		windExposure: RouteQualitySubscore;
		gradientSuitability: RouteQualitySubscore;
		routeEfficiency: RouteQualitySubscore;
	};
	flags: RouteQualityFlag[];
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
	roadClassDetails?: RouteDetailInterval[];
	roadEnvironmentDetails?: RouteDetailInterval[];
	roadAccessDetails?: RouteDetailInterval[];
	bikeNetworkDetails?: RouteDetailInterval[];
	windAnalysis?: RouteWindAnalysis;
	routeQuality?: RouteQualityAnalysis;
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
