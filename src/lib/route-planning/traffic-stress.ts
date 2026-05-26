import { Schema } from "effect";

import { getCoordinateDistanceMeters } from "./geometry";
import { normalizeDetailValue } from "./surface";
import type { PlannedRoute, RouteDetailInterval } from "./types";

export const TrafficStressBucketSchema = Schema.Literals([
	"low",
	"moderate",
	"elevated",
	"high",
]);

export type RouteTrafficStressBucket = Schema.Schema.Type<
	typeof TrafficStressBucketSchema
>;

export const trafficStressRoadClassPenalties: Record<string, number> = {
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

export const trafficStressAccessPenalties: Record<string, number> = {
	PRIVATE: 100,
	NO: 100,
	DESTINATION: 35,
};

const missingDetailValues = new Set(["", "MISSING", "UNKNOWN"]);
const noBikeNetworkValues = new Set(["NO", "NONE"]);

function getNormalizedDetailValue(
	details: RouteDetailInterval[] | undefined,
	segmentIndex: number,
	coordinateCount: number,
): string | null {
	for (const detail of details ?? []) {
		const from = Math.trunc(detail.from);
		const to = Math.trunc(detail.to);

		if (
			from !== detail.from ||
			to !== detail.to ||
			from < 0 ||
			to <= from ||
			to >= coordinateCount
		) {
			continue;
		}

		if (from <= segmentIndex && to > segmentIndex) {
			const value = normalizeDetailValue(detail.value);

			if (missingDetailValues.has(value)) {
				continue;
			}

			return value;
		}
	}

	return null;
}

function hasBikeNetworkCoverage(
	details: RouteDetailInterval[] | undefined,
	segmentIndex: number,
	coordinateCount: number,
): boolean {
	const value = getNormalizedDetailValue(
		details,
		segmentIndex,
		coordinateCount,
	);

	return value !== null && !noBikeNetworkValues.has(value);
}

function clampScore(score: number): number {
	return Math.max(0, Math.min(100, Math.round(score)));
}

export function classifyTrafficStressBucket(
	score: number,
): RouteTrafficStressBucket {
	if (score >= 80) return "low";
	if (score >= 60) return "moderate";
	if (score >= 40) return "elevated";
	return "high";
}

export type RouteTrafficStressSegment = {
	index: number;
	score: number;
	bucket: RouteTrafficStressBucket;
};

export function getRouteTrafficStressSegments(
	route: PlannedRoute,
): RouteTrafficStressSegment[] {
	const segments: RouteTrafficStressSegment[] = [];
	const segmentCount = Math.max(0, route.coordinates.length - 1);

	for (let index = 0; index < segmentCount; index += 1) {
		const left = route.coordinates[index];
		const right = route.coordinates[index + 1];

		if (!left || !right) {
			continue;
		}

		const distanceMeters = getCoordinateDistanceMeters(left, right);

		if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
			continue;
		}

		const roadClass = getNormalizedDetailValue(
			route.roadClassDetails,
			index,
			route.coordinates.length,
		);
		const access = getNormalizedDetailValue(
			route.roadAccessDetails,
			index,
			route.coordinates.length,
		);

		if (!roadClass && !access) {
			continue;
		}

		const roadClassPenalty = roadClass
			? trafficStressRoadClassPenalties[roadClass]
			: undefined;
		const accessPenalty = access
			? trafficStressAccessPenalties[access]
			: undefined;
		const bikeNetworkCoverageBonus = hasBikeNetworkCoverage(
			route.bikeNetworkDetails,
			index,
			route.coordinates.length,
		)
			? 15
			: 0;
		const hasRoadClassPenalty =
			typeof roadClassPenalty === "number" && Number.isFinite(roadClassPenalty);
		const hasAccessPenalty =
			typeof accessPenalty === "number" && Number.isFinite(accessPenalty);
		const weightSum =
			(hasRoadClassPenalty ? 0.85 : 0) + (hasAccessPenalty ? 0.15 : 0);
		const effectiveRoadWeight =
			weightSum === 0 ? 0.85 : (hasRoadClassPenalty ? 0.85 : 0) / weightSum;
		const effectiveAccessWeight =
			weightSum === 0 ? 0.15 : (hasAccessPenalty ? 0.15 : 0) / weightSum;
		const penalty =
			(hasRoadClassPenalty ? roadClassPenalty : 0) * effectiveRoadWeight +
			(hasAccessPenalty ? accessPenalty : 0) * effectiveAccessWeight -
			bikeNetworkCoverageBonus;
		const score = clampScore(100 - penalty);

		segments.push({
			index,
			score,
			bucket: classifyTrafficStressBucket(score),
		});
	}

	return segments;
}

export function routeHasTrafficStressOverlayFeatures(
	route: PlannedRoute,
): boolean {
	return getRouteTrafficStressSegments(route).length > 0;
}
