import { describe, expect, it } from "vitest";

import {
	buildAvoidancePlaceholderPolygon,
	findAvoidanceNearSelection,
	getDistanceToSegmentMeters,
	isPointNearLine,
} from "./map-selection";

describe("map-selection", () => {
	it("measures click distance to a segment in meters", () => {
		const distance = getDistanceToSegmentMeters(
			[11.001, 48.0005],
			[11, 48],
			[11.002, 48],
		);

		expect(distance).toBeGreaterThan(54);
		expect(distance).toBeLessThan(56);
	});

	it("checks line proximity with the supplied threshold", () => {
		const line: [number, number][] = [
			[11, 48],
			[11.002, 48],
			[11.004, 48],
		];

		expect(isPointNearLine([11.001, 48.0002], line, 25)).toBe(true);
		expect(isPointNearLine([11.001, 48.001], line, 25)).toBe(false);
	});

	it("builds a closed placeholder avoidance polygon around the centerline", () => {
		const polygon = buildAvoidancePlaceholderPolygon(
			[
				[11, 48],
				[11.002, 48.001],
			],
			35,
		);

		expect(polygon).toHaveLength(5);
		expect(polygon[0]).toEqual(polygon[4]);
		expect(polygon[0]?.[0]).toBeLessThan(11);
		expect(polygon[1]?.[0]).toBeGreaterThan(11.002);
		expect(polygon[0]?.[1]).toBeLessThan(48);
		expect(polygon[2]?.[1]).toBeGreaterThan(48.001);
	});

	it("returns an empty placeholder avoidance polygon for an empty centerline", () => {
		const polygon = buildAvoidancePlaceholderPolygon([], 35);

		expect(Array.isArray(polygon)).toBe(true);
		expect(polygon).toHaveLength(0);
	});

	it("matches selected avoidances near the buffered centerline", () => {
		const avoidance = {
			kind: "road_segment" as const,
			label: "Avoided road 1",
			centerline: [
				[11, 48],
				[11.002, 48],
			] satisfies [number, number][],
			bufferMeters: 35,
			polygon: buildAvoidancePlaceholderPolygon(
				[
					[11, 48],
					[11.002, 48],
				],
				35,
			),
		};

		expect(findAvoidanceNearSelection([11.001, 48.0004], [avoidance])).toBe(
			avoidance,
		);
		expect(
			findAvoidanceNearSelection([11.001, 48.002], [avoidance]),
		).toBeNull();
	});

	it("does not match an avoidance with an empty centerline", () => {
		const avoidance = {
			kind: "road_segment" as const,
			label: "Avoided road 1",
			centerline: [] satisfies [number, number][],
			bufferMeters: 35,
			polygon: buildAvoidancePlaceholderPolygon([], 35),
		};

		expect(
			findAvoidanceNearSelection([11.001, 48.0004], [avoidance]),
		).toBeNull();
	});
});
