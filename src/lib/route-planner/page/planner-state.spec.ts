import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	maxRouteEditGeometryHistoryEntries,
	maxRouteEditHistoryEntries,
} from "$lib/route-planner/constants";
import type { PlannedRoute } from "$lib/route-planning";
import type { RouteEditSnapshot } from "../types";
import {
	buildCurrentRouteRequest,
	capRouteEditSnapshotStack,
	captureRouteEditSnapshot,
	createPlannerStop,
	getActiveRouteForSaving,
	getDefaultSpatialConstraintState,
	hydratePlannerStateFromRoute,
	type PlannerFormState,
	type PlannerRouteState,
	parseRoundCourseDurationInput,
	restoreRouteEditSnapshot,
	validatePlannerForm,
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

function createRouteEditSnapshot(
	id: number,
	routeAlternativesCloned = false,
): RouteEditSnapshot {
	return Effect.runSync(
		captureRouteEditSnapshot(
			createBaseFormState(),
			{
				...createBaseRouteState(),
				routeAlternatives: [
					{
						...baseRoute,
						startLabel: `Route ${id}`,
					},
				],
				lastGeneratedRouteCount: id,
			},
			routeAlternativesCloned ? { includeRoutesGeometry: true } : {},
		),
	);
}

function getSnapshotIds(snapshots: RouteEditSnapshot[]): number[] {
	return snapshots.map((snapshot) => snapshot.lastGeneratedRouteCount ?? -1);
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
		const request = Effect.runSync(
			buildCurrentRouteRequest(form, { lockedSegmentIndexes: [1] }, [
				{
					kind: "road_segment",
					label: "Avoided road 1",
					centerline: [
						[11.6, 48.1],
						[11.7, 48.0],
					],
					bufferMeters: 35,
				},
			]),
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

		const hydrated = Effect.runSync(hydratePlannerStateFromRoute(route));

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
		const validation = Effect.runSync(
			validatePlannerForm(
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
			),
		);

		expect(validation.valid).toBe(false);
		expect(validation.fieldErrors.roundCourseTarget).toBe(
			"Enter a target time.",
		);
		expect(validation.fieldErrors.spatialConstraint).toBeUndefined();
	});

	it("returns validation errors for below-minimum round-course distance targets", () => {
		const validation = Effect.runSync(
			validatePlannerForm(
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
			),
		);

		expect(validation.valid).toBe(false);
		expect(validation.fieldErrors.roundCourseTarget).toBe(
			"Enter a target distance of at least 10000 meters.",
		);
	});

	it("accepts round-course distance targets at the exact minimum", () => {
		const validation = Effect.runSync(
			validatePlannerForm(
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
			),
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

		const routeForSaving = Effect.runSync(
			getActiveRouteForSaving({
				activeRoute,
				lockedSegmentIndexes: [],
				avoidedRoads: [],
			}),
		);

		expect(routeForSaving?.manualEditing).toBeUndefined();
	});

	it("captures and restores route edit snapshots without sharing references", () => {
		const form = createBaseFormState();
		form.fieldErrors = {
			waypointQueries: ["Waypoint missing"],
		};
		const routeState = createBaseRouteState();
		const snapshot = Effect.runSync(
			captureRouteEditSnapshot(form, routeState, {
				includeRoutesGeometry: true,
			}),
		);
		const restored = Effect.runSync(restoreRouteEditSnapshot(snapshot));

		expect(restored.form).toEqual(form);
		expect(restored.routeState).toEqual(routeState);
		expect(restored.form.startStop).not.toBe(form.startStop);
		expect(restored.form.waypointStops).not.toBe(form.waypointStops);
		expect(restored.routeState.avoidedRoads).not.toBe(routeState.avoidedRoads);
		expect(restored.routeState.routeAlternatives[0]).not.toBe(
			routeState.routeAlternatives[0],
		);
	});

	it("marks normal route edit snapshots as not geometry-cloned", () => {
		const form = createBaseFormState();
		const routeState = createBaseRouteState();
		const snapshot = Effect.runSync(captureRouteEditSnapshot(form, routeState));

		expect(snapshot.routeAlternativesCloned).toBe(false);
	});

	it("marks full-geometry route edit snapshots and clones route objects", () => {
		const form = createBaseFormState();
		const routeState = createBaseRouteState();
		const snapshot = Effect.runSync(
			captureRouteEditSnapshot(form, routeState, {
				includeRoutesGeometry: true,
			}),
		);

		expect(snapshot.routeAlternativesCloned).toBe(true);
		expect(snapshot.routeAlternatives).toEqual(routeState.routeAlternatives);
		expect(snapshot.routeAlternatives[0]).not.toBe(
			routeState.routeAlternatives[0],
		);
	});

	it("caps lightweight route edit snapshots at the normal history limit", () => {
		const snapshots = Array.from(
			{ length: maxRouteEditHistoryEntries + 5 },
			(_, index) => createRouteEditSnapshot(index),
		);
		const cappedSnapshots = capRouteEditSnapshotStack(snapshots);

		expect(cappedSnapshots).toHaveLength(maxRouteEditHistoryEntries);
		expect(getSnapshotIds(cappedSnapshots)).toEqual(
			Array.from(
				{ length: maxRouteEditHistoryEntries },
				(_, index) => index + 5,
			),
		);
		expect(
			cappedSnapshots.every((snapshot) => !snapshot.routeAlternativesCloned),
		).toBe(true);
	});

	it("drops oldest geometry-cloned snapshots past the geometry history limit", () => {
		const snapshots = Array.from(
			{ length: maxRouteEditGeometryHistoryEntries + 3 },
			(_, index) => createRouteEditSnapshot(index, true),
		);
		const cappedSnapshots = capRouteEditSnapshotStack(snapshots);

		expect(cappedSnapshots).toHaveLength(maxRouteEditGeometryHistoryEntries);
		expect(getSnapshotIds(cappedSnapshots)).toEqual(
			Array.from(
				{ length: maxRouteEditGeometryHistoryEntries },
				(_, index) => index + 3,
			),
		);
		expect(
			cappedSnapshots.every((snapshot) => snapshot.routeAlternativesCloned),
		).toBe(true);
	});

	it("retains lightweight snapshots while dropping only oldest geometry snapshots", () => {
		const snapshots = [
			createRouteEditSnapshot(1),
			createRouteEditSnapshot(2, true),
			createRouteEditSnapshot(3),
			createRouteEditSnapshot(4, true),
			createRouteEditSnapshot(5, true),
			createRouteEditSnapshot(6),
			createRouteEditSnapshot(7, true),
			createRouteEditSnapshot(8, true),
		];
		const cappedSnapshots = capRouteEditSnapshotStack(snapshots, {
			maxEntries: 20,
			maxGeometryEntries: 2,
		});

		expect(getSnapshotIds(cappedSnapshots)).toEqual([1, 3, 6, 7, 8]);
		expect(
			cappedSnapshots
				.filter((snapshot) => snapshot.routeAlternativesCloned)
				.map((snapshot) => snapshot.lastGeneratedRouteCount),
		).toEqual([7, 8]);
	});
});
