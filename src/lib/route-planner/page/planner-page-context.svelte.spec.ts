import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlannedRoute, RouteWindAnalysis } from "$lib/route-planning";
import {
	routeHasGradientOverlayFeatures,
	routeHasTrafficStressOverlayFeatures,
	routeHasWindOverlayFeatures,
} from "./route-overlay-capabilities";

const routePlanningMocks = vi.hoisted(() => ({
	buildRouteGradientGeoJson: vi.fn(),
	buildRouteTrafficStressGeoJson: vi.fn(),
	buildRouteWindGeoJson: vi.fn(),
}));

vi.mock("$lib/route-planning", async (importActual) => {
	const actual = await importActual<typeof import("$lib/route-planning")>();

	return {
		...actual,
		buildRouteGradientGeoJson:
			routePlanningMocks.buildRouteGradientGeoJson.mockImplementation(
				actual.buildRouteGradientGeoJson,
			),
		buildRouteTrafficStressGeoJson:
			routePlanningMocks.buildRouteTrafficStressGeoJson.mockImplementation(
				actual.buildRouteTrafficStressGeoJson,
			),
		buildRouteWindGeoJson:
			routePlanningMocks.buildRouteWindGeoJson.mockImplementation(
				actual.buildRouteWindGeoJson,
			),
	};
});

function createRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
	return {
		mode: "point_to_point",
		source: { kind: "graphhopper" },
		startLabel: "Start",
		destinationLabel: "Destination",
		waypoints: [],
		bounds: [11.57, 48.1, 11.59, 48.12],
		distanceMeters: 2_500,
		durationMs: 600_000,
		ascendMeters: 80,
		descendMeters: 20,
		coordinates: [
			[11.57, 48.1, 520],
			[11.58, 48.11, 560],
			[11.59, 48.12, 600],
		],
		instructions: [],
		surfaceDetails: [],
		smoothnessDetails: [],
		...overrides,
	};
}

function createWindAnalysis(
	segments: RouteWindAnalysis["segments"],
): RouteWindAnalysis {
	return {
		source: "open_meteo",
		fetchedAt: "2026-05-24T08:00:00.000Z",
		forecastTime: "2026-05-24T09:00:00.000Z",
		samples: [],
		segments,
		averageHeadwindKmh: 0,
		maxHeadwindKmh: 0,
		averageTailwindKmh: 0,
		maxCrosswindKmh: 0,
		headwindDistanceMeters: 0,
		tailwindDistanceMeters: 0,
		crosswindDistanceMeters: 0,
	};
}

function createWindSegment(
	overrides: Partial<RouteWindAnalysis["segments"][number]> = {},
): RouteWindAnalysis["segments"][number] {
	return {
		from: 0,
		to: 1,
		speedKmh: 12,
		directionDegrees: 270,
		routeBearingDegrees: 90,
		relativeAngleDegrees: 180,
		headwindComponentKmh: 12,
		crosswindComponentKmh: 0,
		bucket: "headwind",
		...overrides,
	};
}

describe("route overlay capabilities", () => {
	beforeEach(() => {
		routePlanningMocks.buildRouteGradientGeoJson.mockClear();
		routePlanningMocks.buildRouteTrafficStressGeoJson.mockClear();
		routePlanningMocks.buildRouteWindGeoJson.mockClear();
	});

	it("detects gradient overlay availability without building gradient GeoJSON", () => {
		const route = createRoute();

		expect(routeHasGradientOverlayFeatures(route)).toBe(true);
		expect(routePlanningMocks.buildRouteGradientGeoJson).not.toHaveBeenCalled();
	});

	it("does not enable gradient overlay without valid elevation segments", () => {
		const route = createRoute({
			coordinates: [
				[11.57, 48.1],
				[11.58, 48.11],
			],
		});

		expect(routeHasGradientOverlayFeatures(route)).toBe(false);
		expect(routePlanningMocks.buildRouteGradientGeoJson).not.toHaveBeenCalled();
	});

	it("detects wind overlay availability without building wind GeoJSON", () => {
		const route = createRoute({
			windAnalysis: createWindAnalysis([createWindSegment()]),
		});

		expect(routeHasWindOverlayFeatures(route)).toBe(true);
		expect(routePlanningMocks.buildRouteWindGeoJson).not.toHaveBeenCalled();
	});

	it("does not enable wind overlay without wind analysis", () => {
		expect(routeHasWindOverlayFeatures(createRoute())).toBe(false);
		expect(routePlanningMocks.buildRouteWindGeoJson).not.toHaveBeenCalled();
	});

	it("does not enable wind overlay for invalid wind segments", () => {
		const route = createRoute({
			windAnalysis: createWindAnalysis([
				createWindSegment({ from: 1, to: 1 }),
				createWindSegment({ from: 1, to: 3 }),
			]),
		});

		expect(routeHasWindOverlayFeatures(route)).toBe(false);
		expect(routePlanningMocks.buildRouteWindGeoJson).not.toHaveBeenCalled();
	});

	it("detects traffic stress overlay availability without building traffic GeoJSON", () => {
		const route = createRoute({
			roadClassDetails: [{ from: 0, to: 1, value: "primary" }],
		});

		expect(routeHasTrafficStressOverlayFeatures(route)).toBe(true);
		expect(
			routePlanningMocks.buildRouteTrafficStressGeoJson,
		).not.toHaveBeenCalled();
	});

	it("does not enable traffic stress overlay without valid road or access details", () => {
		const route = createRoute({
			bikeNetworkDetails: [{ from: 0, to: 1, value: "local" }],
		});

		expect(routeHasTrafficStressOverlayFeatures(route)).toBe(false);
		expect(
			routePlanningMocks.buildRouteTrafficStressGeoJson,
		).not.toHaveBeenCalled();
	});

	it("does not enable traffic stress overlay for zero-length interval", () => {
		const route = createRoute({
			roadClassDetails: [{ from: 1, to: 1, value: "primary" }],
		});

		expect(routeHasTrafficStressOverlayFeatures(route)).toBe(false);
		expect(
			routePlanningMocks.buildRouteTrafficStressGeoJson,
		).not.toHaveBeenCalled();
	});

	it("does not enable traffic stress overlay for non-integer start", () => {
		const route = createRoute({
			roadClassDetails: [{ from: 0.5, to: 1, value: "primary" }],
		});

		expect(routeHasTrafficStressOverlayFeatures(route)).toBe(false);
		expect(
			routePlanningMocks.buildRouteTrafficStressGeoJson,
		).not.toHaveBeenCalled();
	});

	it("does not enable traffic stress overlay for negative bounds", () => {
		const route = createRoute({
			roadClassDetails: [{ from: -1, to: 1, value: "primary" }],
		});

		expect(routeHasTrafficStressOverlayFeatures(route)).toBe(false);
		expect(
			routePlanningMocks.buildRouteTrafficStressGeoJson,
		).not.toHaveBeenCalled();
	});

	it("does not enable traffic stress overlay for detail interval exceeding range", () => {
		const route = createRoute({
			roadClassDetails: [{ from: 0, to: 3, value: "primary" }],
		});

		expect(routeHasTrafficStressOverlayFeatures(route)).toBe(false);
		expect(
			routePlanningMocks.buildRouteTrafficStressGeoJson,
		).not.toHaveBeenCalled();
	});
});
