import { Effect, Result } from "effect";

import type {
	PlannedRoute,
	RouteCoordinate,
	RouteWindAnalysis,
	RouteWindSample,
	RouteWindSegment,
} from "$lib/route-planning";
import {
	calculateBearingDegrees,
	calculateWindComponents,
} from "$lib/route-planning";
import {
	fetchCachedOpenMeteoBatchWindEffect,
	OpenMeteoWindForecastCacheLive,
} from "$lib/server/open-meteo";
import type { TimeoutFetch } from "$lib/server/resilience";

import { finalizeGeneratedRouteWarnings, withWindWarning } from "./warnings";
import {
	getDistanceMeters,
	interpolateCoordinate,
	toCoordinatePair,
} from "./geometry";

type RouteWindSamplePlan = {
	route: PlannedRoute;
	sampleCoordinates: [number, number][];
	startIndex: number;
	count: number;
};

function getRouteDistanceSamples(route: PlannedRoute): [number, number][] {
	const coordinates = route.coordinates;

	if (coordinates.length === 0) {
		return [];
	}

	if (coordinates.length === 1 || route.distanceMeters <= 0) {
		return [toCoordinatePair(coordinates[0] as RouteCoordinate)];
	}

	const segmentDistances = coordinates
		.slice(0, -1)
		.map((coordinate, index) =>
			getDistanceMeters(
				toCoordinatePair(coordinate),
				toCoordinatePair(coordinates[index + 1] as RouteCoordinate),
			),
		);
	const totalDistance = segmentDistances.reduce(
		(sum, distance) => sum + distance,
		0,
	);
	const sampleDistances =
		totalDistance > 0
			? [0, 0.25, 0.5, 0.75, 1].map((ratio) => totalDistance * ratio)
			: [0];

	return sampleDistances.map((targetDistance) => {
		let walkedDistance = 0;

		for (let index = 0; index < segmentDistances.length; index += 1) {
			const segmentDistance = segmentDistances[index] ?? 0;
			const from = coordinates[index];
			const to = coordinates[index + 1];

			if (!from || !to) {
				continue;
			}

			if (
				targetDistance <= walkedDistance + segmentDistance ||
				index === segmentDistances.length - 1
			) {
				const ratio =
					segmentDistance > 0
						? (targetDistance - walkedDistance) / segmentDistance
						: 0;
				return interpolateCoordinate(from, to, Math.min(1, Math.max(0, ratio)));
			}

			walkedDistance += segmentDistance;
		}

		return toCoordinatePair(
			coordinates[coordinates.length - 1] as RouteCoordinate,
		);
	});
}

function getNearestWindSample(
	coordinate: [number, number],
	samples: RouteWindSample[],
): RouteWindSample | null {
	let nearestSample: RouteWindSample | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;

	for (const sample of samples) {
		const distance = getDistanceMeters(coordinate, sample.coordinate);

		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearestSample = sample;
		}
	}

	return nearestSample;
}

function buildWindAnalysis(
	route: PlannedRoute,
	samples: RouteWindSample[],
	fetchedAt: string,
): RouteWindAnalysis | null {
	if (samples.length === 0 || route.coordinates.length < 2) {
		return null;
	}

	const segments: RouteWindSegment[] = [];
	let weightedHeadwindTotal = 0;
	let totalDistance = 0;
	let maxHeadwindKmh = 0;
	let maxCrosswindKmh = 0;
	let headwindDistanceMeters = 0;
	let tailwindDistanceMeters = 0;
	let crosswindDistanceMeters = 0;

	for (let index = 0; index < route.coordinates.length - 1; index += 1) {
		const from = route.coordinates[index];
		const to = route.coordinates[index + 1];

		if (!from || !to) {
			continue;
		}

		const fromPoint = toCoordinatePair(from);
		const toPoint = toCoordinatePair(to);
		const distanceMeters = getDistanceMeters(fromPoint, toPoint);

		if (distanceMeters <= 0) {
			continue;
		}

		const midpoint = interpolateCoordinate(from, to, 0.5);
		const sample = getNearestWindSample(midpoint, samples);

		if (!sample) {
			continue;
		}

		const routeBearingDegrees = calculateBearingDegrees(from, to);
		const components = calculateWindComponents({
			speedKmh: sample.speedKmh,
			windDirectionDegrees: sample.directionDegrees,
			routeBearingDegrees,
		});

		segments.push({
			from: index,
			to: index + 1,
			speedKmh: sample.speedKmh,
			directionDegrees: sample.directionDegrees,
			routeBearingDegrees,
			relativeAngleDegrees: components.relativeAngleDegrees,
			headwindComponentKmh: components.headwindComponentKmh,
			crosswindComponentKmh: components.crosswindComponentKmh,
			bucket: components.bucket,
		});

		weightedHeadwindTotal += components.headwindComponentKmh * distanceMeters;
		totalDistance += distanceMeters;
		maxHeadwindKmh = Math.max(maxHeadwindKmh, components.headwindComponentKmh);
		maxCrosswindKmh = Math.max(
			maxCrosswindKmh,
			Math.abs(components.crosswindComponentKmh),
		);

		if (
			components.bucket === "headwind" ||
			components.bucket === "cross_headwind"
		) {
			headwindDistanceMeters += distanceMeters;
		} else if (
			components.bucket === "tailwind" ||
			components.bucket === "cross_tailwind"
		) {
			tailwindDistanceMeters += distanceMeters;
		} else {
			crosswindDistanceMeters += distanceMeters;
		}
	}

	if (segments.length === 0 || totalDistance <= 0) {
		return null;
	}

	const averageHeadwindKmh = weightedHeadwindTotal / totalDistance;

	return {
		source: "open_meteo",
		fetchedAt,
		forecastTime: samples[0]?.time ?? fetchedAt,
		samples,
		segments,
		averageHeadwindKmh,
		maxHeadwindKmh,
		averageTailwindKmh: Math.max(0, -averageHeadwindKmh),
		maxCrosswindKmh,
		headwindDistanceMeters,
		tailwindDistanceMeters,
		crosswindDistanceMeters,
	};
}

export function attachWindAnalysisEffect(
	routes: PlannedRoute[],
): Effect.Effect<PlannedRoute[], never, TimeoutFetch> {
	return Effect.gen(function* () {
		const fetchedAt = new Date().toISOString();
		let nextStartIndex = 0;

		const samplePlans = routes.map((route): RouteWindSamplePlan => {
			const sampleCoordinates = getRouteDistanceSamples(route);
			const plan = {
				route,
				sampleCoordinates,
				startIndex: nextStartIndex,
				count: sampleCoordinates.length,
			};

			nextStartIndex += sampleCoordinates.length;
			return plan;
		});

		const allSampleCoordinates = samplePlans.flatMap(
			(plan) => plan.sampleCoordinates,
		);

		if (allSampleCoordinates.length === 0) {
			return samplePlans.map(({ route }) =>
				finalizeGeneratedRouteWarnings(route),
			);
		}

		const result = yield* Effect.result(
			fetchCachedOpenMeteoBatchWindEffect(allSampleCoordinates),
		);

		if (Result.isFailure(result)) {
			return samplePlans.map(({ route, count }) =>
				finalizeGeneratedRouteWarnings(
					count > 0 ? withWindWarning(route) : route,
				),
			);
		}

		return samplePlans.map((plan) => {
			const forecasts = result.success.slice(
				plan.startIndex,
				plan.startIndex + plan.count,
			);
			const samples = forecasts.map(
				(forecast, index): RouteWindSample => ({
					coordinate: plan.sampleCoordinates[index] as [number, number],
					speedKmh: forecast.speedKmh,
					directionDegrees: forecast.directionDegrees,
					time: forecast.forecastTime,
					source: "open_meteo",
				}),
			);
			const windAnalysis = buildWindAnalysis(plan.route, samples, fetchedAt);

			return finalizeGeneratedRouteWarnings(
				windAnalysis ? { ...plan.route, windAnalysis } : plan.route,
			);
		});
	}).pipe(Effect.provide(OpenMeteoWindForecastCacheLive));
}
