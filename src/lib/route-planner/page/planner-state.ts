import { cloneRoute } from "$lib/saved-routes-core";
import {
	formatDistance,
	formatDistanceInput,
} from "$lib/unit-settings.svelte";
import {
	getRouteSegmentCount,
	type ManualRouteEditingState,
	type PlannedRoute,
	type ResolvedRouteAvoidance,
	type RoundCourseTarget,
	type RouteApiError,
	type RouteAvoidanceInput,
	type RouteFieldErrors,
	type RouteRequestPayload,
	type RouteSpatialConstraintInput,
	type RouteStopInput,
	type SpatialConstraintEnforcement,
} from "$lib/route-planning";
import {
	defaultAreaRadiusMeters,
	defaultCorridorWidthMeters,
	defaultSpatialConstraintEnforcement,
	maxAreaRadiusMeters,
	maxCorridorWidthMeters,
	minAreaRadiusMeters,
	minCorridorWidthMeters,
} from "../constants";
import {
	formatRoundCourseDurationInput,
} from "../formatters";
import type {
	PlannerMode,
	PlannerStop,
	RoundCourseTargetKind,
	RouteEditSnapshot,
	RouteEditSnapshotOptions,
	SpatialConstraintKind,
	StopSource,
} from "../types";

export type PlannerFormState = {
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
	fieldErrors: NonNullable<RouteApiError["fieldErrors"]>;
};

export type PlannerRouteState = {
	routeAlternatives: PlannedRoute[];
	selectedRouteIndex: number | null;
	lockedSegmentIndexes: number[];
	avoidedRoads: ResolvedRouteAvoidance[];
	lastGeneratedRouteCount: number | null;
};

export type PlannerValidationResult = {
	valid: boolean;
	fieldErrors: NonNullable<RouteApiError["fieldErrors"]>;
};

export type HydratedPlannerStateFromRoute = {
	form: Omit<PlannerFormState, "fieldErrors">;
	avoidedRoads: ResolvedRouteAvoidance[];
};

export type SaveablePlannerRouteArgs = {
	activeRoute: PlannedRoute | null;
	lockedSegmentIndexes: number[];
	avoidedRoads: ResolvedRouteAvoidance[];
};

export function createPlannerStop(
	label = "",
	point?: [number, number],
	source: StopSource = "typed",
): PlannerStop {
	return {
		label,
		point,
		source,
	};
}

export function clonePlannerStop(stop: PlannerStop): PlannerStop {
	return createPlannerStop(
		stop.label,
		stop.point ? [stop.point[0], stop.point[1]] : undefined,
		stop.source,
	);
}

export function cloneFieldErrors(
	errors: NonNullable<RouteApiError["fieldErrors"]>,
): NonNullable<RouteApiError["fieldErrors"]> {
	return {
		...errors,
		waypointQueries: errors.waypointQueries
			? [...errors.waypointQueries]
			: undefined,
	};
}

export function cloneAvoidances(
	avoidances: ResolvedRouteAvoidance[],
): ResolvedRouteAvoidance[] {
	return avoidances.map((avoidance) => ({
		...avoidance,
		centerline: avoidance.centerline.map((point) => [point[0], point[1]]),
		polygon: avoidance.polygon.map((point) => [point[0], point[1]]),
	}));
}

export function getRouteStopInput(stop: PlannerStop): RouteStopInput {
	return {
		label: stop.label.trim(),
		point: stop.point,
	};
}

export function getRoundCourseTarget(
	route: PlannedRoute | null | undefined,
): RoundCourseTarget | null {
	if (!route || route.mode !== "round_course") {
		return null;
	}

	if (route.roundCourseTarget) {
		return route.roundCourseTarget;
	}

	if (
		typeof route.requestedDistanceMeters === "number" &&
		Number.isFinite(route.requestedDistanceMeters)
	) {
		return {
			kind: "distance",
			distanceMeters: route.requestedDistanceMeters,
		};
	}

	return null;
}

export function parseRoundCourseDurationInput(value: string): number | null {
	const trimmedValue = value.trim();

	if (!trimmedValue) {
		return null;
	}

	if (trimmedValue.includes(":")) {
		const [hoursPart, minutesPart, ...rest] = trimmedValue.split(":");
		const hours = Number(hoursPart);
		const minutes = Number(minutesPart);

		if (
			rest.length > 0 ||
			!Number.isInteger(hours) ||
			!Number.isInteger(minutes) ||
			minutes < 0 ||
			minutes >= 60
		) {
			return null;
		}

		return (hours * 60 + minutes) * 60 * 1000;
	}

	const decimalHours = Number(trimmedValue.replace(",", "."));

	if (!Number.isFinite(decimalHours) || decimalHours < 0) {
		return null;
	}

	return Math.round(decimalHours * 60 * 60 * 1000);
}

export function buildRoundCourseTargetRequest(
	form: Pick<
		PlannerFormState,
		| "roundCourseTargetKind"
		| "roundCourseDistanceMetersInput"
		| "roundCourseDurationInput"
		| "roundCourseAscendMeters"
	>,
): RoundCourseTarget {
	if (form.roundCourseTargetKind === "duration") {
		return {
			kind: "duration",
			durationMs:
				parseRoundCourseDurationInput(form.roundCourseDurationInput) ?? Number.NaN,
		};
	}

	if (form.roundCourseTargetKind === "ascend") {
		return {
			kind: "ascend",
			ascendMeters: Number(form.roundCourseAscendMeters.replace(",", ".")),
		};
	}

	return {
		kind: "distance",
		distanceMeters: form.roundCourseDistanceMetersInput ?? Number.NaN,
	};
}

export function buildSpatialConstraintRequest(
	form: Pick<
		PlannerFormState,
		| "plannerMode"
		| "spatialConstraintKind"
		| "spatialConstraintEnforcement"
		| "constraintCenterStop"
		| "areaRadiusMetersInput"
		| "corridorWidthMetersInput"
	>,
): RouteSpatialConstraintInput | undefined {
	if (form.spatialConstraintKind === "area") {
		return {
			kind: "area",
			center: getRouteStopInput(form.constraintCenterStop),
			radiusMeters: form.areaRadiusMetersInput ?? Number.NaN,
			enforcement: form.spatialConstraintEnforcement,
		};
	}

	if (
		form.spatialConstraintKind === "corridor" &&
		form.plannerMode !== "round_course"
	) {
		return {
			kind: "corridor",
			widthMeters: form.corridorWidthMetersInput ?? Number.NaN,
			enforcement: form.spatialConstraintEnforcement,
		};
	}

	return undefined;
}

export function getDefaultSpatialConstraintState(): Pick<
	PlannerFormState,
	| "spatialConstraintKind"
	| "spatialConstraintEnforcement"
	| "constraintCenterStop"
	| "areaRadiusInput"
	| "corridorWidthInput"
	| "areaRadiusMetersInput"
	| "corridorWidthMetersInput"
> {
	return {
		spatialConstraintKind: "none",
		spatialConstraintEnforcement: defaultSpatialConstraintEnforcement,
		constraintCenterStop: createPlannerStop(),
		areaRadiusInput: formatDistanceInput(defaultAreaRadiusMeters),
		corridorWidthInput: formatDistanceInput(defaultCorridorWidthMeters),
		areaRadiusMetersInput: defaultAreaRadiusMeters,
		corridorWidthMetersInput: defaultCorridorWidthMeters,
	};
}

export function hydratePlannerStateFromRoute(
	route: PlannedRoute,
): HydratedPlannerStateFromRoute {
	const roundCourseTarget = getRoundCourseTarget(route);
	const routeStops = getRouteStopInputs(route);
	const [start] = routeStops;
	const waypointStops =
		route.mode === "round_course" ? routeStops.slice(1) : routeStops.slice(1, -1);
	const destination =
		route.mode === "round_course"
			? null
			: (routeStops[routeStops.length - 1] ?? null);
	const spatialConstraintDefaults = getDefaultSpatialConstraintState();

	if (!route.spatialConstraint) {
		return {
			form: {
				plannerMode: route.mode,
				startStop: createPlannerStop(
					start?.label ?? "",
					start?.point,
					start?.point ? "suggestion" : "typed",
				),
				waypointStops: waypointStops.map((waypoint) =>
					createPlannerStop(
						waypoint.label,
						waypoint.point,
						waypoint.point ? "suggestion" : "typed",
					),
				),
				destinationStop: createPlannerStop(
					destination?.label ?? "",
					destination?.point,
					destination?.point ? "suggestion" : "typed",
				),
				roundCourseTargetKind: roundCourseTarget?.kind ?? "distance",
				roundCourseDistanceInput:
					roundCourseTarget?.kind === "distance"
						? formatDistanceInput(roundCourseTarget.distanceMeters)
						: "",
				roundCourseDistanceMetersInput:
					roundCourseTarget?.kind === "distance"
						? roundCourseTarget.distanceMeters
						: null,
				roundCourseDurationInput:
					roundCourseTarget?.kind === "duration"
						? formatRoundCourseDurationInput(roundCourseTarget.durationMs)
						: "",
				roundCourseAscendMeters:
					roundCourseTarget?.kind === "ascend"
						? Math.round(roundCourseTarget.ascendMeters).toString()
						: "",
				...spatialConstraintDefaults,
			},
			avoidedRoads: cloneAvoidances(route.avoidances ?? []),
		};
	}

	if (route.spatialConstraint.kind === "area") {
		return {
			form: {
				plannerMode: route.mode,
				startStop: createPlannerStop(
					start?.label ?? "",
					start?.point,
					start?.point ? "suggestion" : "typed",
				),
				waypointStops: waypointStops.map((waypoint) =>
					createPlannerStop(
						waypoint.label,
						waypoint.point,
						waypoint.point ? "suggestion" : "typed",
					),
				),
				destinationStop: createPlannerStop(
					destination?.label ?? "",
					destination?.point,
					destination?.point ? "suggestion" : "typed",
				),
				roundCourseTargetKind: roundCourseTarget?.kind ?? "distance",
				roundCourseDistanceInput:
					roundCourseTarget?.kind === "distance"
						? formatDistanceInput(roundCourseTarget.distanceMeters)
						: "",
				roundCourseDistanceMetersInput:
					roundCourseTarget?.kind === "distance"
						? roundCourseTarget.distanceMeters
						: null,
				roundCourseDurationInput:
					roundCourseTarget?.kind === "duration"
						? formatRoundCourseDurationInput(roundCourseTarget.durationMs)
						: "",
				roundCourseAscendMeters:
					roundCourseTarget?.kind === "ascend"
						? Math.round(roundCourseTarget.ascendMeters).toString()
						: "",
				spatialConstraintKind: "area",
				spatialConstraintEnforcement: route.spatialConstraint.enforcement,
				constraintCenterStop: createPlannerStop(
					route.spatialConstraint.label,
					route.spatialConstraint.center,
					"suggestion",
				),
				areaRadiusInput: formatDistanceInput(route.spatialConstraint.radiusMeters),
				corridorWidthInput: formatDistanceInput(defaultCorridorWidthMeters),
				areaRadiusMetersInput: route.spatialConstraint.radiusMeters,
				corridorWidthMetersInput: defaultCorridorWidthMeters,
			},
			avoidedRoads: cloneAvoidances(route.avoidances ?? []),
		};
	}

	return {
		form: {
			plannerMode: route.mode,
			startStop: createPlannerStop(
				start?.label ?? "",
				start?.point,
				start?.point ? "suggestion" : "typed",
			),
			waypointStops: waypointStops.map((waypoint) =>
				createPlannerStop(
					waypoint.label,
					waypoint.point,
					waypoint.point ? "suggestion" : "typed",
				),
			),
			destinationStop: createPlannerStop(
				destination?.label ?? "",
				destination?.point,
				destination?.point ? "suggestion" : "typed",
			),
			roundCourseTargetKind: roundCourseTarget?.kind ?? "distance",
			roundCourseDistanceInput:
				roundCourseTarget?.kind === "distance"
					? formatDistanceInput(roundCourseTarget.distanceMeters)
					: "",
			roundCourseDistanceMetersInput:
				roundCourseTarget?.kind === "distance"
					? roundCourseTarget.distanceMeters
					: null,
			roundCourseDurationInput:
				roundCourseTarget?.kind === "duration"
					? formatRoundCourseDurationInput(roundCourseTarget.durationMs)
					: "",
			roundCourseAscendMeters:
				roundCourseTarget?.kind === "ascend"
					? Math.round(roundCourseTarget.ascendMeters).toString()
					: "",
			spatialConstraintKind: "corridor",
			spatialConstraintEnforcement: route.spatialConstraint.enforcement,
			constraintCenterStop: createPlannerStop(),
			areaRadiusInput: formatDistanceInput(defaultAreaRadiusMeters),
			corridorWidthInput: formatDistanceInput(route.spatialConstraint.widthMeters),
			areaRadiusMetersInput: defaultAreaRadiusMeters,
			corridorWidthMetersInput: route.spatialConstraint.widthMeters,
		},
		avoidedRoads: cloneAvoidances(route.avoidances ?? []),
	};
}

export function withManualEditingState(
	route: PlannedRoute,
	indexes: number[],
): PlannedRoute {
	const lockedSegmentIndexes = sanitizeLockedSegmentIndexes(
		indexes,
		getRouteSegmentCount(route),
	);
	const { manualEditing: _manualEditing, ...routeWithoutManualEditing } = route;

	return lockedSegmentIndexes.length > 0
		? {
				...routeWithoutManualEditing,
				manualEditing: {
					lockedSegmentIndexes,
				},
			}
		: routeWithoutManualEditing;
}

export function withAvoidancesState(
	route: PlannedRoute,
	avoidances: ResolvedRouteAvoidance[],
): PlannedRoute {
	const { avoidances: _avoidances, ...routeWithoutAvoidances } = route;

	return avoidances.length > 0
		? {
				...routeWithoutAvoidances,
				avoidances: cloneAvoidances(avoidances),
			}
		: routeWithoutAvoidances;
}

export function withPlannerRouteState(
	route: PlannedRoute,
	indexes: number[],
	avoidances: ResolvedRouteAvoidance[],
): PlannedRoute {
	return withAvoidancesState(withManualEditingState(route, indexes), avoidances);
}

export function getManualEditingRequest(
	activeRoute: PlannedRoute | null,
	lockedSegmentIndexes: number[],
): ManualRouteEditingState | undefined {
	if (!activeRoute) {
		return undefined;
	}

	const sanitizedLockedSegmentIndexes = sanitizeLockedSegmentIndexes(
		lockedSegmentIndexes,
		getRouteSegmentCount(activeRoute),
	);

	return sanitizedLockedSegmentIndexes.length > 0
		? {
				lockedSegmentIndexes: sanitizedLockedSegmentIndexes,
			}
		: undefined;
}

export function getAvoidanceRequest(
	avoidedRoads: ResolvedRouteAvoidance[],
): RouteAvoidanceInput[] | undefined {
	return avoidedRoads.length > 0
		? avoidedRoads.map((avoidance) => ({
				kind: "road_segment",
				centerline: avoidance.centerline,
				bufferMeters: avoidance.bufferMeters,
				label: avoidance.label,
			}))
		: undefined;
}

export function buildCurrentRouteRequest(
	form: PlannerFormState,
	manualEditing?: ManualRouteEditingState,
	avoidances?: RouteAvoidanceInput[],
): RouteRequestPayload & { manualEditing?: ManualRouteEditingState } {
	const spatialConstraint = buildSpatialConstraintRequest(form);
	const baseRequest: RouteRequestPayload =
		form.plannerMode === "round_course"
			? {
					mode: "round_course",
					start: getRouteStopInput(form.startStop),
					waypoints: form.waypointStops.map((waypoint) =>
						getRouteStopInput(waypoint),
					),
					target: buildRoundCourseTargetRequest(form),
					...(spatialConstraint ? { spatialConstraint } : {}),
				}
			: form.plannerMode === "out_and_back"
				? {
						mode: "out_and_back",
						start: getRouteStopInput(form.startStop),
						waypoints: form.waypointStops.map((waypoint) =>
							getRouteStopInput(waypoint),
						),
						turnaround: getRouteStopInput(form.destinationStop),
						...(spatialConstraint ? { spatialConstraint } : {}),
					}
				: {
						mode: "point_to_point",
						start: getRouteStopInput(form.startStop),
						waypoints: form.waypointStops.map((waypoint) =>
							getRouteStopInput(waypoint),
						),
						destination: getRouteStopInput(form.destinationStop),
						...(spatialConstraint ? { spatialConstraint } : {}),
					};

	return {
		...baseRequest,
		...(manualEditing ? { manualEditing } : {}),
		...(avoidances ? { avoidances } : {}),
	};
}

export function validatePlannerForm(
	form: Pick<
		PlannerFormState,
		| "plannerMode"
		| "roundCourseTargetKind"
		| "roundCourseDistanceMetersInput"
		| "roundCourseDurationInput"
		| "roundCourseAscendMeters"
		| "spatialConstraintKind"
		| "areaRadiusMetersInput"
		| "corridorWidthMetersInput"
	>,
	options: {
		minRoundCourseDurationMs: number;
		minRoundCourseAscendMeters: number;
	},
): PlannerValidationResult {
	const fieldErrors: NonNullable<RouteFieldErrors> = {};

	if (form.plannerMode === "round_course") {
		if (form.roundCourseTargetKind === "distance") {
			if (
				form.roundCourseDistanceMetersInput === null ||
				form.roundCourseDistanceMetersInput <= 0
			) {
				fieldErrors.roundCourseTarget = "Enter a target distance.";
			}
		} else if (form.roundCourseTargetKind === "duration") {
			const durationMs = parseRoundCourseDurationInput(form.roundCourseDurationInput);

			if (
				durationMs === null ||
				Number.isNaN(durationMs) ||
				!Number.isFinite(durationMs) ||
				durationMs < options.minRoundCourseDurationMs
			) {
				fieldErrors.roundCourseTarget = "Enter a target time.";
			}
		} else if (form.roundCourseTargetKind === "ascend") {
			const ascendMeters = Number(form.roundCourseAscendMeters.replace(",", "."));

			if (
				Number.isNaN(ascendMeters) ||
				!Number.isFinite(ascendMeters) ||
				ascendMeters < options.minRoundCourseAscendMeters
			) {
				fieldErrors.roundCourseTarget = "Enter a target climb.";
			}
		}
	}

	if (form.spatialConstraintKind === "area") {
		if (
			form.areaRadiusMetersInput === null ||
			form.areaRadiusMetersInput < minAreaRadiusMeters ||
			form.areaRadiusMetersInput > maxAreaRadiusMeters
		) {
			fieldErrors.spatialConstraint = `Enter an area radius from ${formatDistance(minAreaRadiusMeters)} to ${formatDistance(maxAreaRadiusMeters)}.`;
		}
	} else if (
		form.spatialConstraintKind === "corridor" &&
		form.plannerMode !== "round_course"
	) {
		if (
			form.corridorWidthMetersInput === null ||
			form.corridorWidthMetersInput < minCorridorWidthMeters ||
			form.corridorWidthMetersInput > maxCorridorWidthMeters
		) {
			fieldErrors.spatialConstraint = `Enter a corridor width from ${formatDistance(minCorridorWidthMeters)} to ${formatDistance(maxCorridorWidthMeters)}.`;
		}
	}

	return {
		valid: Object.keys(fieldErrors).length === 0,
		fieldErrors,
	};
}

export function getActiveRouteForSaving(
	args: SaveablePlannerRouteArgs,
): PlannedRoute | null {
	if (!args.activeRoute) {
		return null;
	}

	const manualEditing = getManualEditingRequest(
		args.activeRoute,
		args.lockedSegmentIndexes,
	);
	return {
		...withAvoidancesState(args.activeRoute, args.avoidedRoads),
		...(manualEditing ? { manualEditing } : {}),
	};
}

export function getRouteShareSignature(route: PlannedRoute): string {
	return [
		"unsaved",
		route.mode,
		route.startLabel,
		route.destinationLabel,
		route.distanceMeters,
		route.durationMs,
		route.coordinates.length,
	].join(":");
}

export function pruneRouteShareState<T>(
	state: Record<string, T>,
	keepKeys: Set<string>,
): Record<string, T> {
	const entries = Object.entries(state).filter(([key]) => keepKeys.has(key));

	return entries.length === Object.keys(state).length
		? state
		: Object.fromEntries(entries);
}

export function captureRouteEditSnapshot(
	form: PlannerFormState,
	routeState: PlannerRouteState,
	options: RouteEditSnapshotOptions = {},
): RouteEditSnapshot {
	return {
		routeAlternatives: options.includeRoutesGeometry
			? routeState.routeAlternatives.map((route) => cloneRoute(route))
			: [...routeState.routeAlternatives],
		selectedRouteIndex: routeState.selectedRouteIndex,
		lockedSegmentIndexes: [...routeState.lockedSegmentIndexes],
		avoidedRoads: cloneAvoidances(routeState.avoidedRoads),
		plannerMode: form.plannerMode,
		startStop: clonePlannerStop(form.startStop),
		waypointStops: form.waypointStops.map((waypoint) => clonePlannerStop(waypoint)),
		destinationStop: clonePlannerStop(form.destinationStop),
		roundCourseTargetKind: form.roundCourseTargetKind,
		roundCourseDistanceInput: form.roundCourseDistanceInput,
		roundCourseDistanceMetersInput: form.roundCourseDistanceMetersInput,
		roundCourseDurationInput: form.roundCourseDurationInput,
		roundCourseAscendMeters: form.roundCourseAscendMeters,
		spatialConstraintKind: form.spatialConstraintKind,
		spatialConstraintEnforcement: form.spatialConstraintEnforcement,
		constraintCenterStop: clonePlannerStop(form.constraintCenterStop),
		areaRadiusInput: form.areaRadiusInput,
		corridorWidthInput: form.corridorWidthInput,
		areaRadiusMetersInput: form.areaRadiusMetersInput,
		corridorWidthMetersInput: form.corridorWidthMetersInput,
		lastGeneratedRouteCount: routeState.lastGeneratedRouteCount,
		fieldErrors: cloneFieldErrors(form.fieldErrors),
	};
}

export function restoreRouteEditSnapshot(snapshot: RouteEditSnapshot): {
	form: PlannerFormState;
	routeState: PlannerRouteState;
} {
	return {
		form: {
			plannerMode: snapshot.plannerMode,
			startStop: clonePlannerStop(snapshot.startStop),
			waypointStops: snapshot.waypointStops.map((waypoint) =>
				clonePlannerStop(waypoint),
			),
			destinationStop: clonePlannerStop(snapshot.destinationStop),
			roundCourseTargetKind: snapshot.roundCourseTargetKind,
			roundCourseDistanceInput: snapshot.roundCourseDistanceInput,
			roundCourseDistanceMetersInput: snapshot.roundCourseDistanceMetersInput,
			roundCourseDurationInput: snapshot.roundCourseDurationInput,
			roundCourseAscendMeters: snapshot.roundCourseAscendMeters,
			spatialConstraintKind: snapshot.spatialConstraintKind,
			spatialConstraintEnforcement: snapshot.spatialConstraintEnforcement,
			constraintCenterStop: clonePlannerStop(snapshot.constraintCenterStop),
			areaRadiusInput: snapshot.areaRadiusInput,
			corridorWidthInput: snapshot.corridorWidthInput,
			areaRadiusMetersInput: snapshot.areaRadiusMetersInput,
			corridorWidthMetersInput: snapshot.corridorWidthMetersInput,
			fieldErrors: cloneFieldErrors(snapshot.fieldErrors),
		},
		routeState: {
			routeAlternatives: snapshot.routeAlternatives.map((route) => cloneRoute(route)),
			selectedRouteIndex: snapshot.selectedRouteIndex,
			lockedSegmentIndexes: [...snapshot.lockedSegmentIndexes],
			avoidedRoads: cloneAvoidances(snapshot.avoidedRoads),
			lastGeneratedRouteCount: snapshot.lastGeneratedRouteCount,
		},
	};
}

function getRouteStopInputs(route: PlannedRoute): RouteStopInput[] {
	const stops: RouteStopInput[] = [
		{
			label: route.startLabel,
			point: [route.coordinates[0][0], route.coordinates[0][1]],
		},
		...route.waypoints.map((waypoint) => ({
			label: waypoint.label,
			point: [waypoint.coordinate[0], waypoint.coordinate[1]] as [number, number],
		})),
	];

	if (route.mode !== "round_course") {
		const destinationCoordinate = route.coordinates[route.coordinates.length - 1];
		stops.push({
			label: route.destinationLabel,
			point: destinationCoordinate
				? [destinationCoordinate[0], destinationCoordinate[1]]
				: undefined,
		});
	}

	return stops;
}

function sanitizeLockedSegmentIndexes(
	indexes: number[],
	segmentCount: number,
): number[] {
	return [...new Set(indexes)]
		.filter(
			(index) =>
				Number.isInteger(index) && index >= 0 && index < Math.max(segmentCount, 0),
		)
		.sort((left, right) => left - right);
}
