import type {
	ClimbAnalysisPoint,
	ElevationProfilePoint,
	PlannedRoute,
	RouteCoordinate,
	RouteGradientBucket,
	RouteGradientMetrics,
	RouteGradientSection,
} from "./types";
import { getCoordinateDistanceMeters } from "./geometry";

export function sampleElevationProfile(
	coordinates: RouteCoordinate[],
	targetSamples = 40,
): ElevationProfilePoint[] {
	if (coordinates.length === 0) {
		return [];
	}

	let totalDistanceMeters = 0;
	let previousCoordinate = coordinates[0];
	const profilePoints: ElevationProfilePoint[] = [];

	for (const [index, coordinate] of coordinates.entries()) {
		if (index > 0 && previousCoordinate) {
			totalDistanceMeters += getCoordinateDistanceMeters(
				previousCoordinate,
				coordinate,
			);
		}

		previousCoordinate = coordinate;

		const elevationMeters = coordinate[2];

		if (elevationMeters === undefined || !Number.isFinite(elevationMeters)) {
			continue;
		}

		profilePoints.push({
			distanceMeters: totalDistanceMeters,
			elevationMeters,
			coordinate,
		});
	}

	if (profilePoints.length === 0) {
		return [];
	}

	const lastProfilePoint = profilePoints[profilePoints.length - 1];

	if (!lastProfilePoint) {
		return [];
	}

	const sampleCount = Math.max(targetSamples, 1);

	if (profilePoints.length <= sampleCount) {
		return profilePoints;
	}

	if (sampleCount === 1) {
		return [profilePoints[0] ?? lastProfilePoint];
	}

	const lastIndex = profilePoints.length - 1;
	const step = lastIndex / (sampleCount - 1);

	return Array.from({ length: sampleCount }, (_, index) => {
		const sampleIndex = Math.min(lastIndex, Math.round(index * step));
		return profilePoints[sampleIndex] ?? lastProfilePoint;
	});
}

export function getRouteElevationAnalysisPoints(
	coordinates: RouteCoordinate[],
): ClimbAnalysisPoint[] {
	let totalDistanceMeters = 0;
	let previousCoordinate = coordinates[0];
	const points: ClimbAnalysisPoint[] = [];

	for (const [index, coordinate] of coordinates.entries()) {
		if (index > 0 && previousCoordinate) {
			totalDistanceMeters += getCoordinateDistanceMeters(
				previousCoordinate,
				coordinate,
			);
		}

		previousCoordinate = coordinate;

		const elevationMeters = coordinate[2];

		if (elevationMeters === undefined || !Number.isFinite(elevationMeters)) {
			continue;
		}

		points.push({
			distanceMeters: totalDistanceMeters,
			elevationMeters,
			coordinate,
			rawRouteIndex: index,
		});
	}

	return points;
}

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

const gradientAnalysisMinWindowMeters = 100;

function classifyGradientBucket(
	gradientPercent: number,
): RouteGradientBucket | null {
	if (!Number.isFinite(gradientPercent)) {
		return null;
	}
	if (gradientPercent <= -6) return "steep_down";
	if (gradientPercent <= -3) return "down";
	if (gradientPercent < -1) return "mild_down";
	if (gradientPercent <= 1) return "flat";
	if (gradientPercent < 3) return "mild_up";
	if (gradientPercent < 6) return "up";
	return "steep_up";
}

export function smoothClimbPoints(
	points: ClimbAnalysisPoint[],
): ClimbAnalysisPoint[] {
	const radius = Math.floor(climbDetectionThresholds.smoothingWindow / 2);

	return points.map((point, index) => {
		if (index === 0 || index === points.length - 1) {
			return point;
		}

		let elevationTotal = 0;
		let sampleCount = 0;

		for (
			let sampleIndex = Math.max(0, index - radius);
			sampleIndex <= Math.min(points.length - 1, index + radius);
			sampleIndex += 1
		) {
			const sample = points[sampleIndex];

			if (!sample || !Number.isFinite(sample.elevationMeters)) {
				continue;
			}

			elevationTotal += sample.elevationMeters;
			sampleCount += 1;
		}

		return {
			...point,
			elevationMeters:
				sampleCount > 0 ? elevationTotal / sampleCount : point.elevationMeters,
		};
	});
}

export function calculateRouteGradientMetrics(
	route: PlannedRoute,
): RouteGradientMetrics {
	const averageGradientPercent =
		Number.isFinite(route.distanceMeters) && route.distanceMeters > 0
			? (Math.max(0, route.ascendMeters) / route.distanceMeters) * 100
			: null;

	const validPoints = getRouteElevationAnalysisPoints(route.coordinates)
		.filter(
			(point) =>
				Number.isFinite(point.distanceMeters) &&
				Number.isFinite(point.elevationMeters),
		)
		.sort((a, b) => a.distanceMeters - b.distanceMeters);

	if (validPoints.length < 2) {
		return {
			averageGradientPercent,
			maximumGradientPercent: null,
		};
	}

	const smoothedPoints = smoothClimbPoints(validPoints);
	let maximumGradientPercent: number | null = null;
	let endIndex = 1;

	for (
		let startIndex = 0;
		startIndex < smoothedPoints.length - 1;
		startIndex += 1
	) {
		const start = smoothedPoints[startIndex];

		if (!start) continue;

		if (endIndex <= startIndex) {
			endIndex = startIndex + 1;
		}

		while (endIndex < smoothedPoints.length) {
			const end = smoothedPoints[endIndex];

			if (!end) break;

			const distanceMeters = end.distanceMeters - start.distanceMeters;

			if (distanceMeters >= gradientAnalysisMinWindowMeters) {
				break;
			}

			endIndex += 1;
		}

		const end = smoothedPoints[endIndex];

		if (!end) {
			break;
		}

		const distanceMeters = end.distanceMeters - start.distanceMeters;
		const elevationGainMeters = end.elevationMeters - start.elevationMeters;

		if (
			distanceMeters >= gradientAnalysisMinWindowMeters &&
			elevationGainMeters > 0
		) {
			const gradientPercent = (elevationGainMeters / distanceMeters) * 100;
			maximumGradientPercent =
				maximumGradientPercent === null
					? gradientPercent
					: Math.max(maximumGradientPercent, gradientPercent);
		}
	}

	return {
		averageGradientPercent,
		maximumGradientPercent,
	};
}

export function getRouteGradientSections(
	route: PlannedRoute,
): RouteGradientSection[] {
	const points = smoothClimbPoints(
		getRouteElevationAnalysisPoints(route.coordinates).filter(
			(point) =>
				!!point.coordinate &&
				Number.isFinite(point.distanceMeters) &&
				Number.isFinite(point.elevationMeters),
		),
	);
	const sections: RouteGradientSection[] = [];

	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const current = points[index];

		if (!previous?.coordinate || !current?.coordinate) {
			continue;
		}

		const distanceMeters = current.distanceMeters - previous.distanceMeters;
		const elevationDeltaMeters =
			current.elevationMeters - previous.elevationMeters;

		if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
			continue;
		}

		const averageGradePercent = (elevationDeltaMeters / distanceMeters) * 100;
		const bucket = classifyGradientBucket(averageGradePercent);

		if (!bucket) {
			continue;
		}

		const previousSection = sections[sections.length - 1];

		if (previousSection?.bucket === bucket) {
			previousSection.endDistanceMeters = current.distanceMeters;
			previousSection.distanceMeters += distanceMeters;
			previousSection.elevationDeltaMeters += elevationDeltaMeters;
			previousSection.averageGradePercent =
				(previousSection.elevationDeltaMeters /
					previousSection.distanceMeters) *
				100;
			previousSection.coordinates.push(current.coordinate);
			continue;
		}

		sections.push({
			bucket,
			startDistanceMeters: previous.distanceMeters,
			endDistanceMeters: current.distanceMeters,
			distanceMeters,
			elevationDeltaMeters,
			averageGradePercent,
			coordinates: [previous.coordinate, current.coordinate],
		});
	}

	return sections;
}
