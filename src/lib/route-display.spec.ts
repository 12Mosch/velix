import { beforeEach, describe, expect, it } from "vitest";
import type { PlannedRoute } from "$lib/route-planning";
import {
	formatDuration,
	formatRoundCourseTarget,
	formatWaypointSummary,
	getRoundCourseTarget,
	getRouteDurationText,
	getRouteLegText,
	getRouteTitle,
} from "$lib/route-display";
import {
	resetUnitPreferenceForTests,
	setDistanceUnitPreference,
} from "$lib/unit-settings.svelte";

function createRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
	return {
		mode: "point_to_point",
		source: {
			kind: "graphhopper",
		},
		startLabel: "Start",
		destinationLabel: "Destination",
		waypoints: [],
		bounds: [0, 0, 1, 1],
		distanceMeters: 10000,
		durationMs: 45 * 60_000,
		ascendMeters: 100,
		descendMeters: 100,
		coordinates: [
			[0, 0, 100],
			[1, 1, 100],
		],
		surfaceDetails: [],
		smoothnessDetails: [],
		...overrides,
	};
}

describe("route display helpers", () => {
	beforeEach(() => {
		resetUnitPreferenceForTests();
	});

	it("formats durations under one hour in minutes", () => {
		expect(formatDuration(45 * 60_000)).toBe("45 min");
	});

	it("formats durations of one hour or more as hours and minutes", () => {
		expect(formatDuration(3.5 * 60 * 60_000)).toBe("3:30 h");
	});

	it("returns no waypoint summary for an empty waypoint list", () => {
		expect(formatWaypointSummary([])).toBeNull();
	});

	it("formats multiple waypoints as a via summary", () => {
		expect(formatWaypointSummary([{ label: "A" }, { label: "B" }])).toBe(
			"Via: A -> B",
		);
	});

	it("formats point-to-point leg text", () => {
		expect(getRouteLegText(createRoute())).toBe("to Destination");
	});

	it("formats out-and-back leg text", () => {
		expect(
			getRouteLegText(
				createRoute({
					mode: "out_and_back",
				}),
			),
		).toBe("to Destination and back");
	});

	it("formats round-course leg text", () => {
		expect(
			getRouteLegText(
				createRoute({
					mode: "round_course",
				}),
			),
		).toBe("Returns to start");
	});

	it("formats round-course titles", () => {
		expect(
			getRouteTitle(
				createRoute({
					mode: "round_course",
				}),
			),
		).toBe("Start loop");
	});

	it("formats distance targets with the selected unit preference", () => {
		setDistanceUnitPreference("mi");

		expect(
			formatRoundCourseTarget({
				kind: "distance",
				distanceMeters: 1609.344,
			}),
		).toBe("1.0 mi");
	});

	it("formats duration targets", () => {
		expect(
			formatRoundCourseTarget({
				kind: "duration",
				durationMs: 3.5 * 60 * 60_000,
			}),
		).toBe("3:30 h");
	});

	it("formats workout targets by workout duration", () => {
		expect(
			formatRoundCourseTarget({
				kind: "workout",
				durationMs: 90 * 60_000,
				distanceMeters: 33000,
				estimatedSpeedMetersPerHour: 22000,
				weightedIntensity: 0.7,
			}),
		).toBe("1:30 h");
	});

	it("formats ascent targets", () => {
		expect(
			formatRoundCourseTarget({
				kind: "ascend",
				ascendMeters: 800,
			}),
		).toBe("800 m up");
	});

	it("marks imported GPX routes without duration as unavailable", () => {
		expect(
			getRouteDurationText(
				createRoute({
					source: {
						kind: "gpx_import",
						filename: "route.gpx",
						stopDerivation: "track",
						hasDuration: false,
					},
					durationMs: 0,
				}),
			),
		).toBe("Time unavailable");
	});

	it("uses legacy requested distance as a round-course target", () => {
		expect(
			getRoundCourseTarget(
				createRoute({
					mode: "round_course",
					requestedDistanceMeters: 50000,
				}),
			),
		).toEqual({
			kind: "distance",
			distanceMeters: 50000,
		});
	});
});
