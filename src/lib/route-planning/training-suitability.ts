import type {
	PlannedRoute,
	RouteClimb,
	RouteQualityConfidence,
	RouteTrainingSuitabilityAnalysis,
	RouteTrainingSuitabilityFlag,
	RouteTrainingSuitabilitySubscore,
	RoundCourseTarget,
} from "./types";
import type {
	WorkoutTrainingProfile,
	WorkoutTrainingSessionKind,
} from "../workout-plan";
import { analyzeRouteClimbs } from "./climbs";
import {
	calculateRouteGradientMetrics,
	getRouteElevationAnalysisPoints,
} from "./elevation";
import { getQualityBand, getRouteQuality } from "./quality";

const defaultWeights = {
	durationMatch: 14,
	distanceMatch: 10,
	surfaceFit: 18,
	flowFit: 24,
	safetyFit: 22,
	terrainFit: 12,
} as const;

function clampScore(score: number): number {
	return Math.max(0, Math.min(100, Math.round(score)));
}

function subscore(
	score: number | null,
	label: string,
	summary: string,
	weight: number,
): RouteTrainingSuitabilitySubscore {
	return {
		score,
		label,
		summary,
		available: score !== null,
		weight,
	};
}

function weightedAverage(
	parts: readonly { score: number | null; weight: number }[],
): number | null {
	const available = parts.filter(
		(part): part is { score: number; weight: number } => part.score !== null,
	);
	const totalWeight = available.reduce((sum, part) => sum + part.weight, 0);

	if (totalWeight <= 0) return null;

	return clampScore(
		available.reduce((sum, part) => sum + part.score * part.weight, 0) /
			totalWeight,
	);
}

function percentMiss(actual: number, target: number): number {
	return target > 0 ? Math.abs(actual - target) / target : 0;
}

function getWeights(
	sessionKind: WorkoutTrainingSessionKind | "unknown",
	profile: WorkoutTrainingProfile,
) {
	const weights = { ...defaultWeights };

	if (
		sessionKind === "intervals" ||
		sessionKind === "threshold" ||
		profile.highIntensityShare >= 0.12
	) {
		weights.flowFit += 6;
		weights.distanceMatch -= 3;
		weights.terrainFit -= 3;
	}

	return weights;
}

function getFallbackTrainingProfile(
	target: Extract<RoundCourseTarget, { kind: "workout" }>,
): WorkoutTrainingProfile {
	const intensity = Number.isFinite(target.weightedIntensity)
		? target.weightedIntensity
		: 0.7;
	const recoveryShare = intensity < 0.6 ? 1 : 0;
	const enduranceShare = intensity >= 0.6 && intensity < 0.78 ? 1 : 0;
	const tempoShare = intensity >= 0.78 && intensity < 0.9 ? 1 : 0;
	const thresholdShare = intensity >= 0.9 && intensity < 1.05 ? 1 : 0;
	const highIntensityShare = intensity >= 1.05 ? 1 : 0;

	return {
		version: 1,
		durationMs: target.durationMs,
		expandedStepCount: 0,
		weightedIntensity: intensity,
		estimatedDistanceMeters: target.distanceMeters,
		recoveryShare,
		enduranceShare,
		tempoShare,
		thresholdShare,
		highIntensityShare,
		cadenceTargetShare: 0,
		longestWorkIntervalMs:
			thresholdShare > 0 || highIntensityShare > 0 ? target.durationMs : 0,
		sessionKind: "mixed",
	};
}

function getTrainingSummary(
	score: number | null,
	sessionKind: WorkoutTrainingSessionKind | "unknown",
): string {
	const session =
		sessionKind === "unknown" ? "workout" : sessionKind.replace("_", " ");

	if (score === null) return `Training fit unavailable for this ${session}.`;
	if (score >= 85) return `Strong route fit for this ${session} session.`;
	if (score >= 70) return `Good route fit for this ${session} session.`;
	if (score >= 50) return `Mixed route fit for this ${session} session.`;
	return `Poor route fit for this ${session} session.`;
}

function calculateDurationMatch(
	route: PlannedRoute,
	target: Extract<RoundCourseTarget, { kind: "workout" }>,
	weight: number,
): RouteTrainingSuitabilitySubscore {
	if (target.durationMs <= 0) {
		return subscore(
			null,
			"Duration match",
			"Workout duration unavailable.",
			weight,
		);
	}

	const miss = percentMiss(route.durationMs, target.durationMs);

	return subscore(
		clampScore(100 - Math.min(70, miss * 220)),
		"Duration match",
		`${Math.round(miss * 100)}% from workout duration.`,
		weight,
	);
}

function calculateDistanceMatch(
	route: PlannedRoute,
	target: Extract<RoundCourseTarget, { kind: "workout" }>,
	weight: number,
): RouteTrainingSuitabilitySubscore {
	if (target.distanceMeters <= 0) {
		return subscore(
			null,
			"Distance match",
			"Workout distance estimate unavailable.",
			weight,
		);
	}

	const miss = percentMiss(route.distanceMeters, target.distanceMeters);

	return subscore(
		clampScore(100 - Math.min(60, miss * 180)),
		"Distance match",
		`${Math.round(miss * 100)}% from estimated workout distance.`,
		weight,
	);
}

function calculateTerrainFit(
	route: PlannedRoute,
	sessionKind: WorkoutTrainingSessionKind | "unknown",
	climbs: RouteClimb[],
	weight: number,
): RouteTrainingSuitabilitySubscore {
	const metrics = calculateRouteGradientMetrics(route);

	if (
		metrics.averageGradientPercent === null &&
		metrics.maximumGradientPercent === null &&
		route.distanceMeters <= 0
	) {
		return subscore(null, "Terrain fit", "Elevation data unavailable.", weight);
	}

	const climbDensity =
		route.distanceMeters > 0
			? route.ascendMeters / (route.distanceMeters / 1000)
			: 0;
	const allowance =
		sessionKind === "recovery"
			? 8
			: sessionKind === "endurance"
				? 18
				: sessionKind === "tempo"
					? 14
					: sessionKind === "threshold"
						? 10
						: sessionKind === "intervals"
							? 8
							: 14;
	const maxGrade = metrics.maximumGradientPercent ?? 0;
	const majorClimbCount =
		route.distanceMeters < 60000
			? climbs.filter((climb) =>
					["HC", "Cat 1", "Cat 2"].includes(climb.category),
				).length
			: 0;

	return subscore(
		clampScore(
			100 -
				Math.max(0, climbDensity - allowance) * 3.2 -
				Math.max(0, maxGrade - 10) * 5 -
				majorClimbCount * 14,
		),
		"Terrain fit",
		`${Math.round(climbDensity)} m/km climbing density for ${sessionKind === "unknown" ? "workout" : sessionKind} target.`,
		weight,
	);
}

function getConfidence(
	route: PlannedRoute,
	profileFromTarget: boolean,
): RouteQualityConfidence {
	const quality = getRouteQuality(route);

	if (profileFromTarget && quality.confidence === "high") return "high";
	if (profileFromTarget || quality.confidence === "high") return "medium";
	return "low";
}

function getFlags(
	route: PlannedRoute,
	target: Extract<RoundCourseTarget, { kind: "workout" }>,
	analysis: Omit<RouteTrainingSuitabilityAnalysis, "flags">,
): RouteTrainingSuitabilityFlag[] {
	const flags: RouteTrainingSuitabilityFlag[] = [];
	const { subscores } = analysis;
	const durationMiss = percentMiss(route.durationMs, target.durationMs);
	const distanceMiss = percentMiss(route.distanceMeters, target.distanceMeters);

	if (durationMiss > 0.12) {
		flags.push({
			code: "duration_mismatch",
			severity: durationMiss > 0.2 ? "warning" : "caution",
			label: "Duration mismatch",
			summary: `${Math.round(durationMiss * 100)}% away from planned workout duration.`,
		});
	}
	if (distanceMiss > 0.15) {
		flags.push({
			code: "distance_mismatch",
			severity: distanceMiss > 0.25 ? "warning" : "caution",
			label: "Distance mismatch",
			summary: `${Math.round(distanceMiss * 100)}% away from estimated workout distance.`,
		});
	}
	if ((subscores.flowFit.score ?? 100) < 60) {
		flags.push({
			code: "poor_interval_flow",
			severity: (subscores.flowFit.score ?? 100) < 45 ? "warning" : "caution",
			label: "Poor interval flow",
			summary:
				"Turn density or interruption risk may break steady work blocks.",
		});
	}
	if ((subscores.safetyFit.score ?? 100) < 60) {
		flags.push({
			code: "unsafe_training_context",
			severity: (subscores.safetyFit.score ?? 100) < 45 ? "warning" : "caution",
			label: "Unsafe training context",
			summary: "Traffic, wind, or road context may be stressful for training.",
		});
	}
	if ((subscores.surfaceFit.score ?? 100) < 60) {
		flags.push({
			code: "rough_training_surface",
			severity:
				(subscores.surfaceFit.score ?? 100) < 45 ? "warning" : "caution",
			label: "Rough training surface",
			summary: "Surface or road quality may reduce workout consistency.",
		});
	}
	if ((subscores.terrainFit.score ?? 100) < 55) {
		flags.push({
			code: "demanding_training_gradient",
			severity:
				(subscores.terrainFit.score ?? 100) < 40 ? "warning" : "caution",
			label: "Demanding training gradient",
			summary: "Climbing or maximum grade is demanding for this workout type.",
		});
	}

	return flags;
}

export function calculateRouteTrainingSuitability(
	route: PlannedRoute,
): RouteTrainingSuitabilityAnalysis | null {
	if (
		route.mode !== "round_course" ||
		route.roundCourseTarget?.kind !== "workout"
	) {
		return null;
	}

	const target = route.roundCourseTarget;
	const profile = target.trainingProfile ?? getFallbackTrainingProfile(target);
	const profileFromTarget = !!target.trainingProfile;
	const sessionKind: WorkoutTrainingSessionKind | "unknown" = profileFromTarget
		? profile.sessionKind
		: "unknown";
	const weights = getWeights(sessionKind, profile);
	const quality = getRouteQuality(route);
	const climbs = analyzeRouteClimbs(
		getRouteElevationAnalysisPoints(route.coordinates),
	);
	const durationMatch = calculateDurationMatch(
		route,
		target,
		weights.durationMatch,
	);
	const distanceMatch = calculateDistanceMatch(
		route,
		target,
		weights.distanceMatch,
	);
	const surfaceFit = subscore(
		weightedAverage([
			{ score: quality.subscores.surface.score, weight: 0.45 },
			{ score: quality.subscores.roadQuality.score, weight: 0.55 },
		]),
		"Surface fit",
		"Combines surface quality and road quality for workout consistency.",
		weights.surfaceFit,
	);
	const highFocus =
		sessionKind === "intervals" ||
		sessionKind === "threshold" ||
		profile.highIntensityShare >= 0.12;
	const flowFit = subscore(
		weightedAverage([
			{ score: quality.subscores.flow.score, weight: highFocus ? 0.6 : 0.4 },
			{
				score: quality.subscores.interruptionRisk.score,
				weight: highFocus ? 0.4 : 0.6,
			},
		]),
		"Flow fit",
		"Combines flow and interruption risk for workout execution.",
		weights.flowFit,
	);
	const safetyFit = subscore(
		weightedAverage([
			{ score: quality.subscores.safety.score, weight: 0.55 },
			{ score: quality.subscores.trafficStress.score, weight: 0.3 },
			{ score: quality.subscores.windExposure.score, weight: 0.15 },
		]),
		"Safety fit",
		"Combines safety, traffic stress, and wind exposure.",
		weights.safetyFit,
	);
	const terrainFit = calculateTerrainFit(
		route,
		sessionKind,
		climbs,
		weights.terrainFit,
	);
	const subscores = {
		durationMatch,
		distanceMatch,
		surfaceFit,
		flowFit,
		safetyFit,
		terrainFit,
	};
	const overallScore = weightedAverage(Object.values(subscores));
	const analysisWithoutFlags = {
		version: 1 as const,
		overallScore,
		band: getQualityBand(overallScore),
		confidence: getConfidence(route, profileFromTarget),
		sessionKind,
		summary: getTrainingSummary(overallScore, sessionKind),
		subscores,
	};

	return {
		...analysisWithoutFlags,
		flags: getFlags(route, target, analysisWithoutFlags),
	};
}

export function getRouteTrainingSuitability(
	route: PlannedRoute,
): RouteTrainingSuitabilityAnalysis | null {
	return calculateRouteTrainingSuitability(route);
}

export function withRouteTrainingSuitability(
	route: PlannedRoute,
): PlannedRoute {
	const trainingSuitability = calculateRouteTrainingSuitability(route);

	if (trainingSuitability) {
		return {
			...route,
			trainingSuitability,
		};
	}

	const {
		trainingSuitability: _staleTrainingSuitability,
		...routeWithoutTrainingSuitability
	} = route;
	return routeWithoutTrainingSuitability;
}
