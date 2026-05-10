import type {
	PlannedRoute,
	ResolvedRouteAvoidance,
	RouteApiError,
	RouteMode,
	RouteStopInput,
	RoundCourseTarget,
	SpatialConstraintEnforcement,
} from "$lib/route-planning";

export type StopSource = "typed" | "suggestion" | "map" | "currentLocation";

export type PlannerStop = RouteStopInput & {
	source: StopSource;
};

export type CurrentLocation = {
	point: [number, number];
	accuracyMeters?: number;
};

export type RouteField = "startQuery" | "destinationQuery";
export type PlannerMode = RouteMode;
export type RoundCourseTargetKind = RoundCourseTarget["kind"];

export type CompletionTarget =
	| { kind: "startQuery" }
	| { kind: "destinationQuery" }
	| { kind: "constraintCenter" }
	| { kind: "waypoint"; index: number };

export type SpatialConstraintKind = "none" | "area" | "corridor";

export type SelectedMapStop =
	| {
			kind: "start" | "destination";
			label?: string;
	  }
	| {
			kind: "waypoint";
			label?: string;
			index: number;
	  };

export type MapClickSelection = {
	point: [number, number];
	screenPoint: {
		x: number;
		y: number;
	};
	selectedStop?: SelectedMapStop;
	selectedSegment?: {
		coordinateSegmentIndex: number;
		segmentIndex: number;
	};
};

export type RouteStopDragEnd = {
	point: [number, number];
	screenPoint: {
		x: number;
		y: number;
	};
	selectedStop: SelectedMapStop;
	stopIndex: number;
};

export type RouteSegmentDragEnd = {
	point: [number, number];
	screenPoint: {
		x: number;
		y: number;
	};
	coordinateSegmentIndex: number;
	segmentIndex: number;
};

export type RouteEditSnapshot = {
	routeAlternatives: PlannedRoute[];
	selectedRouteIndex: number | null;
	lockedSegmentIndexes: number[];
	avoidedRoads: ResolvedRouteAvoidance[];
	plannerMode: PlannerMode;
	startStop: PlannerStop;
	waypointStops: PlannerStop[];
	destinationStop: PlannerStop;
	roundCourseTargetKind: RoundCourseTargetKind;
	roundCourseDistanceInput: string;
	roundCourseDistanceMetersInput: number | null;
	roundCourseDurationInput: string;
	roundCourseAscendMeters: string;
	spatialConstraintKind: SpatialConstraintKind;
	spatialConstraintEnforcement: SpatialConstraintEnforcement;
	constraintCenterStop: PlannerStop;
	areaRadiusInput: string;
	corridorWidthInput: string;
	areaRadiusMetersInput: number | null;
	corridorWidthMetersInput: number | null;
	lastGeneratedRouteCount: number | null;
	fieldErrors: NonNullable<RouteApiError["fieldErrors"]>;
};

export type RouteEditSnapshotOptions = {
	includeRoutesGeometry?: boolean;
};

export type ReverseGeocodeApiSuccess = {
	label: string;
	point: [number, number];
};
