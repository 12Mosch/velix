import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";

import type { PlannedRoute, RouteCoordinate } from "$lib/route-planning";
import type { PlannerAnalysisController } from "./planner-analysis-controller.svelte";
import PlannerAnalysisControllerHarness from "./planner-analysis-controller-harness.svelte";

function createTrackedRoute(onCoordinateRead: () => void): PlannedRoute {
	const coordinates = new Proxy(
		[
			[11.5, 47.2, 500],
			[11.55, 47.25, 560],
			[11.6, 47.3, 620],
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

	return {
		mode: "point_to_point",
		source: { kind: "graphhopper" },
		startLabel: "Start",
		destinationLabel: "Finish",
		routingWarnings: [],
		waypoints: [],
		bounds: [11.5, 47.2, 11.6, 47.3],
		distanceMeters: 12_000,
		durationMs: 1_800_000,
		ascendMeters: 180,
		descendMeters: 120,
		coordinates,
		instructions: [],
		surfaceDetails: [],
		smoothnessDetails: [],
	};
}

describe("planner analysis controller lazy profile work", () => {
	it("does not sample chart profile data during construction or cheap reads", () => {
		let coordinateReads = 0;
		const activeRoute = createTrackedRoute(() => {
			coordinateReads += 1;
		});
		let controller!: PlannerAnalysisController;

		render(PlannerAnalysisControllerHarness, {
			activeRoute,
			onController: (nextController) => {
				controller = nextController;
			},
		});

		expect(controller.directionsOpen).toBe(false);
		expect(controller.routeAnalysisOpen).toBe(false);
		expect(controller.selectedCue).toBeNull();
		expect(controller.activeProfilePoint).toBeNull();
		expect(coordinateReads).toBe(0);

		expect(controller.chartProfilePoints.length).toBeGreaterThan(0);
		expect(coordinateReads).toBeGreaterThan(0);
	});
});
