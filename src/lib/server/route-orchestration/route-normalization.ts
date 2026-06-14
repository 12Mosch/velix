import type {
	ManualRouteEditingState,
	PlannedRoute,
	RouteCoordinate,
	RouteDetailInterval,
	RouteWaypoint,
} from "$lib/route-planning";
import type { GraphHopperRouteBoundaryError } from "$lib/server/graphhopper-errors";
import {
	isGraphHopperRoutePointLimitError,
	isMissingGraphHopperApiKeyError,
} from "$lib/server/graphhopper-errors";
import {
	GraphHopperRouteRateLimitExceededError,
	GraphHopperRouteRateLimitUnavailableError,
} from "$lib/server/route-rate-limits";

import { RouteGenerationError } from "./errors";
import type { CandidateRouteResult } from "./types";

export function applyManualEditing(
	route: PlannedRoute,
	manualEditing: ManualRouteEditingState | undefined,
): PlannedRoute {
	return manualEditing
		? {
				...route,
				manualEditing,
			}
		: route;
}

function buildRouteUniquenessKey(route: PlannedRoute): string {
	const sampleCount = Math.min(route.coordinates.length, 12);
	const sampledCoordinates =
		sampleCount === 0
			? []
			: Array.from({ length: sampleCount }, (_, index) => {
					const coordinateIndex =
						sampleCount === 1
							? 0
							: Math.round(
									(index * (route.coordinates.length - 1)) / (sampleCount - 1),
								);
					const coordinate = route.coordinates[coordinateIndex];

					return coordinate
						? `${coordinate[0].toFixed(4)},${coordinate[1].toFixed(4)}`
						: "";
				});

	return [
		Math.round(route.distanceMeters / 250),
		Math.round(route.durationMs / 60000),
		Math.round(route.ascendMeters / 25),
		...sampledCoordinates,
	].join("|");
}

export function dedupeRoutes(routes: PlannedRoute[]): PlannedRoute[] {
	const uniqueRoutes = new Map<string, PlannedRoute>();

	for (const route of routes) {
		const key = buildRouteUniquenessKey(route);

		if (!uniqueRoutes.has(key)) {
			uniqueRoutes.set(key, route);
		}
	}

	return [...uniqueRoutes.values()];
}

export function dedupeCandidateRoutes(
	candidates: CandidateRouteResult[],
): CandidateRouteResult[] {
	const uniqueCandidates = new Map<string, CandidateRouteResult>();

	for (const candidate of candidates) {
		const key = buildRouteUniquenessKey(candidate.route);

		if (!uniqueCandidates.has(key)) {
			uniqueCandidates.set(key, candidate);
		}
	}

	return [...uniqueCandidates.values()];
}

export function mirrorDetailIntervals(
	details: RouteDetailInterval[],
	coordinateCount: number,
): RouteDetailInterval[] {
	const outboundExtent = Math.max(
		coordinateCount - 1,
		...details.map((detail) => detail.to),
		0,
	);

	return [
		...details,
		...details
			.slice()
			.reverse()
			.map((detail) => ({
				from: outboundExtent + (outboundExtent - detail.to),
				to: outboundExtent + (outboundExtent - detail.from),
				value: detail.value,
			})),
	];
}

export function buildOutAndBackRoute(
	outboundRoute: PlannedRoute,
	startLabel: string,
	turnaroundLabel: string,
	snappedStart: RouteCoordinate,
	snappedTurnaround: RouteCoordinate,
	shapingWaypoints: RouteWaypoint[] = [],
): PlannedRoute {
	const outboundCoordinates =
		outboundRoute.coordinates.length >= 2
			? outboundRoute.coordinates
			: [snappedStart, snappedTurnaround];

	return {
		...outboundRoute,
		mode: "out_and_back",
		startLabel,
		destinationLabel: turnaroundLabel,
		waypoints: [
			...shapingWaypoints,
			{
				label: turnaroundLabel,
				coordinate: snappedTurnaround,
			},
		],
		distanceMeters: outboundRoute.distanceMeters * 2,
		durationMs: outboundRoute.durationMs * 2,
		ascendMeters: outboundRoute.ascendMeters + outboundRoute.descendMeters,
		descendMeters: outboundRoute.descendMeters + outboundRoute.ascendMeters,
		coordinates: [
			...outboundCoordinates,
			...outboundCoordinates.slice(0, -1).reverse(),
		],
		surfaceDetails: mirrorDetailIntervals(
			outboundRoute.surfaceDetails,
			outboundCoordinates.length,
		),
		smoothnessDetails: mirrorDetailIntervals(
			outboundRoute.smoothnessDetails,
			outboundCoordinates.length,
		),
		roadClassDetails: mirrorDetailIntervals(
			outboundRoute.roadClassDetails ?? [],
			outboundCoordinates.length,
		),
		roadEnvironmentDetails: mirrorDetailIntervals(
			outboundRoute.roadEnvironmentDetails ?? [],
			outboundCoordinates.length,
		),
		roadAccessDetails: mirrorDetailIntervals(
			outboundRoute.roadAccessDetails ?? [],
			outboundCoordinates.length,
		),
		bikeNetworkDetails: mirrorDetailIntervals(
			outboundRoute.bikeNetworkDetails ?? [],
			outboundCoordinates.length,
		),
		routeQuality: undefined,
	};
}

export function mapRouteBoundaryToGenerationError(
	logPrefix: string,
	userMessage: string,
) {
	return (
		error: GraphHopperRouteBoundaryError,
	): RouteGenerationError | GraphHopperRouteBoundaryError => {
		if (
			isMissingGraphHopperApiKeyError(error) ||
			isGraphHopperRoutePointLimitError(error) ||
			error instanceof GraphHopperRouteRateLimitExceededError ||
			error instanceof GraphHopperRouteRateLimitUnavailableError
		) {
			return error;
		}

		return new RouteGenerationError(logPrefix, userMessage, error);
	};
}
