import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import type { PlannedRoute } from "$lib/route-planning";
import type { SavedRoute } from "$lib/saved-routes.svelte";

const savedRoutesMock = vi.hoisted(() => ({
	getSavedRouteByIdEffect: vi.fn(),
	upsertSavedRouteEffect: vi.fn(),
}));

vi.mock("$lib/saved-routes.svelte", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/saved-routes.svelte")>();

	return {
		...actual,
		getSavedRouteByIdEffect: savedRoutesMock.getSavedRouteByIdEffect,
		upsertSavedRouteEffect: savedRoutesMock.upsertSavedRouteEffect,
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
	const dependencies: Parameters<typeof createPlannerSaveController>[0] = {
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
		savedRoutesMock.upsertSavedRouteEffect.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
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

	it("serializes rapid saves and preserves the first autosaved route id", async () => {
		const firstUpsert = createDeferred<SavedRoute>();
		let activeRoute = plannedRoute;
		const { controller, dependencies } = createControllerHarness();
		dependencies.getActiveRouteForSaving = () => activeRoute;
		savedRoutesMock.upsertSavedRouteEffect
			.mockReturnValueOnce(Effect.promise(() => firstUpsert.promise))
			.mockImplementation((route: PlannedRoute, id?: string) =>
				Effect.succeed({
					...createSavedRoute(id),
					route,
				}),
			);

		const firstSave = Effect.runPromise(
			controller.saveActiveRouteDraft({ source: "autosave" }),
		);
		await expect
			.poll(() => savedRoutesMock.upsertSavedRouteEffect.mock.calls.length)
			.toBe(1);

		activeRoute = { ...plannedRoute, distanceMeters: 61_999 };
		controller.bumpRouteSaveRevision();
		const secondSave = Effect.runPromise(
			controller.saveActiveRouteDraft({ source: "autosave" }),
		);
		await Promise.resolve();

		expect(savedRoutesMock.upsertSavedRouteEffect).toHaveBeenCalledTimes(1);
		firstUpsert.resolve(createSavedRoute("stable-draft-id"));
		await firstSave;
		await secondSave;

		expect(savedRoutesMock.upsertSavedRouteEffect).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ distanceMeters: 61_999 }),
			"stable-draft-id",
			{ source: "autosave" },
		);
		expect(controller.plannerDraftRouteId).toBe("stable-draft-id");
	});

	it("interrupts an in-flight autosave when destroyed", async () => {
		vi.useFakeTimers();
		let wasInterrupted = false;
		const { controller, dependencies } = createControllerHarness();
		dependencies.getActiveRouteForSaving = () => plannedRoute;
		savedRoutesMock.upsertSavedRouteEffect.mockReturnValue(
			Effect.callback<SavedRoute>(() =>
				Effect.sync(() => {
					wasInterrupted = true;
				}),
			),
		);

		controller.scheduleActiveRouteAutosave();
		await vi.advanceTimersByTimeAsync(750);
		expect(savedRoutesMock.upsertSavedRouteEffect).toHaveBeenCalledOnce();

		controller.destroy();
		await Promise.resolve();
		expect(wasInterrupted).toBe(true);
	});
});
