import { describe, expect, it } from "vitest";

import { getSurfaceMix, type PlannedRoute } from "./route-planning";

function buildRoute(surfaceDetails: PlannedRoute["surfaceDetails"]): PlannedRoute {
	return {
		startLabel: "Start",
		destinationLabel: "Destination",
		bounds: [0, 0, 1, 1],
		distanceMeters: 1000,
		durationMs: 120000,
		ascendMeters: 10,
		descendMeters: 10,
		coordinates: [
			[0, 0, 10],
			[1, 1, 20],
		],
		surfaceDetails,
		smoothnessDetails: [],
	};
}

describe("getSurfaceMix", () => {
	it("calculates the coarse percentage from its own share instead of subtracting from 100", () => {
		const route = buildRoute([
			{ from: 0, to: 333, value: "ASPHALT" },
			{ from: 333, to: 666, value: "COMPACTED" },
			{ from: 666, to: 1000, value: "DIRT" },
		]);

		expect(getSurfaceMix(route)).toEqual([
			{ label: "Smooth asphalt", pct: 33, className: "bg-emerald-500" },
			{ label: "Mixed / worn", pct: 33, className: "bg-amber-500" },
			{ label: "Coarse / rough", pct: 33, className: "bg-orange-600" },
		]);
	});
});
