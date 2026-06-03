import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	analyzeWorkoutTrainingProfile,
	estimateWorkoutTarget,
	parseWorkoutPlan,
	parseWorkoutPlanEffect,
} from "./workout-plan";

describe("parseWorkoutPlan", () => {
	it("exposes an Effect parser for workflow composition", () => {
		const parsed = Effect.runSync(parseWorkoutPlanEffect("5m Z2 HR"));

		expect(parsed.errors).toEqual([]);
		expect(parsed.totalDurationMs).toBe(5 * 60 * 1000);
	});

	it("parses supported duration formats", () => {
		const parsed = parseWorkoutPlan(`
30s Z2
5m Z2
1h Z2
1h30m Z2
1'30" Z2
30" Z2
`);

		expect(parsed.errors).toEqual([]);
		expect(parsed.parsedStepCount).toBe(6);
		expect(parsed.expandedStepCount).toBe(6);
		expect(parsed.totalDurationMs).toBe(
			(30 + 5 * 60 + 60 * 60 + 90 * 60 + 90 + 30) * 1000,
		);
	});

	it("accepts HR, LTHR, FTP, power zone, and cadence targets", () => {
		const parsed = parseWorkoutPlan(`
5m Z2 HR
4m Z1-Z2 HR 85-95rpm
3m 85-90% HR
2m 95% LTHR
1m 120% FTP 90rpm
30s Power Z5 85-95rpm
`);

		expect(parsed.errors).toEqual([]);
		expect(parsed.parsedStepCount).toBe(6);
		expect(parsed.expandedSteps[0]).toMatchObject({
			line: 2,
			durationMs: 5 * 60 * 1000,
			target: {
				intensity: {
					kind: "zone",
					domain: "heart_rate",
					minZone: 2,
					maxZone: 2,
				},
			},
		});
		expect(parsed.expandedSteps[1]).toMatchObject({
			target: {
				cadence: {
					minRpm: 85,
					maxRpm: 95,
				},
			},
		});
		expect(parsed.expandedSteps[2]).toMatchObject({
			target: {
				intensity: {
					kind: "percent",
					domain: "heart_rate",
					minPercent: 85,
					maxPercent: 90,
				},
			},
		});
		expect(parsed.expandedSteps[4]).toMatchObject({
			target: {
				intensity: {
					kind: "percent",
					domain: "ftp",
					minPercent: 120,
					maxPercent: 120,
				},
				cadence: {
					minRpm: 90,
					maxRpm: 90,
				},
			},
		});
		expect(parsed.expandedSteps[5]).toMatchObject({
			target: {
				intensity: {
					kind: "zone",
					domain: "power",
					minZone: 5,
					maxZone: 5,
				},
			},
		});
		expect(parsed.totalDurationMs).toBe(
			(5 * 60 + 4 * 60 + 3 * 60 + 2 * 60 + 60 + 30) * 1000,
		);
	});

	it("estimates longer workout distance for higher intensity", () => {
		const easy = parseWorkoutPlan("30m Z2 HR");
		const hard = parseWorkoutPlan("30m 120% FTP");

		expect(easy.errors).toEqual([]);
		expect(hard.errors).toEqual([]);
		expect(
			estimateWorkoutTarget(hard.expandedSteps).distanceMeters,
		).toBeGreaterThan(estimateWorkoutTarget(easy.expandedSteps).distanceMeters);
	});

	it("keeps cadence-only targets neutral for speed estimates", () => {
		const neutral = estimateWorkoutTarget(
			parseWorkoutPlan("30m Z2 HR").expandedSteps,
		);
		const cadenceOnly = estimateWorkoutTarget(
			parseWorkoutPlan("30m 90rpm").expandedSteps,
		);

		expect(cadenceOnly.weightedIntensity).toBe(0.7);
		expect(cadenceOnly.distanceMeters).toBeCloseTo(neutral.distanceMeters, 6);
	});

	it("classifies endurance workouts", () => {
		const parsed = parseWorkoutPlan("75m Z2 HR\n10m Z1 HR");
		const profile = analyzeWorkoutTrainingProfile(parsed.expandedSteps);

		expect(profile.sessionKind).toBe("endurance");
		expect(profile.enduranceShare).toBeGreaterThan(0.75);
		expect(profile.highIntensityShare).toBe(0);
	});

	it("classifies interval workouts with high intensity repeats", () => {
		const parsed = parseWorkoutPlan(`
10m Z2 HR
6x
  1m 120% FTP
  2m Z2 HR
10m Z2 HR
`);
		const profile = analyzeWorkoutTrainingProfile(parsed.expandedSteps);

		expect(profile.sessionKind).toBe("intervals");
		expect(profile.highIntensityShare).toBeGreaterThan(0.12);
		expect(profile.longestWorkIntervalMs).toBe(60 * 1000);
	});

	it("classifies sustained threshold workouts before interval heuristics", () => {
		const parsed = parseWorkoutPlan("10m Z2 HR\n30m Z4 HR\n10m Z2 HR");
		const profile = analyzeWorkoutTrainingProfile(parsed.expandedSteps);

		expect(profile.sessionKind).toBe("threshold");
		expect(profile.thresholdShare).toBeGreaterThan(0.25);
	});

	it("duration-weights cadence target share", () => {
		const parsed = parseWorkoutPlan("10m Z2 HR 90rpm\n30m Z2 HR");
		const profile = analyzeWorkoutTrainingProfile(parsed.expandedSteps);

		expect(profile.cadenceTargetShare).toBeCloseTo(0.25, 6);
	});

	it("includes the training profile in workout estimates", () => {
		const parsed = parseWorkoutPlan("30m Z2 HR");
		const estimate = estimateWorkoutTarget(parsed.expandedSteps);

		expect(estimate.trainingProfile).toMatchObject({
			version: 1,
			durationMs: 30 * 60 * 1000,
			sessionKind: "endurance",
		});
		expect(estimate.trainingProfile.estimatedDistanceMeters).toBe(
			estimate.distanceMeters,
		);
	});

	it("expands named and unnamed repeat blocks", () => {
		const parsed = parseWorkoutPlan(`
Warmup
  10m Z2
Main set 4x
  30s 120% FTP
  1'30" Z2 HR
2x
5m 90% FTP
2m Z2
Cool down
  5m Z2
`);

		expect(parsed.errors).toEqual([]);
		expect(parsed.repeatCount).toBe(2);
		expect(parsed.parsedStepCount).toBe(6);
		expect(parsed.expandedStepCount).toBe(14);
		expect(parsed.totalDurationMs).toBe(
			(10 * 60 + 4 * (30 + 90) + 2 * (5 * 60 + 2 * 60) + 5 * 60) * 1000,
		);
	});

	it("ignores section titles and blank lines", () => {
		const parsed = parseWorkoutPlan(`
Warmup

5m Z2 HR

Cool down
5m Z1 HR
`);

		expect(parsed.errors).toEqual([]);
		expect(parsed.parsedStepCount).toBe(2);
		expect(parsed.totalDurationMs).toBe(10 * 60 * 1000);
	});

	it("reports invalid duration and target lines with line numbers", () => {
		const parsed = parseWorkoutPlan(`
Warmup
5q Z2
5m tempo
`);

		expect(parsed.errors).toEqual([
			{ line: 3, message: "Expected a duration like 30s, 5m, or 1h30m." },
			{ line: 4, message: 'Unsupported workout target "tempo".' },
		]);
	});

	it("reports malformed and empty repeat blocks", () => {
		const parsed = parseWorkoutPlan(`
Main set 4x
Cool down
  5m Z2
2x
`);

		expect(parsed.errors).toEqual([
			{ line: 2, message: "Repeat block must contain at least one step." },
			{ line: 5, message: "Repeat block must contain at least one step." },
		]);
	});

	it("rejects non-finite durations and absurd repeat counts as parse errors", () => {
		const parsed = parseWorkoutPlan(
			[`${"9".repeat(400)}s Z2`, "1001x", "  30s Z2"].join("\n"),
		);

		expect(parsed.errors).toEqual([
			{ line: 1, message: "Duration must be a finite value." },
			{
				line: 2,
				message: "Repeat blocks cannot repeat more than 1000 times.",
			},
		]);
	});

	it("creates fresh step objects for each repeat expansion", () => {
		const flat = parseWorkoutPlan(`
2x
30s Z2
`);
		const indented = parseWorkoutPlan(`
2x
  30s Z2
`);

		expect(flat.expandedSteps[0]).not.toBe(flat.expandedSteps[1]);
		expect(flat.expandedSteps[0]?.target).not.toBe(
			flat.expandedSteps[1]?.target,
		);
		expect(indented.expandedSteps[0]).not.toBe(indented.expandedSteps[1]);
		expect(indented.expandedSteps[0]?.target).not.toBe(
			indented.expandedSteps[1]?.target,
		);
	});
});
