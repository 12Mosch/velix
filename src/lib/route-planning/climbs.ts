import type { ClimbAnalysisPoint, ClimbCategory, RouteClimb } from "./types";
import { smoothClimbPoints } from "./elevation";

const climbDetectionThresholds = {
	minDistanceMeters: 500,
	minGainMeters: 30,
	minAverageGradePercent: 3,
	allowedDescentDistanceMeters: 150,
	allowedElevationLossMeters: 10,
	mergeGapMeters: 300,
	smoothingWindow: 3,
	keyClimbCount: 3,
} as const;

export function classifyClimbCategory(
	score: number,
	elevationGainMeters: number,
): ClimbCategory {
	if (score >= 8000 && elevationGainMeters >= 500) return "HC";
	if (score >= 4800 && elevationGainMeters >= 300) return "Cat 1";
	if (score >= 3200 && elevationGainMeters >= 200) return "Cat 2";
	if (score >= 1600 && elevationGainMeters >= 100) return "Cat 3";
	if (score >= 800 && elevationGainMeters >= 50) return "Cat 4";

	return "Uncategorized";
}

function buildClimb(
	points: ClimbAnalysisPoint[],
	startIndex: number,
	endIndex: number,
): RouteClimb | null {
	const start = points[startIndex];
	const end = points[endIndex];

	if (!start || !end || endIndex <= startIndex) {
		return null;
	}

	const distanceMeters = end.distanceMeters - start.distanceMeters;
	const elevationGainMeters = end.elevationMeters - start.elevationMeters;
	const averageGradePercent =
		distanceMeters > 0 ? (elevationGainMeters / distanceMeters) * 100 : 0;

	if (
		distanceMeters < climbDetectionThresholds.minDistanceMeters ||
		elevationGainMeters < climbDetectionThresholds.minGainMeters ||
		averageGradePercent < climbDetectionThresholds.minAverageGradePercent
	) {
		return null;
	}

	let maxGradePercent = 0;

	for (let index = startIndex; index < endIndex; index += 1) {
		const from = points[index];
		const to = points[index + 1];

		if (!from || !to) continue;

		const segmentDistanceMeters = to.distanceMeters - from.distanceMeters;
		const segmentGainMeters = to.elevationMeters - from.elevationMeters;

		if (segmentDistanceMeters <= 0 || segmentGainMeters <= 0) continue;

		maxGradePercent = Math.max(
			maxGradePercent,
			(segmentGainMeters / segmentDistanceMeters) * 100,
		);
	}

	const score = elevationGainMeters * averageGradePercent;

	return {
		startIndex,
		endIndex,
		rawStartIndex: start.rawRouteIndex ?? startIndex,
		rawEndIndex: end.rawRouteIndex ?? endIndex,
		startDistanceMeters: start.distanceMeters,
		endDistanceMeters: end.distanceMeters,
		distanceMeters,
		elevationGainMeters,
		averageGradePercent,
		maxGradePercent,
		score,
		category: classifyClimbCategory(score, elevationGainMeters),
		isKeyClimb: false,
	};
}

function mergeAdjacentClimbs(
	points: ClimbAnalysisPoint[],
	climbs: RouteClimb[],
): RouteClimb[] {
	const merged: RouteClimb[] = [];

	for (const climb of climbs) {
		const previous = merged[merged.length - 1];

		if (!previous) {
			merged.push(climb);
			continue;
		}

		const gapMeters = climb.startDistanceMeters - previous.endDistanceMeters;
		const combined = buildClimb(points, previous.startIndex, climb.endIndex);

		if (
			gapMeters < climbDetectionThresholds.mergeGapMeters &&
			combined &&
			combined.elevationGainMeters > 0
		) {
			merged[merged.length - 1] = combined;
			continue;
		}

		merged.push(climb);
	}

	return merged;
}

function markKeyClimbs(climbs: RouteClimb[]): RouteClimb[] {
	const categoryRankByCategory: Record<ClimbCategory, number> = {
		HC: 5,
		"Cat 1": 4,
		"Cat 2": 3,
		"Cat 3": 2,
		"Cat 4": 1,
		Uncategorized: 0,
	};
	const categoryRank = (climb: RouteClimb) =>
		categoryRankByCategory[climb.category] ?? 0;
	const keyClimbIndexes = new Set(
		climbs
			.map((climb, index) => ({ climb, index }))
			.sort((a, b) => {
				const categoryDelta = categoryRank(b.climb) - categoryRank(a.climb);
				return categoryDelta || b.climb.score - a.climb.score;
			})
			.slice(0, climbDetectionThresholds.keyClimbCount)
			.map(({ index }) => index),
	);

	return climbs.map((climb, index) => ({
		...climb,
		isKeyClimb: keyClimbIndexes.has(index),
	}));
}

export function analyzeRouteClimbs(points: ClimbAnalysisPoint[]): RouteClimb[] {
	const validPoints = points
		.filter(
			(point) =>
				Number.isFinite(point.distanceMeters) &&
				Number.isFinite(point.elevationMeters),
		)
		.sort((a, b) => a.distanceMeters - b.distanceMeters);

	if (validPoints.length < 2) {
		return [];
	}

	const smoothedPoints = smoothClimbPoints(validPoints);
	const climbs: RouteClimb[] = [];
	let startIndex: number | null = null;
	let interruptionStartIndex: number | null = null;
	let interruptionStartDistance = 0;
	let interruptionStartElevation = 0;

	for (let index = 1; index < smoothedPoints.length; index += 1) {
		const previous = smoothedPoints[index - 1];
		const current = smoothedPoints[index];

		if (!previous || !current) continue;

		const elevationDelta = current.elevationMeters - previous.elevationMeters;

		if (elevationDelta > 0) {
			startIndex ??= index - 1;
			interruptionStartIndex = null;
			continue;
		}

		if (startIndex === null) {
			continue;
		}

		interruptionStartIndex ??= index - 1;
		const interruptionStart = smoothedPoints[interruptionStartIndex];

		if (!interruptionStart) continue;

		interruptionStartDistance = interruptionStart.distanceMeters;
		interruptionStartElevation = interruptionStart.elevationMeters;
		const interruptionDistance =
			current.distanceMeters - interruptionStartDistance;
		const interruptionLoss =
			interruptionStartElevation - current.elevationMeters;

		if (
			interruptionDistance <=
				climbDetectionThresholds.allowedDescentDistanceMeters &&
			interruptionLoss <= climbDetectionThresholds.allowedElevationLossMeters
		) {
			continue;
		}

		const candidate = buildClimb(
			smoothedPoints,
			startIndex,
			Math.max(startIndex, interruptionStartIndex),
		);

		if (candidate) climbs.push(candidate);

		startIndex = null;
		interruptionStartIndex = null;
	}

	if (startIndex !== null) {
		const candidate = buildClimb(
			smoothedPoints,
			startIndex,
			smoothedPoints.length - 1,
		);

		if (candidate) climbs.push(candidate);
	}

	return markKeyClimbs(mergeAdjacentClimbs(smoothedPoints, climbs));
}
