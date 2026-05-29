import { describe, expect, it } from "vitest";

import type { PlannedRoute, RoundCourseTarget } from "$lib/route-planning";
import { neutralWorkoutSpeedMetersPerHour } from "$lib/workout-plan";

import {
	compareCandidateRoutes,
	getWorkoutAdjustedDurationMs,
	withRoundCourseTargetAdjustedDuration,
} from "./round-course-target";
import type { CandidateRouteResult } from "./types";

function buildRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
	return {
		mode: "round_course",
		source: { kind: "graphhopper" },
		startLabel: "Start",
		destinationLabel: "Start",
		waypoints: [],
		bounds: [11.5, 48.1, 11.7, 48.2],
		distanceMeters: 50_000,
		durationMs: 7_200_000,
		ascendMeters: 500,
		descendMeters: 500,
		coordinates: [
			[11.5755, 48.1374, 520],
			[11.6, 48.12, 600],
			[11.5755, 48.1374, 520],
		],
		surfaceDetails: [],
		smoothnessDetails: [],
		...overrides,
	};
}

function buildWorkoutTarget(
	overrides: Partial<Extract<RoundCourseTarget, { kind: "workout" }>> = {},
): Extract<RoundCourseTarget, { kind: "workout" }> {
	return {
		kind: "workout",
		durationMs: 7_200_000,
		distanceMeters: 50_000,
		estimatedSpeedMetersPerHour: neutralWorkoutSpeedMetersPerHour,
		weightedIntensity: 0.7,
		...overrides,
	};
}

describe("round-course workout target duration", () => {
	it("keeps GraphHopper duration at the neutral workout speed", () => {
		const route = buildRoute({ durationMs: 8_100_000 });

		expect(getWorkoutAdjustedDurationMs(route, buildWorkoutTarget())).toBe(
			8_100_000,
		);
	});

	it("shortens GraphHopper duration proportionally for higher workout speed", () => {
		const route = buildRoute({ durationMs: 8_100_000 });

		expect(
			getWorkoutAdjustedDurationMs(
				route,
				buildWorkoutTarget({
					estimatedSpeedMetersPerHour: neutralWorkoutSpeedMetersPerHour * 1.5,
				}),
			),
		).toBe(5_400_000);
	});

	it("returns the workout-adjusted duration without replacing route duration", () => {
		const route = buildRoute({ durationMs: 8_100_000 });
		const adjusted = withRoundCourseTargetAdjustedDuration(
			route,
			buildWorkoutTarget({
				estimatedSpeedMetersPerHour: neutralWorkoutSpeedMetersPerHour * 1.5,
			}),
		);

		expect(adjusted.route).toBe(route);
		expect(adjusted.route.durationMs).toBe(8_100_000);
		expect(adjusted.adjustedDurationMs).toBe(5_400_000);
	});

	it("falls back to raw GraphHopper duration for invalid workout speed", () => {
		const route = buildRoute({ durationMs: 8_100_000 });

		expect(
			getWorkoutAdjustedDurationMs(
				route,
				buildWorkoutTarget({ estimatedSpeedMetersPerHour: Number.NaN }),
			),
		).toBe(8_100_000);
	});

	it("ranks workout candidates by terrain-aware adjusted duration", () => {
		const target = buildWorkoutTarget({ durationMs: 7_200_000 });
		const slowTerrain: CandidateRouteResult = {
			route: buildRoute({
				distanceMeters: 50_000,
				durationMs: 9_000_000,
				ascendMeters: 1_100,
			}),
			requestedDistanceMeters: 50_000,
			sequence: 0,
		};
		const fastTerrain: CandidateRouteResult = {
			route: buildRoute({
				distanceMeters: 50_500,
				durationMs: 7_260_000,
				ascendMeters: 350,
			}),
			requestedDistanceMeters: 50_000,
			sequence: 1,
		};

		expect(
			compareCandidateRoutes(fastTerrain, slowTerrain, target),
		).toBeLessThan(0);
	});
});
