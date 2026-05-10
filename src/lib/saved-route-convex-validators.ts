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
	surfaceDetails: v.array(routeDetailIntervalValidator),
	smoothnessDetails: v.array(routeDetailIntervalValidator),
	windAnalysis: v.optional(routeWindAnalysisValidator),
});

export const remoteSavedRoutePayloadValidator = v.object({
	id: v.string(),
	createdAt: v.string(),
	routeJson: v.string(),
});
