import { Schema, SchemaGetter } from "effect";

import type {
	PlannedRoute,
	ResolvedRouteSpatialConstraint,
	RoundCourseTarget,
	RouteApiError,
	RouteApiSuccess,
	RouteCoordinate,
	RouteMode,
	RouteSpatialConstraintInput,
	RouteStopInput,
} from "$lib/route-planning";

const finiteCoordinateInput = Schema.TupleWithRest(
	Schema.Tuple([Schema.Finite, Schema.Finite]),
	[Schema.Finite],
);

const coordinate2Schema = Schema.declare<[number, number]>(
	(value): value is [number, number] =>
		Array.isArray(value) &&
		value.length === 2 &&
		value.every((item) => typeof item === "number" && Number.isFinite(item)),
);

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
export const RouteDetailIntervalSchema = Schema.Struct({
	from: Schema.Finite,
	to: Schema.Finite,
	value: Schema.String,
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
	routingProfile: Schema.optionalKey(Schema.UndefinedOr(Schema.String)),
	routingStrategy: Schema.optionalKey(Schema.UndefinedOr(Schema.String)),
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
	surfaceDetails: Schema.mutable(Schema.Array(RouteDetailIntervalSchema)),
	smoothnessDetails: Schema.mutable(Schema.Array(RouteDetailIntervalSchema)),
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
