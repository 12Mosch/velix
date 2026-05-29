import { describe, expect, it } from "vitest";

import type { PlannedRoute } from "$lib/route-planning";
import {
	buildCurrentRouteRequest,
	captureRouteEditSnapshot,
	createPlannerStop,
	getDefaultSpatialConstraintState,
	getActiveRouteForSaving,
	hydratePlannerStateFromRoute,
	parseRoundCourseDurationInput,
	restoreRouteEditSnapshot,
	validatePlannerForm,
	type PlannerFormState,
	type PlannerRouteState,
} from "./planner-state";

function createBaseFormState(): PlannerFormState {
	return {
		plannerMode: "point_to_point",
		startStop: createPlannerStop("Start", [11.57, 48.13], "suggestion"),
		waypointStops: [
			createPlannerStop("Waypoint", [11.65, 48.08], "suggestion"),
		],
		destinationStop: createPlannerStop(
			"Destination",
			[11.86, 47.73],
			"suggestion",
		),
		roundCourseTargetKind: "distance",
		roundCourseDistanceInput: "",
		roundCourseDistanceMetersInput: null,
		roundCourseDurationInput: "",
		roundCourseAscendMeters: "",
		roundCourseWorkoutTarget: null,
		...getDefaultSpatialConstraintState(),
		fieldErrors: {},
	};
}

function createBaseRouteState(): PlannerRouteState {
	return {
		routeAlternatives: [baseRoute],
		selectedRouteIndex: 0,
		routeNeedsRecalculation: true,
		lockedSegmentIndexes: [1],
		avoidedRoads: [
			{
				kind: "road_segment",
				label: "Avoided road 1",
				centerline: [
					[11.6, 48.1],
					[11.7, 48.0],
				],
				bufferMeters: 35,
				polygon: [
					[11.59, 48.11],
					[11.71, 48.11],
					[11.71, 47.99],
					[11.59, 47.99],
					[11.59, 48.11],
				],
			},
		],
		lastGeneratedRouteCount: 2,
	};
}

const baseRoute: PlannedRoute = {
	mode: "point_to_point",
	source: { kind: "graphhopper" },
	startLabel: "Start",
	destinationLabel: "Destination",
	waypoints: [
		{
			label: "Waypoint",
			coordinate: [11.65, 48.08, 600],
		},
	],
	bounds: [11.57, 47.73, 11.86, 48.13],
	distanceMeters: 62000,
	durationMs: 10_800_000,
	ascendMeters: 800,
	descendMeters: 750,
	coordinates: [
		[11.57, 48.13, 520],
		[11.65, 48.08, 600],
		[11.86, 47.73, 785],
	],
	surfaceDetails: [],
	smoothnessDetails: [],
};

describe("planner-state", () => {
	it("builds route requests with manual editing and avoidances", () => {
		const form = createBaseFormState();
		const request = buildCurrentRouteRequest(
			form,
			{ lockedSegmentIndexes: [1] },
			[
				{
					kind: "road_segment",
					label: "Avoided road 1",
					centerline: [
						[11.6, 48.1],
						[11.7, 48.0],
					],
					bufferMeters: 35,
				},
			],
		);

		expect(request).toEqual({
			mode: "point_to_point",
			start: { label: "Start", point: [11.57, 48.13] },
			waypoints: [{ label: "Waypoint", point: [11.65, 48.08] }],
			destination: { label: "Destination", point: [11.86, 47.73] },
			manualEditing: { lockedSegmentIndexes: [1] },
			avoidances: [
				{
					kind: "road_segment",
					label: "Avoided road 1",
					centerline: [
						[11.6, 48.1],
						[11.7, 48.0],
					],
					bufferMeters: 35,
				},
			],
		});
	});

	it("hydrates planner form state from a round-course route with area constraint", () => {
		const route: PlannedRoute = {
			...baseRoute,
			mode: "round_course",
			destinationLabel: "Start",
			roundCourseTarget: {
				kind: "duration",
				durationMs: 7_200_000,
			},
			spatialConstraint: {
				kind: "area",
				label: "Munich, Germany",
				center: [11.57, 48.13],
				radiusMeters: 30_000,
				enforcement: "strict",
				polygon: [
					[11.2, 48.0],
					[11.9, 48.0],
					[11.9, 48.3],
					[11.2, 48.3],
					[11.2, 48.0],
				],
			},
			avoidances: createBaseRouteState().avoidedRoads,
		};

		const hydrated = hydratePlannerStateFromRoute(route);

		expect(hydrated.form.plannerMode).toBe("round_course");
		expect(hydrated.form.startStop).toEqual(
			createPlannerStop("Start", [11.57, 48.13], "suggestion"),
		);
		expect(hydrated.form.waypointStops).toHaveLength(1);
		expect(hydrated.form.destinationStop.label).toBe("");
		expect(hydrated.form.roundCourseTargetKind).toBe("duration");
		expect(hydrated.form.roundCourseDurationInput).toBe("2:00");
		expect(hydrated.form.spatialConstraintKind).toBe("area");
		expect(hydrated.form.constraintCenterStop.label).toBe("Munich, Germany");
		expect(hydrated.avoidedRoads).toEqual(createBaseRouteState().avoidedRoads);
		expect(hydrated.avoidedRoads).not.toBe(route.avoidances);
	});

	it("returns validation errors for invalid round-course and corridor inputs", () => {
		const validation = validatePlannerForm(
			{
				plannerMode: "round_course",
				roundCourseTargetKind: "duration",
				roundCourseDistanceMetersInput: null,
				roundCourseDurationInput: "0:10",
				roundCourseAscendMeters: "10",
				spatialConstraintKind: "corridor",
				areaRadiusMetersInput: null,
				corridorWidthMetersInput: 1000,
			},
			{
				minRoundCourseDistanceMeters: 10_000,
				minRoundCourseDurationMs: 15 * 60 * 1000,
				minRoundCourseAscendMeters: 50,
			},
		);

		expect(validation.valid).toBe(false);
		expect(validation.fieldErrors.roundCourseTarget).toBe(
			"Enter a target time.",
		);
		expect(validation.fieldErrors.spatialConstraint).toBeUndefined();
	});

	it("returns validation errors for below-minimum round-course distance targets", () => {
		const validation = validatePlannerForm(
			{
				...createBaseFormState(),
				plannerMode: "round_course",
				roundCourseTargetKind: "distance",
				roundCourseDistanceMetersInput: 9_999,
			},
			{
				minRoundCourseDistanceMeters: 10_000,
				minRoundCourseDurationMs: 15 * 60 * 1000,
				minRoundCourseAscendMeters: 50,
			},
		);

		expect(validation.valid).toBe(false);
		expect(validation.fieldErrors.roundCourseTarget).toBe(
			"Enter a target distance of at least 10000 meters.",
		);
	});

	it("accepts round-course distance targets at the exact minimum", () => {
		const validation = validatePlannerForm(
			{
				...createBaseFormState(),
				plannerMode: "round_course",
				roundCourseTargetKind: "distance",
				roundCourseDistanceMetersInput: 10_000,
			},
			{
				minRoundCourseDistanceMeters: 10_000,
				minRoundCourseDurationMs: 15 * 60 * 1000,
				minRoundCourseAscendMeters: 50,
			},
		);

		expect(validation.valid).toBe(true);
		expect(validation.fieldErrors.roundCourseTarget).toBeUndefined();
	});

	it("rejects malformed H:MM round-course duration inputs", () => {
		expect(parseRoundCourseDurationInput("-1:30")).toBeNull();
		expect(parseRoundCourseDurationInput("1:")).toBeNull();
		expect(parseRoundCourseDurationInput(":30")).toBeNull();
		expect(parseRoundCourseDurationInput("1:30")).toBe(5_400_000);
	});

	it("clears stale manual editing when saving a route without locks", () => {
		const activeRoute: PlannedRoute = {
			...baseRoute,
			manualEditing: {
				lockedSegmentIndexes: [0],
			},
		};

		const routeForSaving = getActiveRouteForSaving({
			activeRoute,
			lockedSegmentIndexes: [],
			avoidedRoads: [],
		});

		expect(routeForSaving?.manualEditing).toBeUndefined();
	});

	it("captures and restores route edit snapshots without sharing references", () => {
		const form = createBaseFormState();
		form.fieldErrors = {
			waypointQueries: ["Waypoint missing"],
		};
		const routeState = createBaseRouteState();
		const snapshot = captureRouteEditSnapshot(form, routeState, {
			includeRoutesGeometry: true,
		});
		const restored = restoreRouteEditSnapshot(snapshot);

		expect(restored.form).toEqual(form);
		expect(restored.routeState).toEqual(routeState);
		expect(restored.form.startStop).not.toBe(form.startStop);
		expect(restored.form.waypointStops).not.toBe(form.waypointStops);
		expect(restored.routeState.avoidedRoads).not.toBe(routeState.avoidedRoads);
		expect(restored.routeState.routeAlternatives[0]).not.toBe(
			routeState.routeAlternatives[0],
		);
	});
});
