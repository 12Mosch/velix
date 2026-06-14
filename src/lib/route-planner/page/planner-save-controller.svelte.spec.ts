import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import type { PlannedRoute } from "$lib/route-planning";
import type { SavedRoute } from "$lib/saved-routes.svelte";

const savedRoutesMock = vi.hoisted(() => ({
	getSavedRouteByIdEffect: vi.fn(),
}));

vi.mock("$lib/saved-routes.svelte", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/saved-routes.svelte")>();

	return {
		...actual,
		getSavedRouteByIdEffect: savedRoutesMock.getSavedRouteByIdEffect,
	};
});

import type { createPlannerSaveController } from "./planner-save-controller.svelte";
import PlannerSaveControllerHarness from "./planner-save-controller-harness.svelte";

const plannedRoute: PlannedRoute = {
	mode: "point_to_point",
	source: {
		kind: "graphhopper",
	},
	startLabel: "Marienplatz, Munich, Germany",
	destinationLabel: "Schliersee, Germany",
	routingProfile: "racingbike",
	routingStrategy: "GraphHopper racingbike test route.",
	routingWarnings: [],
	waypoints: [],
	bounds: [11.5755, 47.7362, 11.8598, 48.1374],
	distanceMeters: 61234,
	durationMs: 9876000,
	ascendMeters: 820,
	descendMeters: 740,
	coordinates: [
		[11.5755, 48.1374, 520],
		[11.8598, 47.7362, 785],
	],
	instructions: [],
	surfaceDetails: [],
	smoothnessDetails: [],
};

function createSavedRoute(id = "saved-route-1"): SavedRoute {
	return {
		id,
		createdAt: "2026-06-14T00:00:00.000Z",
		route: plannedRoute,
	};
}

function createLocation(savedRouteId: string): Location {
	return {
		search: `?savedRoute=${encodeURIComponent(savedRouteId)}`,
	} as Location;
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((deferredResolve) => {
		resolve = deferredResolve;
	});

	return { promise, resolve };
}

function createControllerHarness() {
	let controller!: ReturnType<typeof createPlannerSaveController>;
	const setSingleRouteState = vi.fn();
	const dependencies = {
		isDestroyed: () => false,
		getRouteNeedsRecalculation: () => false,
		getActiveRoute: () => null,
		getActiveRouteForSaving: () => null,
		setSingleRouteState,
		setLastGeneratedRouteCount: vi.fn(),
		syncStopsFromRoute: vi.fn(),
		setRouteNeedsRecalculation: vi.fn(),
		setRouteRequestError: vi.fn(),
		clearFieldErrors: vi.fn(),
		resetAnalysisState: vi.fn(),
		clearRouteEditHistory: vi.fn(),
	};
	render(PlannerSaveControllerHarness, {
		dependencies,
		onController: (nextController) => {
			controller = nextController;
		},
	});

	return {
		controller,
		dependencies,
		setSingleRouteState,
	};
}

describe("createPlannerSaveController", () => {
	beforeEach(() => {
		savedRoutesMock.getSavedRouteByIdEffect.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("applies a queued saved-route restore when the route is available", async () => {
		const savedRoute = createSavedRoute();
		const { controller, setSingleRouteState } = createControllerHarness();
		savedRoutesMock.getSavedRouteByIdEffect.mockReturnValue(
			Effect.succeed(savedRoute),
		);

		controller.queueSavedRouteRestoreFromLocation(
			createLocation(savedRoute.id),
		);
		await Effect.runPromise(controller.restorePendingSavedRoute());

		expect(savedRoutesMock.getSavedRouteByIdEffect).toHaveBeenCalledWith(
			savedRoute.id,
		);
		expect(setSingleRouteState).toHaveBeenCalledWith(savedRoute.route);
		expect(controller.activeSavedRouteId).toBe(savedRoute.id);
		expect(controller.plannerDraftRouteId).toBe(savedRoute.id);
		expect(controller.isActiveRouteSaved).toBe(true);
		expect(controller.pendingSavedRouteId).toBeNull();
	});

	it("does not apply a delayed queued restore after the planner is edited", async () => {
		const savedRoute = createSavedRoute();
		const savedRouteRead = createDeferred<SavedRoute | null>();
		const { controller, setSingleRouteState } = createControllerHarness();
		savedRoutesMock.getSavedRouteByIdEffect.mockReturnValue(
			Effect.promise(() => savedRouteRead.promise),
		);

		controller.queueSavedRouteRestoreFromLocation(
			createLocation(savedRoute.id),
		);
		const restorePromise = Effect.runPromise(
			controller.restorePendingSavedRoute(),
		);
		await expect
			.poll(() => savedRoutesMock.getSavedRouteByIdEffect.mock.calls.length)
			.toBeGreaterThan(0);

		controller.markUnsaved();
		savedRouteRead.resolve(savedRoute);
		await restorePromise;

		expect(setSingleRouteState).not.toHaveBeenCalled();
		expect(controller.activeSavedRouteId).toBeNull();
		expect(controller.plannerDraftRouteId).toBeNull();
		expect(controller.isActiveRouteSaved).toBe(false);
		expect(controller.pendingSavedRouteId).toBeNull();
	});
});
