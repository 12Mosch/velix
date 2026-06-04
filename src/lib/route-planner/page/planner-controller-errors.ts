import { Data } from "effect";

export class PlannerGeolocationError extends Data.TaggedError(
	"PlannerGeolocationError",
)<{
	readonly cause: unknown;
}> {}

export class PlannerReverseGeocodeError extends Data.TaggedError(
	"PlannerReverseGeocodeError",
)<{
	readonly point: [number, number];
	readonly cause: unknown;
}> {}

export class PlannerRouteRequestError extends Data.TaggedError(
	"PlannerRouteRequestError",
)<{
	readonly cause: unknown;
}> {}

export class PlannerRouteResponseError extends Data.TaggedError(
	"PlannerRouteResponseError",
)<{
	readonly message: string;
}> {}

export class PlannerSavedRouteError extends Data.TaggedError(
	"PlannerSavedRouteError",
)<{
	readonly operation: "upsert" | "delete" | "read";
	readonly cause: unknown;
}> {}

export class PlannerShareError extends Data.TaggedError("PlannerShareError")<{
	readonly cause: unknown;
}> {}

export class PlannerGpxFileReadError extends Data.TaggedError(
	"PlannerGpxFileReadError",
)<{
	readonly cause: unknown;
}> {}
