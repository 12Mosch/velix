import { Schema, SchemaGetter } from "effect";

import type {
	PlannedRoute,
	ResolvedRouteAvoidance,
	ResolvedRouteSpatialConstraint,
	RoundCourseTarget,
	RouteApiError,
	RouteApiSuccess,
	RouteCoordinate,
	RouteMode,
	RouteAvoidanceInput,
	RouteSpatialConstraintInput,
	RouteStopInput,
} from "./route-planning";
import {
	WorkoutTrainingProfileSchema,
	WorkoutTrainingSessionKindSchema,
} from "./workout-plan";

const finiteCoordinateInput = Schema.TupleWithRest(
	Schema.Tuple([Schema.Finite, Schema.Finite]),
	[Schema.Finite],
);

function isBoundedCoordinate2(value: unknown): value is [number, number] {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === "number" &&
		Number.isFinite(value[0]) &&
		value[0] >= -180 &&
		value[0] <= 180 &&
		typeof value[1] === "number" &&
		Number.isFinite(value[1]) &&
		value[1] >= -90 &&
		value[1] <= 90
	);
}

const coordinate2Schema =
	Schema.declare<[number, number]>(isBoundedCoordinate2);

export const RouteCoordinateInputSchema = finiteCoordinateInput.pipe(
	Schema.decodeTo(coordinate2Schema, {
		decode: SchemaGetter.transform((coordinate) => [
			coordinate[0],
			coordinate[1],
		]),
		encode: SchemaGetter.transform((coordinate) => coordinate),
	}),
);

export const RouteStopInputSchema = Schema.Union([
	Schema.String,
	Schema.Struct({
		label: Schema.optionalKey(Schema.String),
		point: Schema.optionalKey(RouteCoordinateInputSchema),
	}),
]);

export const RoundCourseTargetSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("distance"),
		distanceMeters: Schema.Finite,
	}),
	Schema.Struct({
		kind: Schema.Literal("duration"),
		durationMs: Schema.Finite,
	}),
	Schema.Struct({
		kind: Schema.Literal("ascend"),
		ascendMeters: Schema.Finite,
	}),
	Schema.Struct({
		kind: Schema.Literal("workout"),
		durationMs: Schema.Finite,
		distanceMeters: Schema.Finite,
		estimatedSpeedMetersPerHour: Schema.Finite,
		weightedIntensity: Schema.Finite,
		trainingProfile: Schema.optionalKey(
			Schema.UndefinedOr(WorkoutTrainingProfileSchema),
		),
	}),
]);

export const RouteSpatialConstraintInputSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("area"),
		center: RouteStopInputSchema,
		radiusMeters: Schema.Finite,
		enforcement: Schema.optionalKey(Schema.Unknown),
	}),
	Schema.Struct({
		kind: Schema.Literal("corridor"),
		widthMeters: Schema.Finite,
		enforcement: Schema.optionalKey(Schema.Unknown),
	}),
]);

export const RouteAvoidanceInputSchema = Schema.Struct({
	kind: Schema.Literal("road_segment"),
	centerline: Schema.mutable(Schema.Array(RouteCoordinateInputSchema)),
	bufferMeters: Schema.Finite,
	label: Schema.optionalKey(Schema.String),
});

export const ManualRouteEditingInputSchema = Schema.Struct({
	lockedSegmentIndexes: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

export const StructuredRouteRequestPayloadSchema = Schema.Struct({
	mode: Schema.optionalKey(
		Schema.Literals(["point_to_point", "round_course", "out_and_back"]),
	),
	start: Schema.optionalKey(RouteStopInputSchema),
	waypoints: Schema.optionalKey(Schema.Unknown),
	destination: Schema.optionalKey(RouteStopInputSchema),
	turnaround: Schema.optionalKey(RouteStopInputSchema),
	target: Schema.optionalKey(Schema.Unknown),
	requestedDistanceMeters: Schema.optionalKey(Schema.Unknown),
	spatialConstraint: Schema.optionalKey(Schema.Unknown),
	avoidances: Schema.optionalKey(Schema.Unknown),
	manualEditing: Schema.optionalKey(Schema.Unknown),
});

export const LegacyRouteRequestPayloadSchema = Schema.Struct({
	startQuery: Schema.optionalKey(Schema.String),
	waypointQueries: Schema.optionalKey(Schema.Array(Schema.String)),
	destinationQuery: Schema.optionalKey(Schema.String),
});

export const RouteRequestPayloadInputSchema = Schema.Struct({
	mode: Schema.optionalKey(
		Schema.Literals(["point_to_point", "round_course", "out_and_back"]),
	),
	start: Schema.optionalKey(RouteStopInputSchema),
	waypoints: Schema.optionalKey(Schema.Unknown),
	destination: Schema.optionalKey(RouteStopInputSchema),
	turnaround: Schema.optionalKey(RouteStopInputSchema),
	target: Schema.optionalKey(Schema.Unknown),
	requestedDistanceMeters: Schema.optionalKey(Schema.Unknown),
	spatialConstraint: Schema.optionalKey(Schema.Unknown),
	avoidances: Schema.optionalKey(Schema.Unknown),
	manualEditing: Schema.optionalKey(Schema.Unknown),
	startQuery: Schema.optionalKey(Schema.String),
	waypointQueries: Schema.optionalKey(Schema.Unknown),
	destinationQuery: Schema.optionalKey(Schema.String),
});

export const RouteModeSchema = Schema.Literals([
	"point_to_point",
	"round_course",
	"out_and_back",
]);
export const RouteCoordinate2Schema = Schema.mutable(
	Schema.Tuple([Schema.Finite, Schema.Finite]),
);
export const RouteCoordinate3Schema = Schema.mutable(
	Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]),
);
export const RouteCoordinateSchema = Schema.Union([
	RouteCoordinate2Schema,
	RouteCoordinate3Schema,
]);
export const WindDirectionBucketSchema = Schema.Literals([
	"headwind",
	"cross_headwind",
	"crosswind",
	"cross_tailwind",
	"tailwind",
]);
export const RouteWindSampleSchema = Schema.Struct({
	coordinate: RouteCoordinate2Schema,
	speedKmh: Schema.Finite,
	directionDegrees: Schema.Finite,
	time: Schema.String,
	source: Schema.Literal("open_meteo"),
});
export const RouteWindSegmentSchema = Schema.Struct({
	from: Schema.Finite,
	to: Schema.Finite,
	speedKmh: Schema.Finite,
	directionDegrees: Schema.Finite,
	routeBearingDegrees: Schema.Finite,
	relativeAngleDegrees: Schema.Finite,
	headwindComponentKmh: Schema.Finite,
	crosswindComponentKmh: Schema.Finite,
	bucket: WindDirectionBucketSchema,
});
export const RouteWindAnalysisSchema = Schema.Struct({
	source: Schema.Literal("open_meteo"),
	fetchedAt: Schema.String,
	forecastTime: Schema.String,
	samples: Schema.mutable(Schema.Array(RouteWindSampleSchema)),
	segments: Schema.mutable(Schema.Array(RouteWindSegmentSchema)),
	averageHeadwindKmh: Schema.Finite,
	maxHeadwindKmh: Schema.Finite,
	averageTailwindKmh: Schema.Finite,
	maxCrosswindKmh: Schema.Finite,
	headwindDistanceMeters: Schema.Finite,
	tailwindDistanceMeters: Schema.Finite,
	crosswindDistanceMeters: Schema.Finite,
});
export const RouteWarningSeveritySchema = Schema.Literals([
	"info",
	"caution",
	"warning",
]);
export const RouteWarningCategorySchema = Schema.Literals([
	"readiness",
	"routing_provider",
]);
export const RouteWarningCodeSchema = Schema.Literals([
	"coarse_surface_exposure",
	"mixed_surface_exposure",
	"strong_headwind_exposure",
	"strong_crosswind_exposure",
	"steep_gradient",
	"major_climb",
	"low_route_efficiency",
	"low_route_quality",
	"high_traffic_stress",
	"high_interruption_risk",
	"high_urban_exposure",
	"surface_analysis_unavailable",
	"wind_analysis_unavailable",
	"routing_profile_fallback",
]);
export const RouteWarningSchema = Schema.Struct({
	category: RouteWarningCategorySchema,
	code: RouteWarningCodeSchema,
	severity: RouteWarningSeveritySchema,
	title: Schema.String,
	message: Schema.String,
	metricLabel: Schema.optionalKey(Schema.UndefinedOr(Schema.String)),
	metricValue: Schema.optionalKey(Schema.UndefinedOr(Schema.String)),
});
export const RouteDetailIntervalSchema = Schema.Struct({
	from: Schema.Finite,
	to: Schema.Finite,
	value: Schema.String,
});
export const RouteQualityBandSchema = Schema.Literals([
	"excellent",
	"good",
	"mixed",
	"poor",
]);
export const RouteQualityConfidenceSchema = Schema.Literals([
	"high",
	"medium",
	"low",
]);
export const RouteQualitySubscoreSchema = Schema.Struct({
	score: Schema.NullOr(Schema.Finite),
	label: Schema.String,
	summary: Schema.String,
	available: Schema.Boolean,
	weight: Schema.Finite,
});
export const RouteQualityFlagSchema = Schema.Struct({
	code: Schema.Literals([
		"low_route_quality",
		"high_traffic_stress",
		"high_interruption_risk",
		"high_urban_exposure",
	]),
	severity: RouteWarningSeveritySchema,
	label: Schema.String,
	summary: Schema.String,
});
export const RouteQualityAnalysisSchema = Schema.Struct({
	version: Schema.Literal(1),
	overallScore: Schema.NullOr(Schema.Finite),
	band: Schema.Union([RouteQualityBandSchema, Schema.Literal("unknown")]),
	confidence: RouteQualityConfidenceSchema,
	subscores: Schema.Struct({
		surface: RouteQualitySubscoreSchema,
		trafficStress: RouteQualitySubscoreSchema,
		flow: RouteQualitySubscoreSchema,
		safety: RouteQualitySubscoreSchema,
		roadQuality: RouteQualitySubscoreSchema,
		urbanExposure: RouteQualitySubscoreSchema,
		interruptionRisk: RouteQualitySubscoreSchema,
		windExposure: RouteQualitySubscoreSchema,
		gradientSuitability: RouteQualitySubscoreSchema,
		routeEfficiency: RouteQualitySubscoreSchema,
	}),
	flags: Schema.mutable(Schema.Array(RouteQualityFlagSchema)),
});
export const RouteTrainingSuitabilitySubscoreSchema = Schema.Struct({
	score: Schema.NullOr(Schema.Finite),
	label: Schema.String,
	summary: Schema.String,
	available: Schema.Boolean,
	weight: Schema.Finite,
});
export const RouteTrainingSuitabilityFlagSchema = Schema.Struct({
	code: Schema.Literals([
		"duration_mismatch",
		"distance_mismatch",
		"poor_interval_flow",
		"unsafe_training_context",
		"rough_training_surface",
		"demanding_training_gradient",
	]),
	severity: RouteWarningSeveritySchema,
	label: Schema.String,
	summary: Schema.String,
});
export const RouteTrainingSuitabilityAnalysisSchema = Schema.Struct({
	version: Schema.Literal(1),
	overallScore: Schema.NullOr(Schema.Finite),
	band: Schema.Union([RouteQualityBandSchema, Schema.Literal("unknown")]),
	confidence: RouteQualityConfidenceSchema,
	sessionKind: Schema.Union([
		WorkoutTrainingSessionKindSchema,
		Schema.Literal("unknown"),
	]),
	summary: Schema.String,
	subscores: Schema.Struct({
		durationMatch: RouteTrainingSuitabilitySubscoreSchema,
		distanceMatch: RouteTrainingSuitabilitySubscoreSchema,
		surfaceFit: RouteTrainingSuitabilitySubscoreSchema,
		flowFit: RouteTrainingSuitabilitySubscoreSchema,
		safetyFit: RouteTrainingSuitabilitySubscoreSchema,
		terrainFit: RouteTrainingSuitabilitySubscoreSchema,
	}),
	flags: Schema.mutable(Schema.Array(RouteTrainingSuitabilityFlagSchema)),
});
export const RouteInstructionTypeSchema = Schema.Literals([
	"continue",
	"slight_left",
	"left",
	"sharp_left",
	"slight_right",
	"right",
	"sharp_right",
	"u_turn",
	"roundabout",
	"leave_roundabout",
	"keep_left",
	"keep_right",
	"via",
	"finish",
	"unknown",
]);
export const RouteInstructionSchema = Schema.Struct({
	distanceFromStartMeters: Schema.Finite,
	text: Schema.String,
	sign: Schema.Finite,
	type: RouteInstructionTypeSchema,
	segmentDistanceMeters: Schema.Finite,
	segmentTimeMs: Schema.Finite,
	coordinateIndex: Schema.Finite,
	coordinate: RouteCoordinateSchema,
	interval: Schema.mutable(Schema.Tuple([Schema.Finite, Schema.Finite])),
});
export const ManualRouteEditingStateSchema = Schema.Struct({
	lockedSegmentIndexes: Schema.mutable(Schema.Array(Schema.Finite)),
});
export const ResolvedRouteSpatialConstraintSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("area"),
		label: Schema.String,
		center: RouteCoordinate2Schema,
		radiusMeters: Schema.Finite,
		enforcement: Schema.Literals(["strict", "preferred"]),
		polygon: Schema.mutable(Schema.Array(RouteCoordinate2Schema)),
	}),
	Schema.Struct({
		kind: Schema.Literal("corridor"),
		widthMeters: Schema.Finite,
		enforcement: Schema.Literals(["strict", "preferred"]),
		polygon: Schema.mutable(Schema.Array(RouteCoordinate2Schema)),
	}),
]);
export const ResolvedRouteAvoidanceSchema = Schema.Struct({
	kind: Schema.Literal("road_segment"),
	label: Schema.String,
	centerline: Schema.mutable(Schema.Array(RouteCoordinate2Schema)),
	bufferMeters: Schema.Finite,
	polygon: Schema.mutable(Schema.Array(RouteCoordinate2Schema)),
});
export const RouteSourceSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("graphhopper"),
	}),
	Schema.Struct({
		kind: Schema.Literal("gpx_import"),
		filename: Schema.String,
		stopDerivation: Schema.Literals(["rtept", "wpt", "track"]),
		hasDuration: Schema.Boolean,
	}),
]);
export const PlannedRouteSchema = Schema.Struct({
	mode: RouteModeSchema,
	source: RouteSourceSchema,
	startLabel: Schema.String,
	destinationLabel: Schema.String,
	requestedDistanceMeters: Schema.optionalKey(
		Schema.UndefinedOr(Schema.Finite),
	),
	roundCourseTarget: Schema.optionalKey(
		Schema.UndefinedOr(RoundCourseTargetSchema),
	),
	spatialConstraint: Schema.optionalKey(
		Schema.UndefinedOr(ResolvedRouteSpatialConstraintSchema),
	),
	avoidances: Schema.optionalKey(
		Schema.UndefinedOr(
			Schema.mutable(Schema.Array(ResolvedRouteAvoidanceSchema)),
		),
	),
	routingProfile: Schema.optionalKey(Schema.UndefinedOr(Schema.String)),
	routingStrategy: Schema.optionalKey(Schema.UndefinedOr(Schema.String)),
	warnings: Schema.optionalKey(
		Schema.UndefinedOr(Schema.mutable(Schema.Array(RouteWarningSchema))),
	),
	routingWarnings: Schema.optionalKey(
		Schema.UndefinedOr(Schema.mutable(Schema.Array(Schema.String))),
	),
	manualEditing: Schema.optionalKey(
		Schema.UndefinedOr(ManualRouteEditingStateSchema),
	),
	waypoints: Schema.mutable(
		Schema.Array(
			Schema.Struct({
				label: Schema.String,
				coordinate: RouteCoordinateSchema,
			}),
		),
	),
	bounds: Schema.mutable(
		Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
	),
	distanceMeters: Schema.Finite,
	durationMs: Schema.Finite,
	ascendMeters: Schema.Finite,
	descendMeters: Schema.Finite,
	coordinates: Schema.mutable(Schema.Array(RouteCoordinateSchema)),
	instructions: Schema.optionalKey(
		Schema.UndefinedOr(Schema.mutable(Schema.Array(RouteInstructionSchema))),
	),
	surfaceDetails: Schema.mutable(Schema.Array(RouteDetailIntervalSchema)),
	smoothnessDetails: Schema.mutable(Schema.Array(RouteDetailIntervalSchema)),
	roadClassDetails: Schema.optionalKey(
		Schema.UndefinedOr(Schema.mutable(Schema.Array(RouteDetailIntervalSchema))),
	),
	roadEnvironmentDetails: Schema.optionalKey(
		Schema.UndefinedOr(Schema.mutable(Schema.Array(RouteDetailIntervalSchema))),
	),
	roadAccessDetails: Schema.optionalKey(
		Schema.UndefinedOr(Schema.mutable(Schema.Array(RouteDetailIntervalSchema))),
	),
	bikeNetworkDetails: Schema.optionalKey(
		Schema.UndefinedOr(Schema.mutable(Schema.Array(RouteDetailIntervalSchema))),
	),
	windAnalysis: Schema.optionalKey(Schema.UndefinedOr(RouteWindAnalysisSchema)),
	routeQuality: Schema.optionalKey(
		Schema.UndefinedOr(RouteQualityAnalysisSchema),
	),
	trainingSuitability: Schema.optionalKey(
		Schema.UndefinedOr(RouteTrainingSuitabilityAnalysisSchema),
	),
});
export const SavedRouteSchema = Schema.Struct({
	id: Schema.String,
	createdAt: Schema.String,
	route: PlannedRouteSchema,
});
export const RemoteSavedRoutePayloadSchema = Schema.Struct({
	id: Schema.String,
	createdAt: Schema.String,
	routeJson: Schema.String,
});
const RoundCourseCandidateErrorSchema = Schema.Struct({
	roundIndex: Schema.Finite,
	candidateIndex: Schema.Finite,
	sequence: Schema.Finite,
	requestedDistanceMeters: Schema.Finite,
	seed: Schema.optionalKey(Schema.UndefinedOr(Schema.Finite)),
	errorTag: Schema.String,
	message: Schema.String,
	status: Schema.optionalKey(Schema.UndefinedOr(Schema.Finite)),
});

export const RouteApiSuccessSchema = Schema.Struct({
	routes: Schema.Array(PlannedRouteSchema),
	selectedRouteIndex: Schema.Finite,
	roundCourseCandidateErrors: Schema.optionalKey(
		Schema.Array(RoundCourseCandidateErrorSchema),
	),
});

export const RouteApiErrorSchema = Schema.Struct({
	error: Schema.String,
	fieldErrors: Schema.optionalKey(
		Schema.Struct({
			startQuery: Schema.optionalKey(Schema.String),
			destinationQuery: Schema.optionalKey(Schema.String),
			waypointQueries: Schema.optionalKey(Schema.Array(Schema.String)),
			roundCourseTarget: Schema.optionalKey(Schema.String),
			spatialConstraint: Schema.optionalKey(Schema.String),
			avoidances: Schema.optionalKey(Schema.String),
		}),
	),
	roundCourseCandidateErrors: Schema.optionalKey(
		Schema.Array(RoundCourseCandidateErrorSchema),
	),
});

export type RouteRequestPayloadInput =
	typeof RouteRequestPayloadInputSchema.Type;
export type StructuredRouteRequestPayloadInput =
	typeof StructuredRouteRequestPayloadSchema.Type;
export type LegacyRouteRequestPayloadInput =
	typeof LegacyRouteRequestPayloadSchema.Type;
export type SavedRoutePayload = typeof SavedRouteSchema.Type;
export type RemoteSavedRoutePayloadInput =
	typeof RemoteSavedRoutePayloadSchema.Type;

export type DecodeRoutePayloadResult =
	| {
			readonly ok: true;
			readonly payload: RouteRequestPayloadInput;
	  }
	| {
			readonly ok: false;
			readonly error: "Invalid route request payload.";
	  };

type IsAssignable<To, From extends To> = From;
type SavedRouteShape = {
	id: string;
	createdAt: string;
	route: PlannedRoute;
};
type RemoteSavedRoutePayloadShape = {
	id: string;
	createdAt: string;
	routeJson: string;
};
type _RouteStopCompatibility = IsAssignable<
	typeof RouteStopInputSchema.Type,
	RouteStopInput | string
>;
type _RoundCourseTargetCompatibility = IsAssignable<
	typeof RoundCourseTargetSchema.Type,
	RoundCourseTarget
>;
type _RouteSpatialConstraintCompatibility = IsAssignable<
	typeof RouteSpatialConstraintInputSchema.Type,
	RouteSpatialConstraintInput
>;
type _RouteAvoidanceCompatibility = IsAssignable<
	typeof RouteAvoidanceInputSchema.Type,
	RouteAvoidanceInput
>;
type _RouteApiSuccessCompatibility = IsAssignable<
	typeof RouteApiSuccessSchema.Type,
	RouteApiSuccess
>;
type _RouteApiErrorCompatibility = IsAssignable<
	typeof RouteApiErrorSchema.Type,
	RouteApiError
>;
type _PlannedRouteCompatibility = IsAssignable<
	PlannedRoute,
	typeof PlannedRouteSchema.Type
>;
type _ResolvedSpatialConstraintCompatibility = IsAssignable<
	typeof ResolvedRouteSpatialConstraintSchema.Type,
	ResolvedRouteSpatialConstraint
>;
type _ResolvedRouteAvoidanceCompatibility = IsAssignable<
	typeof ResolvedRouteAvoidanceSchema.Type,
	ResolvedRouteAvoidance
>;
type _RouteCoordinateCompatibility = IsAssignable<
	typeof RouteCoordinateSchema.Type,
	RouteCoordinate
>;
type _RouteModeCompatibility = IsAssignable<
	typeof RouteModeSchema.Type,
	RouteMode
>;
type _SavedRouteCompatibility = IsAssignable<
	SavedRouteShape,
	typeof SavedRouteSchema.Type
>;
type _RemoteSavedRoutePayloadCompatibility = IsAssignable<
	RemoteSavedRoutePayloadShape,
	typeof RemoteSavedRoutePayloadSchema.Type
>;

void (null as unknown as _RouteStopCompatibility);
void (null as unknown as _RoundCourseTargetCompatibility);
void (null as unknown as _RouteSpatialConstraintCompatibility);
void (null as unknown as _RouteApiSuccessCompatibility);
void (null as unknown as _RouteApiErrorCompatibility);
void (null as unknown as _PlannedRouteCompatibility);
void (null as unknown as _ResolvedSpatialConstraintCompatibility);
void (null as unknown as _RouteCoordinateCompatibility);
void (null as unknown as _RouteModeCompatibility);
void (null as unknown as _SavedRouteCompatibility);
void (null as unknown as _RemoteSavedRoutePayloadCompatibility);

export function decodeRouteRequestPayload(
	value: unknown,
): DecodeRoutePayloadResult {
	try {
		return {
			ok: true,
			payload: Schema.decodeUnknownSync(RouteRequestPayloadInputSchema)(value),
		};
	} catch {
		return {
			ok: false,
			error: "Invalid route request payload.",
		};
	}
}

export function assertRouteApiSuccessPayload(value: unknown): void {
	Schema.decodeUnknownSync(RouteApiSuccessSchema)(value);
}

export function assertRouteApiErrorPayload(value: unknown): void {
	Schema.decodeUnknownSync(RouteApiErrorSchema)(value);
}
