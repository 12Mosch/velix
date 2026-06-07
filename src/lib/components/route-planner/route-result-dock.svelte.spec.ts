import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";

import type { PlannedRoute, RouteQualityAnalysis } from "$lib/route-planning";
import type { ComponentProps } from "svelte";
import RouteResultDock from "./route-result-dock.svelte";

const baseRoute: PlannedRoute = {
	mode: "point_to_point",
	source: { kind: "graphhopper" },
	startLabel: "Start",
	destinationLabel: "Finish",
	routingProfile: "racingbike",
	routingStrategy: "Road-bike routing",
	routingWarnings: [],
	waypoints: [],
	bounds: [11.5, 47.2, 11.6, 47.3],
	distanceMeters: 42_000,
	durationMs: 7_200_000,
	ascendMeters: 640,
	descendMeters: 610,
	coordinates: [
		[11.5, 47.2, 500],
		[11.6, 47.3, 620],
	],
	instructions: [
		{
			distanceFromStartMeters: 0,
			text: "Continue",
			sign: 0,
			type: "continue",
			segmentDistanceMeters: 1000,
			segmentTimeMs: 120_000,
			coordinateIndex: 0,
			coordinate: [11.5, 47.2, 500],
			interval: [0, 1],
		},
	],
	surfaceDetails: [],
	smoothnessDetails: [],
};

const goodQuality = {
	version: 1,
	overallScore: 88,
	band: "good",
	confidence: "high",
	subscores: {},
	flags: [],
} as unknown as RouteQualityAnalysis;

function throwIfRead(name: string): never {
	throw new Error(`${name} was read while panels were closed`);
}

function createProps({
	routeAlternatives = [baseRoute],
	routeAlternativeQualities = () => throwIfRead("routeAlternativeQualities"),
}: {
	routeAlternatives?: PlannedRoute[];
	routeAlternativeQualities?: () => RouteQualityAnalysis[];
} = {}): ComponentProps<typeof RouteResultDock> {
	let directionsOpen = false;
	let routeAnalysisOpen = false;

	return {
		form: {
			isRoundCourseMode: false,
			isOutAndBackMode: false,
			getSubmitButtonText: () => "Generate Route",
		},
		routes: {
			isRouting: false,
			routeAlternatives,
			selectedRouteIndex: 0,
			routeNeedsRecalculation: false,
			avoidedRoads: [],
			activeRoute: routeAlternatives[0] ?? null,
			activeDirections: routeAlternatives[0]?.instructions ?? [],
			activeTurnCount: routeAlternatives[0]?.instructions?.length ?? 0,
			activeRoundCourseTarget: null,
			activeImportedRouteSource: null,
			alternativeInfoMessage: null,
			canUndoRouteEdit: false,
			canRedoRouteEdit: false,
			undoRouteEdit: vi.fn(),
			redoRouteEdit: vi.fn(),
			selectRouteAlternative: vi.fn(),
			removeAvoidedRoad: vi.fn(() => Effect.void),
		},
		analysis: {
			get directionsOpen() {
				return directionsOpen;
			},
			set directionsOpen(value: boolean) {
				directionsOpen = value;
			},
			get routeAnalysisOpen() {
				return routeAnalysisOpen;
			},
			set routeAnalysisOpen(value: boolean) {
				routeAnalysisOpen = value;
			},
			selectedCueIndex: null,
			get activeRouteClimbs() {
				return throwIfRead("activeRouteClimbs");
			},
			get activeRouteGradientMetrics() {
				return throwIfRead("activeRouteGradientMetrics");
			},
			get activeRouteGradientSections() {
				return throwIfRead("activeRouteGradientSections");
			},
			get notableGradientSections() {
				return throwIfRead("notableGradientSections");
			},
			get activeRouteQuality() {
				return throwIfRead("activeRouteQuality");
			},
			get activeTrainingSuitability() {
				return throwIfRead("activeTrainingSuitability");
			},
			get routeAlternativeQualities() {
				return routeAlternativeQualities();
			},
			get activeWindSummary() {
				return throwIfRead("activeWindSummary");
			},
			get strongestWindSegments() {
				return throwIfRead("strongestWindSegments");
			},
			get activeCategorizedClimbs() {
				return throwIfRead("activeCategorizedClimbs");
			},
			get activeKeyClimbs() {
				return throwIfRead("activeKeyClimbs");
			},
			get hardestClimb() {
				return throwIfRead("hardestClimb");
			},
			get surfaceMix() {
				return throwIfRead("surfaceMix");
			},
			get activeReadinessWarnings() {
				return throwIfRead("activeReadinessWarnings");
			},
			get activeProviderWarnings() {
				return throwIfRead("activeProviderWarnings");
			},
			get elevationSamples() {
				return throwIfRead("elevationSamples");
			},
			get chartH() {
				return throwIfRead("chartH");
			},
			get elevMin() {
				return throwIfRead("elevMin");
			},
			get elevMax() {
				return throwIfRead("elevMax");
			},
			get sampledProfileDistanceTotal() {
				return throwIfRead("sampledProfileDistanceTotal");
			},
			get activeProfilePoint() {
				return throwIfRead("activeProfilePoint");
			},
			get linePoints() {
				return throwIfRead("linePoints");
			},
			get areaD() {
				return throwIfRead("areaD");
			},
			get distanceTickLabels() {
				return throwIfRead("distanceTickLabels");
			},
			selectCue: vi.fn(),
			formatCueSegmentTime: () => "2 min",
			getWarningContainerClass: () => "",
			getWarningBadgeClass: () => "",
			getWindSegmentDistanceRange: () => "0-1 km",
			handleChartPointerDown: vi.fn(),
			handleChartPointerMove: vi.fn(),
			handleChartPointerLeave: vi.fn(),
			releaseChartScrub: vi.fn(),
			handleChartLostPointerCapture: vi.fn(),
		},
		save: {
			saveSyncError: null,
			isActiveRouteSaved: false,
			handleSaveDraft: vi.fn(() => Effect.void),
		},
		sharing: {
			isSharingRoute: false,
			activeRouteShareError: null,
			activeRouteShareUrl: null,
			isActiveRouteShareCopied: false,
			handleShareActiveRoute: vi.fn(() => Effect.void),
		},
		importExport: {
			isImportingGpx: false,
			routeExportError: null,
			openGpxImportPicker: vi.fn(),
			handleExportGpx: vi.fn(),
			handleExportFit: vi.fn(),
		},
	} as unknown as ComponentProps<typeof RouteResultDock>;
}

describe("RouteResultDock lazy analysis state", () => {
	it("does not read heavy analysis getters while Profile, Analysis, and Directions are closed", async () => {
		render(RouteResultDock, createProps());

		await expect
			.element(page.getByRole("button", { name: "Profile" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: "Analysis" }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole("img", { name: "Elevation along route" }))
			.not.toBeInTheDocument();
		await expect.element(page.getByText(/Quality/)).not.toBeInTheDocument();
	});

	it("does not read alternative qualities for a single active route", async () => {
		const routeAlternativeQualities = vi.fn(() =>
			throwIfRead("routeAlternativeQualities"),
		);

		render(RouteResultDock, createProps({ routeAlternativeQualities }));

		await expect
			.element(page.getByRole("button", { name: "Profile" }))
			.toBeInTheDocument();
		expect(routeAlternativeQualities).not.toHaveBeenCalled();
	});

	it("reads alternative qualities when multiple alternatives are visible", async () => {
		const routeAlternativeQualities = vi.fn(() => [goodQuality, goodQuality]);
		const secondRoute = {
			...baseRoute,
			distanceMeters: 45_000,
			ascendMeters: 720,
			descendMeters: 690,
		};

		render(
			RouteResultDock,
			createProps({
				routeAlternatives: [baseRoute, secondRoute],
				routeAlternativeQualities,
			}),
		);

		await expect.element(page.getByText("Alternatives")).toBeInTheDocument();
		await expect
			.element(page.getByText("Quality 88").first())
			.toBeInTheDocument();
		await expect.element(page.getByText("Good").first()).toBeInTheDocument();
		expect(routeAlternativeQualities).toHaveBeenCalled();
	});
});
