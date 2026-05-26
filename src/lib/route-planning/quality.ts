import { analyzeRouteClimbs } from "./climbs";
import {
	calculateRouteGradientMetrics,
	getRouteElevationAnalysisPoints,
} from "./elevation";
import { getCoordinateDistanceMeters } from "./geometry";
import { getRouteTurnCount } from "./instructions";
import {
	classifySmoothnessSurfaceFallbackValue,
	classifySurfaceValue,
	normalizeDetailValue,
} from "./surface";
import type {
	PlannedRoute,
	RouteDetailInterval,
	RouteQualityAnalysis,
	RouteQualityBand,
	RouteQualityFlag,
	RouteQualitySubscore,
} from "./types";

const weights = {
	surface: 18,
	trafficStress: 16,
	flow: 12,
	safety: 14,
	roadQuality: 14,
	urbanExposure: 8,
	interruptionRisk: 8,
	windExposure: 4,
	gradientSuitability: 3,
	routeEfficiency: 3,
} as const;

type DetailTotals = {
	total: number;
	values: Map<string, number>;
};

function clampScore(score: number): number {
	return Math.max(0, Math.min(100, Math.round(score)));
}

function share(distance: number, total: number): number {
	return total > 0 ? distance / total : 0;
}

function subscore(
	score: number | null,
	label: string,
	summary: string,
	weight: number,
): RouteQualitySubscore {
	return {
		score,
		label,
		summary,
		available: score !== null,
		weight,
	};
}

function getDetailIntervalDistanceMeters(
	route: PlannedRoute,
	detail: RouteDetailInterval,
): number {
	const from = Math.max(0, Math.trunc(detail.from));
	const to = Math.min(route.coordinates.length - 1, Math.trunc(detail.to));
	let distanceMeters = 0;

	if (to <= from) {
		return 0;
	}

	for (let index = from; index < to; index += 1) {
		const left = route.coordinates[index];
		const right = route.coordinates[index + 1];

		if (!left || !right) continue;

		distanceMeters += getCoordinateDistanceMeters(left, right);
	}

	return distanceMeters;
}

function getDetailTotals(
	route: PlannedRoute,
	details: RouteDetailInterval[],
): DetailTotals {
	const values = new Map<string, number>();
	let total = 0;

	for (const detail of details) {
		const value = normalizeDetailValue(detail.value);

		if (!value || value === "MISSING" || value === "UNKNOWN") {
			continue;
		}

		const distance = getDetailIntervalDistanceMeters(route, detail);

		if (distance <= 0) {
			continue;
		}

		total += distance;
		values.set(value, (values.get(value) ?? 0) + distance);
	}

	return { total, values };
}

function getValuesDistance(
	totals: DetailTotals,
	values: readonly string[],
): number {
	return values.reduce(
		(sum, value) => sum + (totals.values.get(value) ?? 0),
		0,
	);
}

function weightedPenalty(
	totals: DetailTotals,
	penalties: Record<string, number>,
): number | null {
	if (totals.total <= 0) {
		return null;
	}

	let penalty = 0;
	for (const [value, distance] of totals.values) {
		penalty += share(distance, totals.total) * (penalties[value] ?? 0);
	}

	return penalty;
}

function getTurnsPer10Km(route: PlannedRoute): number {
	return route.distanceMeters > 0
		? getRouteTurnCount(route) / (route.distanceMeters / 10000)
		: 0;
}

function getInstructionCounts(route: PlannedRoute) {
	const instructions = route.instructions ?? [];
	return {
		roundabouts: instructions.filter(
			(instruction) =>
				instruction.type === "roundabout" ||
				instruction.type === "leave_roundabout",
		).length,
		uTurns: instructions.filter((instruction) => instruction.type === "u_turn")
			.length,
		sharpTurns: instructions.filter(
			(instruction) =>
				instruction.type === "sharp_left" || instruction.type === "sharp_right",
		).length,
	};
}

function calculateSurfaceScore(route: PlannedRoute): RouteQualitySubscore {
	const totals = { smooth: 0, mixed: 0, coarse: 0 };
	const addDetails = (
		details: RouteDetailInterval[],
		classify: (value: string) => keyof typeof totals | null,
	) => {
		for (const detail of details) {
			const bucket = classify(detail.value);

			if (!bucket) continue;

			totals[bucket] += getDetailIntervalDistanceMeters(route, detail);
		}
	};

	addDetails(route.surfaceDetails, classifySurfaceValue);

	if (totals.smooth + totals.mixed + totals.coarse === 0) {
		addDetails(route.smoothnessDetails, classifySmoothnessSurfaceFallbackValue);
	}

	const total = totals.smooth + totals.mixed + totals.coarse;
	if (total <= 0) {
		return subscore(
			null,
			"Surface quality",
			"Surface details unavailable.",
			weights.surface,
		);
	}

	const mixedShare = share(totals.mixed, total);
	const coarseShare = share(totals.coarse, total);
	const score = clampScore(100 - mixedShare * 45 - coarseShare * 90);
	const coarsePct = Math.round(coarseShare * 100);
	const mixedPct = Math.round(mixedShare * 100);

	return subscore(
		score,
		"Surface quality",
		coarsePct > 0 || mixedPct > 0
			? `${mixedPct}% mixed, ${coarsePct}% coarse.`
			: "Mostly smooth paved surface.",
		weights.surface,
	);
}

const stressPenalties: Record<string, number> = {
	MOTORWAY: 100,
	TRUNK: 100,
	PRIMARY: 80,
	SECONDARY: 55,
	TERTIARY: 35,
	RESIDENTIAL: 18,
	LIVING_STREET: 18,
	SERVICE: 18,
	CYCLEWAY: 0,
	TRACK: 70,
	PATH: 70,
	FOOTWAY: 70,
	STEPS: 70,
};

const accessPenalties: Record<string, number> = {
	PRIVATE: 100,
	NO: 100,
	DESTINATION: 35,
};

function calculateTrafficStressScore(
	route: PlannedRoute,
): RouteQualitySubscore {
	const roadClass = getDetailTotals(route, route.roadClassDetails ?? []);
	const roadAccess = getDetailTotals(route, route.roadAccessDetails ?? []);

	if (roadClass.total <= 0 && roadAccess.total <= 0) {
		return subscore(
			null,
			"Traffic stress",
			"Road class details unavailable.",
			weights.trafficStress,
		);
	}

	const roadClassPenalty = weightedPenalty(roadClass, stressPenalties) ?? 0;
	const accessPenalty = weightedPenalty(roadAccess, accessPenalties) ?? 0;
	const network = getDetailTotals(route, route.bikeNetworkDetails ?? []);
	const networkCoverage =
		route.distanceMeters > 0
			? Math.min(1, network.total / route.distanceMeters)
			: 0;
	const penalty =
		roadClassPenalty * 0.85 + accessPenalty * 0.15 - networkCoverage * 15;
	const score = clampScore(100 - penalty);

	return subscore(
		score,
		"Traffic stress",
		networkCoverage > 0.05
			? `${Math.round(networkCoverage * 100)}% bike-network coverage offsets road stress.`
			: "Based on road class and access exposure.",
		weights.trafficStress,
	);
}

function getUrbanLikeShare(route: PlannedRoute): number {
	const environment = getDetailTotals(
		route,
		route.roadEnvironmentDetails ?? [],
	);
	const roadClass = getDetailTotals(route, route.roadClassDetails ?? []);
	const envShare = share(
		getValuesDistance(environment, ["URBAN"]),
		environment.total,
	);
	const classShare = share(
		getValuesDistance(roadClass, ["RESIDENTIAL", "LIVING_STREET", "SERVICE"]),
		roadClass.total,
	);

	if (environment.total > 0 && roadClass.total > 0) {
		return Math.max(envShare, classShare);
	}

	return Math.max(envShare, classShare);
}

function getInterruptionEnvironmentShare(route: PlannedRoute): number {
	const environment = getDetailTotals(
		route,
		route.roadEnvironmentDetails ?? [],
	);
	return share(
		getValuesDistance(environment, ["FERRY", "TUNNEL"]),
		environment.total,
	);
}

function calculateFlowScore(route: PlannedRoute): RouteQualitySubscore {
	if (
		(route.instructions ?? []).length === 0 &&
		(route.roadClassDetails ?? []).length === 0 &&
		(route.roadEnvironmentDetails ?? []).length === 0
	) {
		return subscore(
			null,
			"Flow / stop-and-go",
			"Instruction and road context unavailable.",
			weights.flow,
		);
	}

	const turnsPer10Km = getTurnsPer10Km(route);
	const counts = getInstructionCounts(route);
	const urbanLikeShare = getUrbanLikeShare(route);
	const interruptionEnvironmentShare = getInterruptionEnvironmentShare(route);
	const score = clampScore(
		100 -
			Math.min(35, turnsPer10Km * 3) -
			counts.roundabouts * 3 -
			counts.uTurns * 10 -
			counts.sharpTurns * 2 -
			urbanLikeShare * 20 -
			interruptionEnvironmentShare * 30,
	);

	return subscore(
		score,
		"Flow / stop-and-go",
		`${turnsPer10Km.toFixed(1)} turns per 10 km.`,
		weights.flow,
	);
}

function calculateWindScore(route: PlannedRoute): RouteQualitySubscore {
	if (!route.windAnalysis) {
		return subscore(
			null,
			"Wind exposure",
			"Wind analysis unavailable.",
			weights.windExposure,
		);
	}

	const wind = route.windAnalysis;
	const headwindShare =
		route.distanceMeters > 0
			? wind.headwindDistanceMeters / route.distanceMeters
			: 0;
	const tailwindBonus = Math.min(6, Math.max(0, wind.averageTailwindKmh) * 0.8);
	const score = clampScore(
		100 -
			Math.max(0, wind.averageHeadwindKmh) * 1.8 -
			wind.maxHeadwindKmh * 1.1 -
			wind.maxCrosswindKmh * 1.4 -
			headwindShare * 18 +
			tailwindBonus,
	);

	return subscore(
		score,
		"Wind exposure",
		`Max headwind ${Math.round(wind.maxHeadwindKmh)} km/h, crosswind ${Math.round(wind.maxCrosswindKmh)} km/h.`,
		weights.windExposure,
	);
}

function calculateGradientScore(route: PlannedRoute): RouteQualitySubscore {
	const metrics = calculateRouteGradientMetrics(route);
	const climbs = analyzeRouteClimbs(
		getRouteElevationAnalysisPoints(route.coordinates),
	);

	if (
		metrics.averageGradientPercent === null &&
		metrics.maximumGradientPercent === null
	) {
		return subscore(
			null,
			"Gradient suitability",
			"Elevation data unavailable.",
			weights.gradientSuitability,
		);
	}

	const maxGrade = metrics.maximumGradientPercent ?? 0;
	const climbDensity =
		route.distanceMeters > 0
			? route.ascendMeters / (route.distanceMeters / 1000)
			: 0;
	const majorClimbPenalty =
		route.distanceMeters < 60000
			? climbs.filter((climb) =>
					["HC", "Cat 1", "Cat 2"].includes(climb.category),
				).length * 8
			: 0;
	const score = clampScore(
		100 -
			Math.max(0, maxGrade - 10) * 5 -
			Math.max(0, climbDensity - 15) * 1.3 -
			majorClimbPenalty,
	);

	return subscore(
		score,
		"Gradient suitability",
		`${Math.round(climbDensity)} m/km climbing density.`,
		weights.gradientSuitability,
	);
}

function calculateRouteEfficiencyScore(
	route: PlannedRoute,
): RouteQualitySubscore {
	if (route.mode === "out_and_back") {
		return subscore(
			route.coordinates.length >= 2 && route.distanceMeters > 0 ? 90 : null,
			"Route efficiency",
			"Out-and-back doubling is intentional.",
			weights.routeEfficiency,
		);
	}

	if (route.mode === "round_course") {
		const target = route.roundCourseTarget;
		if (target?.kind === "distance" && target.distanceMeters > 0) {
			const miss =
				Math.abs(route.distanceMeters - target.distanceMeters) /
				target.distanceMeters;
			return subscore(
				clampScore(100 - Math.min(60, miss * 180)),
				"Route efficiency",
				`${Math.round(miss * 100)}% from requested distance.`,
				weights.routeEfficiency,
			);
		}

		return subscore(
			85,
			"Route efficiency",
			"Loop route efficiency is target-dependent.",
			weights.routeEfficiency,
		);
	}

	const first = route.coordinates[0];
	const last = route.coordinates[route.coordinates.length - 1];
	const straightLineDistance =
		first && last ? getCoordinateDistanceMeters(first, last) : 0;

	if (route.distanceMeters <= 0 || straightLineDistance <= 0) {
		return subscore(
			null,
			"Route efficiency",
			"Direct-distance comparison unavailable.",
			weights.routeEfficiency,
		);
	}

	const ratio = route.distanceMeters / straightLineDistance;
	let score = 100;
	if (ratio > 2) {
		score = 35;
	} else if (ratio > 1.6) {
		score = 70 - ((ratio - 1.6) / 0.4) * 35;
	} else if (ratio > 1.25) {
		score = 100 - ((ratio - 1.25) / 0.35) * 30;
	}

	return subscore(
		clampScore(score),
		"Route efficiency",
		`${ratio.toFixed(1)}x direct distance.`,
		weights.routeEfficiency,
	);
}

function calculateRoadClassSuitability(route: PlannedRoute): number | null {
	const roadClass = getDetailTotals(route, route.roadClassDetails ?? []);
	return weightedPenalty(roadClass, {
		MOTORWAY: 95,
		TRUNK: 90,
		PRIMARY: 55,
		SECONDARY: 8,
		TERTIARY: 5,
		UNCLASSIFIED: 8,
		RESIDENTIAL: 12,
		LIVING_STREET: 18,
		SERVICE: 20,
		CYCLEWAY: 6,
		TRACK: 65,
		PATH: 68,
		FOOTWAY: 85,
		STEPS: 100,
	}) === null
		? null
		: clampScore(
				100 -
					(weightedPenalty(roadClass, {
						MOTORWAY: 95,
						TRUNK: 90,
						PRIMARY: 55,
						SECONDARY: 8,
						TERTIARY: 5,
						UNCLASSIFIED: 8,
						RESIDENTIAL: 12,
						LIVING_STREET: 18,
						SERVICE: 20,
						CYCLEWAY: 6,
						TRACK: 65,
						PATH: 68,
						FOOTWAY: 85,
						STEPS: 100,
					}) ?? 0),
			);
}

function calculateAccessSuitability(route: PlannedRoute): number | null {
	const access = getDetailTotals(route, route.roadAccessDetails ?? []);
	const penalty = weightedPenalty(access, accessPenalties);
	return penalty === null ? null : clampScore(100 - penalty);
}

function calculateRoadQualityScore(
	route: PlannedRoute,
	surfaceScore: RouteQualitySubscore,
): RouteQualitySubscore {
	const roadClassSuitability = calculateRoadClassSuitability(route);
	const accessSuitability = calculateAccessSuitability(route);

	if (
		surfaceScore.score === null &&
		roadClassSuitability === null &&
		accessSuitability === null
	) {
		return subscore(
			null,
			"Road quality",
			"Road quality details unavailable.",
			weights.roadQuality,
		);
	}

	const parts = [
		{ score: surfaceScore.score, weight: 0.55 },
		{ score: roadClassSuitability, weight: 0.25 },
		{ score: accessSuitability, weight: 0.2 },
	].filter(
		(part): part is { score: number; weight: number } => part.score !== null,
	);
	const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
	const score = clampScore(
		parts.reduce((sum, part) => sum + part.score * part.weight, 0) /
			totalWeight,
	);

	return subscore(
		score,
		"Road quality",
		"Combines surface, road class, and access suitability.",
		weights.roadQuality,
	);
}

function calculateUrbanExposureScore(
	route: PlannedRoute,
): RouteQualitySubscore {
	const hasContext =
		(route.roadEnvironmentDetails ?? []).length > 0 ||
		(route.roadClassDetails ?? []).length > 0 ||
		(route.instructions ?? []).length > 0;
	if (!hasContext) {
		return subscore(
			null,
			"Urban exposure",
			"Urban context unavailable.",
			weights.urbanExposure,
		);
	}

	const urbanShare = getUrbanLikeShare(route);
	const turnsPer10Km = getTurnsPer10Km(route);
	const fallbackUrbanShare =
		urbanShare === 0 && turnsPer10Km > 8
			? Math.min(0.6, turnsPer10Km / 30)
			: urbanShare;
	const score = clampScore(
		100 - fallbackUrbanShare * 70 - Math.min(20, turnsPer10Km * 1.5),
	);

	return subscore(
		score,
		"Urban exposure",
		`${Math.round(fallbackUrbanShare * 100)}% urban-like route context.`,
		weights.urbanExposure,
	);
}

function calculateInterruptionRiskScore(
	route: PlannedRoute,
): RouteQualitySubscore {
	const hasContext =
		(route.instructions ?? []).length > 0 ||
		(route.roadEnvironmentDetails ?? []).length > 0 ||
		(route.roadAccessDetails ?? []).length > 0 ||
		(route.roadClassDetails ?? []).length > 0;
	if (!hasContext) {
		return subscore(
			null,
			"Interruption risk",
			"Interruption context unavailable.",
			weights.interruptionRisk,
		);
	}

	const counts = getInstructionCounts(route);
	const turnsPer10Km = getTurnsPer10Km(route);
	const environment = getDetailTotals(
		route,
		route.roadEnvironmentDetails ?? [],
	);
	const access = getDetailTotals(route, route.roadAccessDetails ?? []);
	const roadClass = getDetailTotals(route, route.roadClassDetails ?? []);
	const ferryShare = share(
		getValuesDistance(environment, ["FERRY"]),
		environment.total,
	);
	const tunnelShare = share(
		getValuesDistance(environment, ["TUNNEL"]),
		environment.total,
	);
	const restrictedShare = share(
		getValuesDistance(access, ["PRIVATE", "NO", "DESTINATION"]),
		access.total,
	);
	const unsuitableShare = share(
		getValuesDistance(roadClass, ["STEPS", "FOOTWAY"]),
		roadClass.total,
	);
	const score = clampScore(
		100 -
			Math.min(32, turnsPer10Km * 2.4) -
			counts.roundabouts * 2 -
			counts.uTurns * 9 -
			ferryShare * 60 -
			tunnelShare * 35 -
			restrictedShare * 55 -
			unsuitableShare * 70,
	);

	return subscore(
		score,
		"Interruption risk",
		"Uses turns, ferries, tunnels, restricted access, and unsuitable path classes.",
		weights.interruptionRisk,
	);
}

function calculateSafetyScore(
	route: PlannedRoute,
	trafficStressScore: RouteQualitySubscore,
	windScore: RouteQualitySubscore,
): RouteQualitySubscore {
	const environment = getDetailTotals(
		route,
		route.roadEnvironmentDetails ?? [],
	);
	const roadClass = getDetailTotals(route, route.roadClassDetails ?? []);
	const envPenalty =
		share(getValuesDistance(environment, ["TUNNEL"]), environment.total) * 80 +
		share(getValuesDistance(environment, ["FERRY"]), environment.total) * 40 +
		share(
			getValuesDistance(roadClass, ["MOTORWAY", "TRUNK", "PRIMARY"]),
			roadClass.total,
		) *
			65;
	const roadEnvironmentSafety =
		environment.total > 0 || roadClass.total > 0
			? clampScore(100 - envPenalty)
			: null;
	const windSafety = windScore.score;
	const gradientMetrics = calculateRouteGradientMetrics(route);
	const descentSafety =
		gradientMetrics.maximumGradientPercent === null
			? null
			: clampScore(
					100 - Math.max(0, gradientMetrics.maximumGradientPercent - 10) * 4,
				);
	const parts = [
		{ score: trafficStressScore.score, weight: 0.55 },
		{ score: roadEnvironmentSafety, weight: 0.2 },
		{ score: windSafety, weight: 0.15 },
		{ score: descentSafety, weight: 0.1 },
	].filter(
		(part): part is { score: number; weight: number } => part.score !== null,
	);

	if (parts.length === 0) {
		return subscore(
			null,
			"Safety",
			"Safety context unavailable.",
			weights.safety,
		);
	}

	const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
	const score = clampScore(
		parts.reduce((sum, part) => sum + part.score * part.weight, 0) /
			totalWeight,
	);

	return subscore(
		score,
		"Safety",
		"Combines traffic stress, environment, wind, and steep exposure.",
		weights.safety,
	);
}

export function getQualityBand(
	score: number | null,
): RouteQualityBand | "unknown" {
	if (score === null) return "unknown";
	if (score >= 85) return "excellent";
	if (score >= 70) return "good";
	if (score >= 50) return "mixed";
	return "poor";
}

function getConfidence(
	route: PlannedRoute,
): RouteQualityAnalysis["confidence"] {
	const hasSurface =
		route.surfaceDetails.length > 0 || route.smoothnessDetails.length > 0;
	const hasRoadClass = (route.roadClassDetails ?? []).length > 0;
	const hasRoadEnvironment = (route.roadEnvironmentDetails ?? []).length > 0;
	const hasWind = !!route.windAnalysis;

	if (hasSurface && hasRoadClass && hasRoadEnvironment && hasWind) {
		return "high";
	}

	if (hasSurface || hasRoadClass) {
		return "medium";
	}

	return "low";
}

function getFlags(
	analysis: Omit<RouteQualityAnalysis, "flags">,
): RouteQualityFlag[] {
	const flags: RouteQualityFlag[] = [];
	const { overallScore, subscores } = analysis;

	if (overallScore !== null && overallScore < 55) {
		flags.push({
			code: "low_route_quality",
			severity: overallScore < 40 ? "warning" : "caution",
			label: "Low route quality",
			summary: "Overall road-training quality is below target.",
		});
	}
	if ((subscores.trafficStress.score ?? 100) < 50) {
		flags.push({
			code: "high_traffic_stress",
			severity:
				(subscores.trafficStress.score ?? 100) < 35 ? "warning" : "caution",
			label: "High traffic stress",
			summary: "Road class and access mix suggest stressful riding.",
		});
	}
	if ((subscores.interruptionRisk.score ?? 100) < 55) {
		flags.push({
			code: "high_interruption_risk",
			severity: "caution",
			label: "High interruption risk",
			summary:
				"Turns, restricted access, or route environments may interrupt flow.",
		});
	}
	if ((subscores.urbanExposure.score ?? 100) < 45) {
		flags.push({
			code: "high_urban_exposure",
			severity: "caution",
			label: "High urban exposure",
			summary: "Urban-like riding makes up a large share of the route.",
		});
	}

	return flags;
}

export function calculateRouteQuality(
	route: PlannedRoute,
): RouteQualityAnalysis {
	const surface = calculateSurfaceScore(route);
	const trafficStress = calculateTrafficStressScore(route);
	const flow = calculateFlowScore(route);
	const windExposure = calculateWindScore(route);
	const gradientSuitability = calculateGradientScore(route);
	const routeEfficiency = calculateRouteEfficiencyScore(route);
	const safety = calculateSafetyScore(route, trafficStress, windExposure);
	const roadQuality = calculateRoadQualityScore(route, surface);
	const urbanExposure = calculateUrbanExposureScore(route);
	const interruptionRisk = calculateInterruptionRiskScore(route);
	const subscores = {
		surface,
		trafficStress,
		flow,
		safety,
		roadQuality,
		urbanExposure,
		interruptionRisk,
		windExposure,
		gradientSuitability,
		routeEfficiency,
	};
	const available = Object.values(subscores).filter(
		(score) => score.score !== null,
	);
	const totalWeight = available.reduce((sum, score) => sum + score.weight, 0);
	const overallScore =
		totalWeight > 0
			? clampScore(
					available.reduce(
						(sum, score) => sum + (score.score ?? 0) * score.weight,
						0,
					) / totalWeight,
				)
			: null;
	const analysisWithoutFlags = {
		version: 1 as const,
		overallScore,
		band: getQualityBand(overallScore),
		confidence: getConfidence(route),
		subscores,
	};

	return {
		...analysisWithoutFlags,
		flags: getFlags(analysisWithoutFlags),
	};
}

export function getRouteQuality(route: PlannedRoute): RouteQualityAnalysis {
	return route.routeQuality ?? calculateRouteQuality(route);
}

export function withRouteQuality(route: PlannedRoute): PlannedRoute {
	return {
		...route,
		routeQuality: calculateRouteQuality(route),
	};
}
