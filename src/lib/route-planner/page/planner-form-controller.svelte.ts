import { Effect, Exit, Cause } from "effect";
import {
	completionDebounceMs,
	constraintCenterCompletionTarget,
	destinationCompletionTarget,
	maxWaypoints,
	minCompletionQueryLength,
	minRoundCourseDistanceMeters,
	startCompletionTarget,
} from "$lib/route-planner/constants";
import {
	formatDistanceInput,
	parseDistanceInputToMeters,
	unitPreference,
} from "$lib/unit-settings.svelte";
import {
	estimateWorkoutTargetEffect,
	parseWorkoutPlanEffect,
} from "$lib/workout-plan";
import { formatRoundCourseDurationInput } from "$lib/route-planner/formatters";
import type { RouteApiError } from "$lib/route-planning";
import type {
	PlannerMode,
	PlannerStop,
	RouteField,
	RoundCourseTargetKind,
	SpatialConstraintKind,
} from "$lib/route-planner/types";
import type {
	RoundCourseTarget,
	SpatialConstraintEnforcement,
} from "$lib/route-planning";
import {
	createPlannerStop,
	getDefaultSpatialConstraintState,
	type PlannerFormState,
	validatePlannerForm as runPlannerValidation,
} from "$lib/route-planner/page/planner-state";
import {
	createPlannerCompletionController,
	getWaypointCompletionTarget,
} from "$lib/route-planner/page/planner-completion.svelte";

type PlannerFormControllerDependencies = {
	getFetch: () => typeof window.fetch | null;
	isRouting: () => boolean;
	hasActiveRoute: () => boolean;
	isLockedStopIndex: (index: number) => boolean;
	markPlannerEdited: (options?: { requiresRecalculation?: boolean }) => void;
	performRouteEdit: (editFn: () => boolean | undefined) => void;
	clearManualRouteState: () => void;
	closeMapClickMenu: () => void;
	useCurrentLocationAsStop: (field: RouteField) => Effect.Effect<void>;
};

const minRoundCourseDurationMs = 15 * 60 * 1000;
const minRoundCourseAscendMeters = 50;

export function createPlannerFormController(
	dependencies: PlannerFormControllerDependencies,
) {
	let plannerMode = $state<PlannerMode>("point_to_point");
	let startStop = $state<PlannerStop>(createPlannerStop());
	let waypointStops = $state<PlannerStop[]>([]);
	let destinationStop = $state<PlannerStop>(createPlannerStop());
	let roundCourseTargetKind = $state<RoundCourseTargetKind>("distance");
	let roundCourseDistanceInput = $state("");
	let roundCourseDistanceMetersInput = $state<number | null>(null);
	let roundCourseDurationInput = $state("");
	let roundCourseAscendMeters = $state("");
	let roundCourseWorkoutTarget = $state<Extract<
		RoundCourseTarget,
		{ kind: "workout" }
	> | null>(null);
	let workoutPlanInput = $state("");
	let workoutPlanError = $state<string | null>(null);
	let spatialConstraintKind = $state<SpatialConstraintKind>("none");
	let spatialConstraintEnforcement =
		$state<SpatialConstraintEnforcement>("preferred");
	let constraintCenterStop = $state<PlannerStop>(createPlannerStop());
	let areaRadiusInput = $state("");
	let corridorWidthInput = $state("");
	let areaRadiusMetersInput = $state<number | null>(null);
	let corridorWidthMetersInput = $state<number | null>(null);
	let formattedInputDistanceUnit = $state<string | null>(null);
	let fieldErrors = $state<NonNullable<RouteApiError["fieldErrors"]>>({});
	let advancedOpen = $state(false);

	const isRoundCourseMode = $derived(plannerMode === "round_course");
	const isOutAndBackMode = $derived(plannerMode === "out_and_back");
	const hasAdvancedErrors = $derived(
		Boolean(
			fieldErrors.spatialConstraint ||
				fieldErrors.waypointQueries?.some(Boolean) ||
				(isRoundCourseMode &&
					roundCourseTargetKind !== "distance" &&
					fieldErrors.roundCourseTarget),
		),
	);

	const completionController = createPlannerCompletionController(
		dependencies.getFetch,
		{
			debounceMs: completionDebounceMs,
			minQueryLength: minCompletionQueryLength,
			getValue: (target) => {
				if (target.kind === "startQuery") {
					return startStop.label;
				}

				if (target.kind === "destinationQuery") {
					return destinationStop.label;
				}

				if (target.kind === "constraintCenter") {
					return constraintCenterStop.label;
				}

				return waypointStops[target.index]?.label ?? "";
			},
			onSelect: (target, suggestion) => {
				const selectedStop = createPlannerStop(
					suggestion.label,
					suggestion.point,
					"suggestion",
				);

				if (target.kind === "waypoint") {
					setWaypointStop(target.index, selectedStop);
				} else if (target.kind === "constraintCenter") {
					setConstraintCenterStop(selectedStop);
				} else {
					setFieldStop(target.kind, selectedStop);
				}
			},
			onError: (error) => {
				console.error("Failed to load route suggestions", error);
			},
		},
	);

	$effect(() => {
		if (hasAdvancedErrors) {
			advancedOpen = true;
		}
	});

	$effect(() => {
		const nextDistanceUnit = unitPreference.selectedDistanceUnit;

		if (
			!unitPreference.initialized ||
			formattedInputDistanceUnit === nextDistanceUnit
		) {
			return;
		}

		formattedInputDistanceUnit = nextDistanceUnit;

		if (roundCourseDistanceMetersInput !== null) {
			roundCourseDistanceInput = formatDistanceInput(
				roundCourseDistanceMetersInput,
			);
		}

		if (areaRadiusMetersInput !== null) {
			areaRadiusInput = formatDistanceInput(areaRadiusMetersInput);
		}

		if (corridorWidthMetersInput !== null) {
			corridorWidthInput = formatDistanceInput(corridorWidthMetersInput);
		}
	});

	function getPlannerFormState(): PlannerFormState {
		return {
			plannerMode,
			startStop,
			waypointStops,
			destinationStop,
			roundCourseTargetKind,
			roundCourseDistanceInput,
			roundCourseDistanceMetersInput,
			roundCourseDurationInput,
			roundCourseAscendMeters,
			roundCourseWorkoutTarget,
			spatialConstraintKind,
			spatialConstraintEnforcement,
			constraintCenterStop,
			areaRadiusInput,
			corridorWidthInput,
			areaRadiusMetersInput,
			corridorWidthMetersInput,
			fieldErrors,
		};
	}

	function applyPlannerFormState(form: PlannerFormState) {
		plannerMode = form.plannerMode;
		startStop = form.startStop;
		waypointStops = form.waypointStops;
		destinationStop = form.destinationStop;
		roundCourseTargetKind = form.roundCourseTargetKind;
		roundCourseDistanceInput = form.roundCourseDistanceInput;
		roundCourseDistanceMetersInput = form.roundCourseDistanceMetersInput;
		roundCourseDurationInput = form.roundCourseDurationInput;
		roundCourseAscendMeters = form.roundCourseAscendMeters;
		roundCourseWorkoutTarget = form.roundCourseWorkoutTarget;
		spatialConstraintKind = form.spatialConstraintKind;
		spatialConstraintEnforcement = form.spatialConstraintEnforcement;
		constraintCenterStop = form.constraintCenterStop;
		areaRadiusInput = form.areaRadiusInput;
		corridorWidthInput = form.corridorWidthInput;
		areaRadiusMetersInput = form.areaRadiusMetersInput;
		corridorWidthMetersInput = form.corridorWidthMetersInput;
		fieldErrors = form.fieldErrors;
	}

	function setFieldErrors(
		nextFieldErrors: NonNullable<RouteApiError["fieldErrors"]>,
	) {
		fieldErrors = nextFieldErrors;
	}

	function resetSpatialConstraintDefaults() {
		const defaults = getDefaultSpatialConstraintState();
		spatialConstraintKind = defaults.spatialConstraintKind;
		spatialConstraintEnforcement = defaults.spatialConstraintEnforcement;
		constraintCenterStop = defaults.constraintCenterStop;
		areaRadiusMetersInput = defaults.areaRadiusMetersInput;
		corridorWidthMetersInput = defaults.corridorWidthMetersInput;
		areaRadiusInput = defaults.areaRadiusInput;
		corridorWidthInput = defaults.corridorWidthInput;
	}

	function getDestinationFieldLabel() {
		return isOutAndBackMode ? "Turnaround" : "Destination";
	}

	function getDestinationSuggestionsLabel() {
		return `${getDestinationFieldLabel()} suggestions`;
	}

	function getDestinationPlaceholder() {
		return isOutAndBackMode ? "Turnaround point..." : "Destination...";
	}

	function getCurrentLocationDestinationLabel() {
		return isOutAndBackMode
			? "Use current location as turnaround"
			: "Use current location as destination";
	}

	function getSubmitButtonText() {
		if (dependencies.isRouting()) {
			if (isRoundCourseMode) {
				return "Calculating round course...";
			}

			if (isOutAndBackMode) {
				return "Calculating out and back...";
			}

			return "Calculating route...";
		}

		if (isRoundCourseMode) {
			return "Generate Round Course";
		}

		if (isOutAndBackMode) {
			return "Generate Out and Back";
		}

		return "Generate Route";
	}

	function closeCompletionMenu() {
		Effect.runSync(completionController.close());
	}

	function clearModeSpecificFieldErrors(nextMode: PlannerMode) {
		fieldErrors = {
			...fieldErrors,
			destinationQuery:
				nextMode === "round_course" ? undefined : fieldErrors.destinationQuery,
			waypointQueries:
				nextMode === "point_to_point" ? fieldErrors.waypointQueries : [],
			roundCourseTarget:
				nextMode === "round_course" ? fieldErrors.roundCourseTarget : undefined,
		};
	}

	function setPlannerMode(nextMode: PlannerMode) {
		if (plannerMode === nextMode) {
			return;
		}

		plannerMode = nextMode;
		dependencies.clearManualRouteState();
		if (nextMode === "round_course") {
			roundCourseTargetKind = "distance";
			roundCourseWorkoutTarget = null;
			workoutPlanInput = "";
			workoutPlanError = null;
			if (spatialConstraintKind === "corridor") {
				resetSpatialConstraintDefaults();
				clearSpatialConstraintError();
			}
		}
		dependencies.closeMapClickMenu();
		clearModeSpecificFieldErrors(nextMode);

		if (
			nextMode !== "point_to_point" &&
			completionController.viewState.activeTarget &&
			completionController.viewState.activeTarget.kind !== "startQuery"
		) {
			closeCompletionMenu();
		}

		dependencies.markPlannerEdited();
	}

	function clearRoundCourseTargetError() {
		if (!fieldErrors.roundCourseTarget && !workoutPlanError) {
			return;
		}

		fieldErrors = {
			...fieldErrors,
			roundCourseTarget: undefined,
		};
		workoutPlanError = null;
	}

	function updateRoundCourseTargetKind(value: RoundCourseTargetKind) {
		roundCourseTargetKind = value;
		roundCourseWorkoutTarget = null;
		clearRoundCourseTargetError();
		dependencies.markPlannerEdited();
	}

	function updateRoundCourseDistanceInput(value: string) {
		roundCourseDistanceInput = value;
		roundCourseDistanceMetersInput = parseDistanceInputToMeters(value);
		roundCourseWorkoutTarget = null;
		clearRoundCourseTargetError();
		dependencies.markPlannerEdited();
	}

	function updateRoundCourseDuration(value: string) {
		roundCourseDurationInput = value;
		roundCourseWorkoutTarget = null;
		clearRoundCourseTargetError();
		dependencies.markPlannerEdited();
	}

	function updateRoundCourseAscend(value: string) {
		roundCourseAscendMeters = value;
		roundCourseWorkoutTarget = null;
		clearRoundCourseTargetError();
		dependencies.markPlannerEdited();
	}

	function updateWorkoutPlanInput(value: string) {
		workoutPlanInput = value;
		roundCourseWorkoutTarget = null;
		workoutPlanError = null;
		dependencies.markPlannerEdited();
	}

	function clearSpatialConstraintError() {
		if (!fieldErrors.spatialConstraint) {
			return;
		}

		fieldErrors = {
			...fieldErrors,
			spatialConstraint: undefined,
		};
	}

	function updateSpatialConstraintKind(value: SpatialConstraintKind) {
		spatialConstraintKind = value;
		clearSpatialConstraintError();
		closeCompletionMenu();
		dependencies.markPlannerEdited();
	}

	function updateSpatialConstraintEnforcement(
		value: SpatialConstraintEnforcement,
	) {
		spatialConstraintEnforcement = value;
		clearSpatialConstraintError();
		dependencies.markPlannerEdited();
	}

	function setConstraintCenterStop(stop: PlannerStop) {
		constraintCenterStop = stop;
		clearSpatialConstraintError();
		dependencies.markPlannerEdited();
	}

	function updateConstraintCenterInput(value: string) {
		setConstraintCenterStop(createPlannerStop(value));
		Effect.runSync(
			completionController.scheduleLookup(
				constraintCenterCompletionTarget,
				value,
			),
		);
	}

	function updateAreaRadiusInput(value: string) {
		areaRadiusInput = value;
		areaRadiusMetersInput = parseDistanceInputToMeters(value);
		clearSpatialConstraintError();
		dependencies.markPlannerEdited();
	}

	function updateCorridorWidthInput(value: string) {
		corridorWidthInput = value;
		corridorWidthMetersInput = parseDistanceInputToMeters(value);
		clearSpatialConstraintError();
		dependencies.markPlannerEdited();
	}

	function setFieldStop(
		field: RouteField,
		stop: PlannerStop,
		options: {
			clearFieldError?: boolean;
		} = {},
	) {
		if (field === "startQuery") {
			startStop = stop;
		} else {
			destinationStop = stop;
		}

		if (options.clearFieldError !== false && fieldErrors[field]) {
			fieldErrors = {
				...fieldErrors,
				[field]: undefined,
			};
		}

		dependencies.markPlannerEdited();
	}

	function setWaypointStop(index: number, stop: PlannerStop) {
		waypointStops = waypointStops.map((waypoint, waypointIndex) =>
			waypointIndex === index ? stop : waypoint,
		);
		clearWaypointError(index);
		dependencies.markPlannerEdited();
	}

	function handleFieldInput(field: RouteField, value: string) {
		updateField(field, value);
		Effect.runSync(
			completionController.scheduleLookup(
				field === "startQuery"
					? startCompletionTarget
					: destinationCompletionTarget,
				value,
			),
		);
	}

	function updateField(field: RouteField, value: string) {
		setFieldStop(field, createPlannerStop(value));
	}

	function getWaypointError(index: number) {
		return fieldErrors.waypointQueries?.[index] || "";
	}

	function clearWaypointError(index: number) {
		if (!fieldErrors.waypointQueries?.[index]) {
			return;
		}

		fieldErrors = {
			...fieldErrors,
			waypointQueries: waypointStops.map((_, waypointIndex) =>
				waypointIndex === index
					? ""
					: fieldErrors.waypointQueries?.[waypointIndex] || "",
			),
		};
	}

	function updateWaypoint(index: number, value: string) {
		setWaypointStop(index, createPlannerStop(value));
	}

	function handleWaypointInput(index: number, value: string) {
		updateWaypoint(index, value);
		Effect.runSync(
			completionController.scheduleLookup(
				getWaypointCompletionTarget(index),
				value,
			),
		);
	}

	function addWaypoint(
		stop = createPlannerStop(),
		index = waypointStops.length,
		recordHistory = true,
	): boolean {
		if (recordHistory && dependencies.hasActiveRoute()) {
			let changed = false;
			dependencies.performRouteEdit(() => {
				changed = addWaypoint(stop, index, false);
				return changed;
			});
			return changed;
		}

		if (waypointStops.length >= maxWaypoints) {
			return false;
		}

		const nextIndex = Math.max(0, Math.min(index, waypointStops.length));
		if (dependencies.hasActiveRoute()) {
			for (
				let waypointIndex = nextIndex;
				waypointIndex < waypointStops.length;
				waypointIndex += 1
			) {
				if (dependencies.isLockedStopIndex(waypointIndex + 1)) {
					return false;
				}
			}
		}

		waypointStops = [
			...waypointStops.slice(0, nextIndex),
			stop,
			...waypointStops.slice(nextIndex),
		];
		const nextWaypointErrors = [...(fieldErrors.waypointQueries ?? [])];
		nextWaypointErrors.splice(nextIndex, 0, "");
		fieldErrors = {
			...fieldErrors,
			waypointQueries: nextWaypointErrors,
		};

		Effect.runSync(completionController.handleWaypointInserted(nextIndex));

		dependencies.markPlannerEdited();
		return true;
	}

	function removeWaypoint(index: number, recordHistory = true): boolean {
		if (recordHistory && dependencies.hasActiveRoute()) {
			let changed = false;
			dependencies.performRouteEdit(() => {
				changed = removeWaypoint(index, false);
				return changed;
			});
			return changed;
		}

		if (dependencies.isLockedStopIndex(index + 1)) {
			return false;
		}

		Effect.runSync(completionController.handleWaypointRemoved(index));

		waypointStops = waypointStops.filter(
			(_, waypointIndex) => waypointIndex !== index,
		);
		fieldErrors = {
			...fieldErrors,
			waypointQueries: (fieldErrors.waypointQueries ?? []).filter(
				(_, waypointIndex) => waypointIndex !== index,
			),
		};

		dependencies.markPlannerEdited();
		return true;
	}

	function canMoveWaypoint(index: number, direction: -1 | 1) {
		const nextIndex = index + direction;

		return (
			nextIndex >= 0 &&
			nextIndex < waypointStops.length &&
			!dependencies.isLockedStopIndex(index + 1) &&
			!dependencies.isLockedStopIndex(nextIndex + 1)
		);
	}

	function moveWaypoint(
		index: number,
		direction: -1 | 1,
		recordHistory = true,
	): boolean {
		if (recordHistory && dependencies.hasActiveRoute()) {
			let changed = false;
			dependencies.performRouteEdit(() => {
				changed = moveWaypoint(index, direction, false);
				return changed;
			});
			return changed;
		}

		const nextIndex = index + direction;

		if (!canMoveWaypoint(index, direction)) {
			return false;
		}

		const nextWaypointStops = [...waypointStops];
		[nextWaypointStops[index], nextWaypointStops[nextIndex]] = [
			nextWaypointStops[nextIndex] ?? createPlannerStop(),
			nextWaypointStops[index] ?? createPlannerStop(),
		];
		waypointStops = nextWaypointStops;

		const nextWaypointErrors = [...(fieldErrors.waypointQueries ?? [])];
		[nextWaypointErrors[index], nextWaypointErrors[nextIndex]] = [
			nextWaypointErrors[nextIndex] ?? "",
			nextWaypointErrors[index] ?? "",
		];
		fieldErrors = {
			...fieldErrors,
			waypointQueries: nextWaypointErrors,
		};

		Effect.runSync(completionController.handleWaypointSwap(index, nextIndex));

		dependencies.markPlannerEdited();
		return true;
	}

	function validateDistanceInputs(): boolean {
		const validation = Effect.runSync(
			runPlannerValidation(getPlannerFormState(), {
				minRoundCourseDistanceMeters,
				minRoundCourseDurationMs,
				minRoundCourseAscendMeters,
			}),
		);

		if (validation.valid) {
			return true;
		}

		fieldErrors = {
			...fieldErrors,
			...validation.fieldErrors,
		};
		return false;
	}

	function applyWorkoutPlanTarget(): boolean {
		const exit = Effect.runSyncExit(
			Effect.gen(function* () {
				if (plannerMode !== "round_course" || !workoutPlanInput.trim()) {
					roundCourseWorkoutTarget = null;
					workoutPlanError = null;
					return true;
				}

				const parsedWorkout = yield* parseWorkoutPlanEffect(workoutPlanInput);
				if (parsedWorkout.errors.length > 0) {
					const [firstError] = parsedWorkout.errors;
					roundCourseWorkoutTarget = null;
					workoutPlanError = `Line ${firstError.line}: ${firstError.message}`;
					return false;
				}

				if (parsedWorkout.totalDurationMs < minRoundCourseDurationMs) {
					roundCourseWorkoutTarget = null;
					workoutPlanError =
						"Workout must be at least 15 minutes for a round course.";
					return false;
				}

				roundCourseTargetKind = "duration";
				roundCourseDurationInput = formatRoundCourseDurationInput(
					parsedWorkout.totalDurationMs,
				);
				const workoutEstimate = yield* estimateWorkoutTargetEffect(
					parsedWorkout.expandedSteps,
				);
				roundCourseWorkoutTarget = {
					kind: "workout",
					durationMs: workoutEstimate.durationMs,
					distanceMeters: workoutEstimate.distanceMeters,
					estimatedSpeedMetersPerHour:
						workoutEstimate.estimatedSpeedMetersPerHour,
					weightedIntensity: workoutEstimate.weightedIntensity,
					trainingProfile: workoutEstimate.trainingProfile,
				};
				fieldErrors = {
					...fieldErrors,
					roundCourseTarget: undefined,
				};
				workoutPlanError = null;
				return true;
			}),
		);

		if (Exit.isSuccess(exit)) {
			return exit.value;
		}

		const error = Cause.squash(exit.cause);
		const message =
			error instanceof Error
				? error.message
				: typeof error === "string"
					? error
					: "Unknown workout parse failure.";

		roundCourseWorkoutTarget = null;
		workoutPlanError = `Could not parse workout plan: ${message}`;
		return false;
	}

	function useCurrentLocationAsStop(field: RouteField) {
		return dependencies.useCurrentLocationAsStop(field);
	}

	function destroy() {
		Effect.runSync(completionController.destroy());
	}

	return {
		get plannerMode() {
			return plannerMode;
		},
		get startStop() {
			return startStop;
		},
		get waypointStops() {
			return waypointStops;
		},
		get destinationStop() {
			return destinationStop;
		},
		get roundCourseTargetKind() {
			return roundCourseTargetKind;
		},
		get roundCourseDistanceInput() {
			return roundCourseDistanceInput;
		},
		get roundCourseDistanceMetersInput() {
			return roundCourseDistanceMetersInput;
		},
		get roundCourseDurationInput() {
			return roundCourseDurationInput;
		},
		get roundCourseAscendMeters() {
			return roundCourseAscendMeters;
		},
		get workoutPlanInput() {
			return workoutPlanInput;
		},
		get workoutPlanError() {
			return workoutPlanError;
		},
		get spatialConstraintKind() {
			return spatialConstraintKind;
		},
		get spatialConstraintEnforcement() {
			return spatialConstraintEnforcement;
		},
		get constraintCenterStop() {
			return constraintCenterStop;
		},
		get areaRadiusInput() {
			return areaRadiusInput;
		},
		get corridorWidthInput() {
			return corridorWidthInput;
		},
		get areaRadiusMetersInput() {
			return areaRadiusMetersInput;
		},
		get corridorWidthMetersInput() {
			return corridorWidthMetersInput;
		},
		get formattedInputDistanceUnit() {
			return formattedInputDistanceUnit;
		},
		get fieldErrors() {
			return fieldErrors;
		},
		get advancedOpen() {
			return advancedOpen;
		},
		set advancedOpen(value) {
			advancedOpen = value;
		},
		get completionController() {
			return completionController;
		},
		get isRoundCourseMode() {
			return isRoundCourseMode;
		},
		get isOutAndBackMode() {
			return isOutAndBackMode;
		},
		get hasAdvancedErrors() {
			return hasAdvancedErrors;
		},
		getPlannerFormState,
		applyPlannerFormState,
		setFieldErrors,
		setPlannerMode,
		getDestinationFieldLabel,
		getDestinationSuggestionsLabel,
		getDestinationPlaceholder,
		getCurrentLocationDestinationLabel,
		getSubmitButtonText,
		resetSpatialConstraintDefaults,
		validateDistanceInputs,
		applyWorkoutPlanTarget,
		updateRoundCourseTargetKind,
		updateRoundCourseDistanceInput,
		updateRoundCourseDuration,
		updateRoundCourseAscend,
		updateWorkoutPlanInput,
		updateSpatialConstraintKind,
		updateSpatialConstraintEnforcement,
		setConstraintCenterStop,
		updateConstraintCenterInput,
		updateAreaRadiusInput,
		updateCorridorWidthInput,
		closeCompletionMenu,
		setFieldStop,
		setWaypointStop,
		handleFieldInput,
		updateField,
		getWaypointError,
		clearWaypointError,
		updateWaypoint,
		handleWaypointInput,
		addWaypoint,
		removeWaypoint,
		canMoveWaypoint,
		moveWaypoint,
		useCurrentLocationAsStop,
		destroy,
	};
}

export type PlannerFormController = ReturnType<
	typeof createPlannerFormController
>;
