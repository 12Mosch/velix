import type {
	PlannedRoute,
	RouteWindSummary,
	WindDirectionBucket,
} from "./types";
import { getSignedRelativeAngleDegrees, toRadians } from "./geometry";

export function classifyWindBucket(
	relativeAngleDegrees: number,
): WindDirectionBucket {
	const absoluteAngle = Math.abs(
		getSignedRelativeAngleDegrees(relativeAngleDegrees, 0),
	);

	if (absoluteAngle <= 30) return "headwind";
	if (absoluteAngle < 75) return "cross_headwind";
	if (absoluteAngle <= 105) return "crosswind";
	if (absoluteAngle < 150) return "cross_tailwind";
	return "tailwind";
}

export function calculateWindComponents(options: {
	speedKmh: number;
	windDirectionDegrees: number;
	routeBearingDegrees: number;
}): {
	relativeAngleDegrees: number;
	headwindComponentKmh: number;
	crosswindComponentKmh: number;
	bucket: WindDirectionBucket;
} {
	const relativeAngleDegrees = getSignedRelativeAngleDegrees(
		options.windDirectionDegrees,
		options.routeBearingDegrees,
	);
	const relativeRadians = toRadians(relativeAngleDegrees);
	const headwindComponentKmh = options.speedKmh * Math.cos(relativeRadians);
	const crosswindComponentKmh = options.speedKmh * Math.sin(relativeRadians);

	return {
		relativeAngleDegrees,
		headwindComponentKmh,
		crosswindComponentKmh,
		bucket: classifyWindBucket(relativeAngleDegrees),
	};
}

export function getWindSummary(route: PlannedRoute): RouteWindSummary | null {
	if (!route.windAnalysis) {
		return null;
	}

	return {
		forecastTime: route.windAnalysis.forecastTime,
		averageHeadwindKmh: route.windAnalysis.averageHeadwindKmh,
		averageTailwindKmh: route.windAnalysis.averageTailwindKmh,
		maxHeadwindKmh: route.windAnalysis.maxHeadwindKmh,
		maxCrosswindKmh: route.windAnalysis.maxCrosswindKmh,
		headwindDistanceMeters: route.windAnalysis.headwindDistanceMeters,
		tailwindDistanceMeters: route.windAnalysis.tailwindDistanceMeters,
		crosswindDistanceMeters: route.windAnalysis.crosswindDistanceMeters,
	};
}
