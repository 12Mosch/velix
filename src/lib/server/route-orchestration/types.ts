import type {
	ManualRouteEditingState,
	PlannedRoute,
	ResolvedRouteAvoidance,
	ResolvedRouteSpatialConstraint,
	RoundCourseCandidateError,
	RoundCourseTarget,
	RouteStopInput,
} from "$lib/route-planning";
import type { GraphHopperRouteBoundaryError } from "$lib/server/graphhopper-errors";

import type { RouteGenerationError } from "./errors";

export type StopField = "startQuery" | "destinationQuery" | "waypointQueries";

export type RouteStopResolutionInput = {
	kind: "start" | "waypoint" | "destination";
	input: RouteStopInput;
	field: StopField;
	index?: number;
	unresolvedMessage?: string;
};

export type ResolvedRouteStop = RouteStopResolutionInput & {
	label: string;
	point: [number, number];
};

export type PointToPointRouteSearchInput = {
	stops: ResolvedRouteStop[];
	spatialConstraint?: ResolvedRouteSpatialConstraint;
	avoidances?: ResolvedRouteAvoidance[];
	manualEditing?: ManualRouteEditingState;
};

export type OutAndBackRouteSearchInput = PointToPointRouteSearchInput;

export type RoundCourseRouteSearchInput = {
	start: ResolvedRouteStop;
	waypoints: ResolvedRouteStop[];
	target: RoundCourseTarget;
	spatialConstraint?: ResolvedRouteSpatialConstraint;
	avoidances?: ResolvedRouteAvoidance[];
	manualEditing?: ManualRouteEditingState;
};

export type CandidateRouteResult = {
	route: PlannedRoute;
	requestedDistanceMeters: number;
	sequence: number;
};

export type RoundCourseCandidateAttemptContext = {
	roundIndex: number;
	candidateIndex: number;
	sequence: number;
	requestedDistanceMeters: number;
	seed?: number;
};

export type RoundCourseCandidateSuccess = RoundCourseCandidateAttemptContext & {
	_tag: "RoundCourseCandidateSuccess";
	candidates: CandidateRouteResult[];
};

export type RoundCourseCandidateFailure = RoundCourseCandidateAttemptContext & {
	_tag: "RoundCourseCandidateFailure";
	error: RouteGenerationError | GraphHopperRouteBoundaryError;
};

export type RoundCourseCandidateAttempt =
	| RoundCourseCandidateSuccess
	| RoundCourseCandidateFailure;

export type RoundCourseCandidateSearchResult = {
	routes: PlannedRoute[];
	candidateErrors: RoundCourseCandidateError[];
};

export type RoundCourseRouteSearchResult = {
	routes: PlannedRoute[];
	candidateErrors?: RoundCourseCandidateError[];
};
