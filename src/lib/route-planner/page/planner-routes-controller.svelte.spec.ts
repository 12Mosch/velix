import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { PlannedRoute, RouteWindAnalysis } from "$lib/route-planning";
import { createPlannerRoutesController } from "./planner-routes-controller.svelte";
import type { PlannerFormState } from "./planner-state";

function buildRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
	return {
		mode: "point_to_point",
		source: { kind: "graphhopper" },
		startLabel: "Start",
		destinationLabel: "Finish",
		waypoints: [],
		bounds: [0, 0, 1, 1],
		distanceMeters: 1000,
		durationMs: 120000,
		ascendMeters: 10,
		descendMeters: 10,
		coordinates: [
			[0, 0],
			[0, 0.01],
		],
		surfaceDetails: [],
		smoothnessDetails: [],
		...overrides,
	};
}

const windAnalysis: RouteWindAnalysis = {
	source: "open_meteo",
	fetchedAt: "2026-05-10T10:00:00Z",
	forecastTime: "2026-05-10T10:00",
	samples: [],
	segments: [
		{
			from: 0,
			to: 1,
			speedKmh: 20,
			directionDegrees: 0,
			routeBearingDegrees: 0,
			relativeAngleDegrees: 0,
			headwindComponentKmh: 20,
			crosswindComponentKmh: 0,
			bucket: "headwind",
		},
	],
	averageHeadwindKmh: 20,
	maxHeadwindKmh: 20,
	averageTailwindKmh: 0,
	maxCrosswindKmh: 0,
	headwindDistanceMeters: 1000,
	tailwindDistanceMeters: 0,
	crosswindDistanceMeters: 0,
};

function createController(
	fetchMock: typeof fetch,
	getActiveRouteShareKey = () => "active-share" as string | null,
) {
	const scheduleActiveRouteAutosave = vi.fn();
	const bumpRouteSaveRevision = vi.fn();
	const clearRouteShareState = vi.fn();
	const controller = createPlannerRoutesController({
		getFetch: () => fetchMock,
		getPlannerFormState: () => ({}) as PlannerFormState,
		applyPlannerFormState: vi.fn(),
		getFieldErrors: () => ({}),
		setFieldErrors: vi.fn(),
		clearFieldErrors: vi.fn(),
		closeCompletionMenu: vi.fn(),
		closeMapClickMenu: vi.fn(),
		resetAnalysisState: vi.fn(),
		cancelAutosaveTimer: vi.fn(),
		scheduleActiveRouteAutosave,
		bumpRouteSaveRevision,
		captureSavedRouteEditMetadata: () => ({
			activeSavedRouteId: null,
			plannerDraftRouteId: null,
			pendingSavedRouteId: null,
			pendingSavedRouteRestoreRevision: null,
			isActiveRouteSaved: false,
		}),
		restoreSavedRouteEditMetadata: vi.fn(),
		markUnsaved: vi.fn(),
		setPendingSavedRouteId: vi.fn(),
		setRouteImportError: vi.fn(),
		setRouteExportError: vi.fn(),
		clearRouteShareState,
		getActiveRouteShareKey,
		applyWorkoutPlanTarget: () => true,
		validateDistanceInputs: () => true,
	});

	return {
		controller,
		scheduleActiveRouteAutosave,
		bumpRouteSaveRevision,
		clearRouteShareState,
	};
}

describe("createPlannerRoutesController wind enrichment", () => {
	it("loads wind for the active route and replaces only that alternative", async () => {
		const baseRoute = buildRoute();
		const otherRoute = buildRoute({ destinationLabel: "Other" });
		const enrichedRoute = { ...baseRoute, windAnalysis };
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(JSON.stringify({ route: enrichedRoute }), {
					status: 200,
				}),
			),
		);
		const {
			controller,
			scheduleActiveRouteAutosave,
			bumpRouteSaveRevision,
			clearRouteShareState,
		} = createController(fetchMock);

		controller.setRouteAlternativesState([baseRoute, otherRoute], 0);
		await Effect.runPromise(controller.ensureActiveRouteWindAnalysis());

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith("/api/route/wind", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({ route: baseRoute }),
		});
		expect(controller.routeAlternatives[0]?.windAnalysis).toEqual(windAnalysis);
		expect(controller.routeAlternatives[1]).toEqual(otherRoute);
		expect(bumpRouteSaveRevision).toHaveBeenCalledTimes(1);
		expect(scheduleActiveRouteAutosave).toHaveBeenCalledTimes(1);
		expect(clearRouteShareState).toHaveBeenCalledWith("active-share");
	});

	it("clears the active share key captured after wind enrichment completes", async () => {
		const baseRoute = buildRoute();
		let activeRouteShareKey: string | null = null;
		let resolveFetch!: (response: Response) => void;
		const fetchMock = vi.fn<typeof fetch>(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
				}),
		);
		const { controller, clearRouteShareState } = createController(
			fetchMock,
			() => activeRouteShareKey,
		);

		controller.setRouteAlternativesState([baseRoute], 0);
		const enrichment = Effect.runPromise(
			controller.ensureActiveRouteWindAnalysis(),
		);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(controller.activeRouteWindAnalysisLoading).toBe(true);

		activeRouteShareKey = "created-during-request";
		resolveFetch(
			new Response(JSON.stringify({ route: { ...baseRoute, windAnalysis } }), {
				status: 200,
			}),
		);
		await enrichment;

		expect(controller.activeRouteWindAnalysisLoading).toBe(false);
		expect(clearRouteShareState).toHaveBeenCalledWith("created-during-request");
	});

	it("does not request wind when the active route already has wind or a wind provider warning", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		const { controller } = createController(fetchMock);

		controller.setRouteAlternativesState(
			[buildRoute({ windAnalysis }), buildRoute()],
			0,
		);
		await Effect.runPromise(controller.ensureActiveRouteWindAnalysis());

		controller.setRouteAlternativesState(
			[
				buildRoute({
					warnings: [
						{
							category: "routing_provider",
							code: "wind_analysis_unavailable",
							severity: "info",
							title: "Wind analysis unavailable",
							message: "Wind data is temporarily unavailable.",
						},
					],
				}),
			],
			0,
		);
		await Effect.runPromise(controller.ensureActiveRouteWindAnalysis());

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
