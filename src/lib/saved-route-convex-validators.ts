import { v } from "convex/values";

const routeModeValidator = v.union(
	v.literal("point_to_point"),
	v.literal("round_course"),
	v.literal("out_and_back"),
);

// Convex validators are transport/database shape gates required at the Convex
// boundary. Effect schemas plus saved-route normalization remain the semantic
// source of truth after this boundary.
//
// Convex does not provide tuple or min-length array validators. Tuple lengths,
// coordinate counts, closed polygons, legacy defaults, timestamps, and
// manual-edit sanitization are enforced by saved-route normalization.
const routeCoordinateValidator = v.array(v.number());
const routePointValidator = v.array(v.number());

const routeSourceValidator = v.union(
	v.object({
		kind: v.literal("graphhopper"),
	}),
	v.object({
		kind: v.literal("gpx_import"),
		filename: v.string(),
		stopDerivation: v.union(
			v.literal("rtept"),
			v.literal("wpt"),
			v.literal("track"),
		),
		hasDuration: v.boolean(),
	}),
);

const roundCourseTargetValidator = v.union(
	v.object({
		kind: v.literal("distance"),
		distanceMeters: v.number(),
	}),
	v.object({
		kind: v.literal("duration"),
		durationMs: v.number(),
	}),
	v.object({
		kind: v.literal("ascend"),
		ascendMeters: v.number(),
	}),
	v.object({
		kind: v.literal("workout"),
		durationMs: v.number(),
		distanceMeters: v.number(),
		estimatedSpeedMetersPerHour: v.number(),
		weightedIntensity: v.number(),
	}),
);

const spatialConstraintEnforcementValidator = v.union(
	v.literal("strict"),
	v.literal("preferred"),
);

const spatialConstraintValidator = v.union(
	v.object({
		kind: v.literal("area"),
		label: v.string(),
		center: routePointValidator,
		radiusMeters: v.number(),
		enforcement: spatialConstraintEnforcementValidator,
		polygon: v.array(routePointValidator),
	}),
	v.object({
		kind: v.literal("corridor"),
		widthMeters: v.number(),
		enforcement: spatialConstraintEnforcementValidator,
		polygon: v.array(routePointValidator),
	}),
);

const routeAvoidanceValidator = v.object({
	kind: v.literal("road_segment"),
	label: v.string(),
	centerline: v.array(routePointValidator),
	bufferMeters: v.number(),
	polygon: v.array(routePointValidator),
});

const routeDetailIntervalValidator = v.object({
	from: v.number(),
	to: v.number(),
	value: v.string(),
});

const routeInstructionTypeValidator = v.union(
	v.literal("continue"),
	v.literal("slight_left"),
	v.literal("left"),
	v.literal("sharp_left"),
	v.literal("slight_right"),
	v.literal("right"),
	v.literal("sharp_right"),
	v.literal("u_turn"),
	v.literal("roundabout"),
	v.literal("leave_roundabout"),
	v.literal("keep_left"),
	v.literal("keep_right"),
	v.literal("via"),
	v.literal("finish"),
	v.literal("unknown"),
);

const routeInstructionValidator = v.object({
	distanceFromStartMeters: v.number(),
	text: v.string(),
	sign: v.number(),
	type: routeInstructionTypeValidator,
	segmentDistanceMeters: v.number(),
	segmentTimeMs: v.number(),
	coordinateIndex: v.number(),
	coordinate: routeCoordinateValidator,
	interval: v.array(v.number()),
});

const routeWaypointValidator = v.object({
	label: v.string(),
	coordinate: routeCoordinateValidator,
});

const manualRouteEditingValidator = v.object({
	lockedSegmentIndexes: v.array(v.number()),
});

const windDirectionBucketValidator = v.union(
	v.literal("headwind"),
	v.literal("cross_headwind"),
	v.literal("crosswind"),
	v.literal("cross_tailwind"),
	v.literal("tailwind"),
);

const routeWindSampleValidator = v.object({
	coordinate: routePointValidator,
	speedKmh: v.number(),
	directionDegrees: v.number(),
	time: v.string(),
	source: v.literal("open_meteo"),
});

const routeWindSegmentValidator = v.object({
	from: v.number(),
	to: v.number(),
	speedKmh: v.number(),
	directionDegrees: v.number(),
	routeBearingDegrees: v.number(),
	relativeAngleDegrees: v.number(),
	headwindComponentKmh: v.number(),
	crosswindComponentKmh: v.number(),
	bucket: windDirectionBucketValidator,
});

const routeWindAnalysisValidator = v.object({
	source: v.literal("open_meteo"),
	fetchedAt: v.string(),
	forecastTime: v.string(),
	samples: v.array(routeWindSampleValidator),
	segments: v.array(routeWindSegmentValidator),
	averageHeadwindKmh: v.number(),
	maxHeadwindKmh: v.number(),
	averageTailwindKmh: v.number(),
	maxCrosswindKmh: v.number(),
	headwindDistanceMeters: v.number(),
	tailwindDistanceMeters: v.number(),
	crosswindDistanceMeters: v.number(),
});

const routeWarningSeverityValidator = v.union(
	v.literal("info"),
	v.literal("caution"),
	v.literal("warning"),
);

const routeWarningCategoryValidator = v.union(
	v.literal("readiness"),
	v.literal("routing_provider"),
);

const routeWarningCodeValidator = v.union(
	v.literal("coarse_surface_exposure"),
	v.literal("mixed_surface_exposure"),
	v.literal("strong_headwind_exposure"),
	v.literal("strong_crosswind_exposure"),
	v.literal("steep_gradient"),
	v.literal("major_climb"),
	v.literal("low_route_efficiency"),
	v.literal("low_route_quality"),
	v.literal("high_traffic_stress"),
	v.literal("high_interruption_risk"),
	v.literal("high_urban_exposure"),
	v.literal("surface_analysis_unavailable"),
	v.literal("wind_analysis_unavailable"),
	v.literal("routing_profile_fallback"),
);

const routeWarningValidator = v.object({
	category: routeWarningCategoryValidator,
	code: routeWarningCodeValidator,
	severity: routeWarningSeverityValidator,
	title: v.string(),
	message: v.string(),
	metricLabel: v.optional(v.string()),
	metricValue: v.optional(v.string()),
});

const routeQualityBandValidator = v.union(
	v.literal("excellent"),
	v.literal("good"),
	v.literal("mixed"),
	v.literal("poor"),
	v.literal("unknown"),
);

const routeQualityConfidenceValidator = v.union(
	v.literal("high"),
	v.literal("medium"),
	v.literal("low"),
);

const routeQualitySubscoreValidator = v.object({
	score: v.union(v.number(), v.null()),
	label: v.string(),
	summary: v.string(),
	available: v.boolean(),
	weight: v.number(),
});

const routeQualityFlagValidator = v.object({
	code: v.union(
		v.literal("low_route_quality"),
		v.literal("high_traffic_stress"),
		v.literal("high_interruption_risk"),
		v.literal("high_urban_exposure"),
	),
	severity: routeWarningSeverityValidator,
	label: v.string(),
	summary: v.string(),
});

const routeQualityAnalysisValidator = v.object({
	version: v.literal(1),
	overallScore: v.union(v.number(), v.null()),
	band: routeQualityBandValidator,
	confidence: routeQualityConfidenceValidator,
	subscores: v.object({
		surface: routeQualitySubscoreValidator,
		trafficStress: routeQualitySubscoreValidator,
		flow: routeQualitySubscoreValidator,
		safety: routeQualitySubscoreValidator,
		roadQuality: routeQualitySubscoreValidator,
		urbanExposure: routeQualitySubscoreValidator,
		interruptionRisk: routeQualitySubscoreValidator,
		windExposure: routeQualitySubscoreValidator,
		gradientSuitability: routeQualitySubscoreValidator,
		routeEfficiency: routeQualitySubscoreValidator,
	}),
	flags: v.array(routeQualityFlagValidator),
});

export const plannedRouteValidator = v.object({
	mode: v.optional(routeModeValidator),
	source: v.optional(routeSourceValidator),
	startLabel: v.string(),
	destinationLabel: v.string(),
	requestedDistanceMeters: v.optional(v.number()),
	roundCourseTarget: v.optional(roundCourseTargetValidator),
	spatialConstraint: v.optional(spatialConstraintValidator),
	avoidances: v.optional(v.array(routeAvoidanceValidator)),
	routingProfile: v.optional(v.string()),
	routingStrategy: v.optional(v.string()),
	warnings: v.optional(v.array(routeWarningValidator)),
	routingWarnings: v.optional(v.array(v.string())),
	manualEditing: v.optional(manualRouteEditingValidator),
	waypoints: v.optional(v.array(routeWaypointValidator)),
	// Exact [minLng, minLat, maxLng, maxLat] length is checked by
	// normalizePlannedRoute after Convex shape validation.
	bounds: v.array(v.number()),
	distanceMeters: v.number(),
	durationMs: v.number(),
	ascendMeters: v.number(),
	descendMeters: v.number(),
	coordinates: v.array(routeCoordinateValidator),
	instructions: v.optional(v.array(routeInstructionValidator)),
	surfaceDetails: v.array(routeDetailIntervalValidator),
	smoothnessDetails: v.array(routeDetailIntervalValidator),
	roadClassDetails: v.optional(v.array(routeDetailIntervalValidator)),
	roadEnvironmentDetails: v.optional(v.array(routeDetailIntervalValidator)),
	roadAccessDetails: v.optional(v.array(routeDetailIntervalValidator)),
	bikeNetworkDetails: v.optional(v.array(routeDetailIntervalValidator)),
	windAnalysis: v.optional(routeWindAnalysisValidator),
	routeQuality: v.optional(routeQualityAnalysisValidator),
});

export const remoteSavedRoutePayloadValidator = v.object({
	id: v.string(),
	createdAt: v.string(),
	routeJson: v.string(),
});
