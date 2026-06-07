import { describe, expect, it } from "vitest";

import type {
	PlannedRoute,
	RouteClimb,
	RouteCoordinate,
	RouteWindAnalysis,
} from "$lib/route-planning";
import { createPlannerOverlayCache } from "./planner-overlay-cache";

function createTrackedCoordinates(onCoordinateRead: () => void) {
	return new Proxy(
		[
			[11.5, 47.2, 500],
			[11.55, 47.24, 540],
			[11.6, 47.28, 610],
			[11.65, 47.32, 650],
		] satisfies RouteCoordinate[],
		{
			get(target, property, receiver) {
				if (
					property === "entries" ||
					property === Symbol.iterator ||
					(typeof property === "string" && /^\d+$/.test(property))
				) {
					onCoordinateRead();
				}

				return Reflect.get(target, property, receiver);
			},
		},
	);
}

function createRoute(
	onCoordinateRead: () => void,
	overrides: Partial<PlannedRoute> = {},
): PlannedRoute {
	return {
		mode: "point_to_point",
		source: { kind: "graphhopper" },
		startLabel: "Start",
		destinationLabel: "Finish",
		routingWarnings: [],
		waypoints: [],
		bounds: [11.5, 47.2, 11.65, 47.32],
		distanceMeters: 12_000,
		durationMs: 1_800_000,
		ascendMeters: 180,
		descendMeters: 120,
		coordinates: createTrackedCoordinates(onCoordinateRead),
		instructions: [],
		surfaceDetails: [],
		smoothnessDetails: [],
		...overrides,
	};
}

const climbs: RouteClimb[] = [
	{
		startIndex: 0,
		endIndex: 3,
		rawStartIndex: 0,
		rawEndIndex: 3,
		startDistanceMeters: 0,
		endDistanceMeters: 1200,
		distanceMeters: 1200,
		elevationGainMeters: 150,
		averageGradePercent: 12.5,
		maxGradePercent: 16,
		score: 300,
		category: "Cat 3",
		isKeyClimb: true,
	},
];

const windAnalysis: RouteWindAnalysis = {
	source: "open_meteo",
	fetchedAt: "2026-05-26T10:00:00.000Z",
	forecastTime: "2026-05-26T10:00",
	samples: [],
	segments: [
		{
			from: 0,
			to: 3,
			speedKmh: 24,
			directionDegrees: 270,
			routeBearingDegrees: 30,
			relativeAngleDegrees: 120,
			headwindComponentKmh: 12,
			crosswindComponentKmh: 8,
			bucket: "headwind",
		},
	],
	averageHeadwindKmh: 12,
	maxHeadwindKmh: 18,
	averageTailwindKmh: 0,
	maxCrosswindKmh: 8,
	headwindDistanceMeters: 1200,
	tailwindDistanceMeters: 0,
	crosswindDistanceMeters: 0,
};

const trafficStressDetails: Partial<PlannedRoute> = {
	roadClassDetails: [{ from: 0, to: 3, value: "primary" }],
	roadAccessDetails: [{ from: 0, to: 3, value: "yes" }],
	bikeNetworkDetails: [{ from: 0, to: 3, value: "local" }],
};

describe("planner overlay cache", () => {
	it("returns cached base route GeoJSON without rereading coordinates", () => {
		let coordinateReads = 0;
		const route = createRoute(() => {
			coordinateReads += 1;
		});
		const cache = createPlannerOverlayCache();

		const firstGeoJson = cache.getCachedBaseRouteGeoJson(route);
		const readsAfterFirstCall = coordinateReads;
		const secondGeoJson = cache.getCachedBaseRouteGeoJson(route);

		expect(secondGeoJson).toBe(firstGeoJson);
		expect(coordinateReads).toBe(readsAfterFirstCall);
	});

	it("keeps cloned route objects in separate cache entries", () => {
		let coordinateReads = 0;
		const route = createRoute(() => {
			coordinateReads += 1;
		});
		const clonedRoute = {
			...route,
			coordinates: createTrackedCoordinates(() => {
				coordinateReads += 1;
			}),
		};
		const cache = createPlannerOverlayCache();

		const firstGeoJson = cache.getCachedBaseRouteGeoJson(route);
		const readsAfterFirstCall = coordinateReads;
		const clonedGeoJson = cache.getCachedBaseRouteGeoJson(clonedRoute);

		expect(clonedGeoJson).not.toBe(firstGeoJson);
		expect(coordinateReads).toBeGreaterThan(readsAfterFirstCall);
	});

	it("returns cached climb GeoJSON without rereading coordinates", () => {
		let coordinateReads = 0;
		const route = createRoute(() => {
			coordinateReads += 1;
		});
		const cache = createPlannerOverlayCache();

		const firstGeoJson = cache.getCachedClimbRouteGeoJson(route, climbs);
		const readsAfterFirstCall = coordinateReads;
		const secondGeoJson = cache.getCachedClimbRouteGeoJson(route, climbs);

		expect(secondGeoJson).toBe(firstGeoJson);
		expect(coordinateReads).toBe(readsAfterFirstCall);
	});

	it("returns cached wind GeoJSON without rereading coordinates", () => {
		let coordinateReads = 0;
		const route = createRoute(
			() => {
				coordinateReads += 1;
			},
			{ windAnalysis },
		);
		const cache = createPlannerOverlayCache();

		const firstGeoJson = cache.getCachedWindRouteGeoJson(route);
		const readsAfterFirstCall = coordinateReads;
		const secondGeoJson = cache.getCachedWindRouteGeoJson(route);

		expect(secondGeoJson).toBe(firstGeoJson);
		expect(coordinateReads).toBe(readsAfterFirstCall);
	});

	it("returns cached traffic-stress GeoJSON without rereading coordinates", () => {
		let coordinateReads = 0;
		const route = createRoute(() => {
			coordinateReads += 1;
		}, trafficStressDetails);
		const cache = createPlannerOverlayCache();

		const firstGeoJson = cache.getCachedTrafficStressRouteGeoJson(route);
		const readsAfterFirstCall = coordinateReads;
		const secondGeoJson = cache.getCachedTrafficStressRouteGeoJson(route);

		expect(secondGeoJson).toBe(firstGeoJson);
		expect(coordinateReads).toBe(readsAfterFirstCall);
	});

	it("returns cached traffic-stress availability without rereading coordinates", () => {
		let coordinateReads = 0;
		const route = createRoute(() => {
			coordinateReads += 1;
		}, trafficStressDetails);
		const cache = createPlannerOverlayCache();

		const firstAvailability =
			cache.getCachedRouteTrafficStressOverlayAvailable(route);
		const readsAfterFirstCall = coordinateReads;
		const secondAvailability =
			cache.getCachedRouteTrafficStressOverlayAvailable(route);

		expect(secondAvailability).toBe(firstAvailability);
		expect(coordinateReads).toBe(readsAfterFirstCall);
	});
});
