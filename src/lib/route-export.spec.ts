import { describe, expect, it } from "vitest";

import { buildRouteGpx, buildRouteGpxFilename } from "$lib/route-export";
import type { PlannedRoute } from "$lib/route-planning";

const pointToPointRoute: PlannedRoute = {
	mode: "point_to_point",
	source: {
		kind: "graphhopper",
	},
	startLabel: "Marienplatz, Munich, Germany",
	destinationLabel: "Schliersee, Germany",
	waypoints: [
		{
			label: "Tegernsee, Germany",
			coordinate: [11.7581, 47.7123, 734],
		},
	],
	bounds: [11.5755, 47.7362, 11.8598, 48.1374],
	distanceMeters: 61234,
	durationMs: 9876000,
	ascendMeters: 820,
	descendMeters: 740,
	coordinates: [
		[11.5755, 48.1374, 520],
		[11.62, 48.1, 545],
		[11.68, 48.05, 600],
		[11.75, 47.98, 655],
		[11.81, 47.88, 720],
		[11.8598, 47.7362, 785],
	],
	surfaceDetails: [],
	smoothnessDetails: [],
};

describe("buildRouteGpx", () => {
	it("serializes a point-to-point route as a GPX track with named waypoints", () => {
		const gpx = buildRouteGpx(pointToPointRoute, {
			exportedAt: new Date("2026-04-22T18:30:00.000Z"),
		});

		expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(gpx).toContain('<gpx version="1.1" creator="Velix"');
		expect(gpx).toContain(
			"<name>Marienplatz, Munich, Germany to Schliersee, Germany</name>",
		);
		expect(gpx).toContain("<time>2026-04-22T18:30:00.000Z</time>");
		expect(gpx).toContain(
			'<bounds minlon="11.5755" minlat="47.7362" maxlon="11.8598" maxlat="48.1374" />',
		);
		expect(gpx).toContain('<wpt lat="48.1374" lon="11.5755">');
		expect(gpx).toContain("<name>Tegernsee, Germany</name>");
		expect(gpx).toContain('<wpt lat="47.7362" lon="11.8598">');
		expect(gpx).toContain("<trk>");
		expect(gpx.match(/<trkpt /g)).toHaveLength(
			pointToPointRoute.coordinates.length,
		);
		expect(gpx).toContain('<trkpt lat="48.1374" lon="11.5755">');
		expect(gpx).toContain("<ele>520</ele>");
		expect(gpx).toContain("<ele>785</ele>");
	});

	it("serializes a round course with one start waypoint and the full track", () => {
		const roundCourseRoute: PlannedRoute = {
			...pointToPointRoute,
			mode: "round_course",
			startLabel: "Marienplatz, Munich, Germany",
			destinationLabel: "Marienplatz, Munich, Germany",
			roundCourseTarget: {
				kind: "distance",
				distanceMeters: 50000,
			},
			waypoints: [],
			coordinates: [
				[11.5755, 48.1374, 520],
				[11.62, 48.15, 580],
				[11.67, 48.11, 610],
				[11.5755, 48.1374, 520],
			],
		};

		const gpx = buildRouteGpx(roundCourseRoute, {
			exportedAt: new Date("2026-04-22T18:30:00.000Z"),
		});

		expect(gpx).toContain(
			"<name>Marienplatz, Munich, Germany round course</name>",
		);
		expect(gpx.match(/<wpt /g)).toHaveLength(1);
		expect(gpx).not.toContain("<name>Schliersee, Germany</name>");
		expect(gpx.match(/<trkpt /g)).toHaveLength(
			roundCourseRoute.coordinates.length,
		);
		expect(gpx).toContain('<trkpt lat="48.1374" lon="11.5755">');
	});

	it("serializes an out-and-back route with start and turnaround waypoints", () => {
		const outAndBackRoute: PlannedRoute = {
			...pointToPointRoute,
			mode: "out_and_back",
			destinationLabel: "Schliersee, Germany",
			waypoints: [
				{
					label: "Schliersee, Germany",
					coordinate: [11.8598, 47.7362, 785],
				},
			],
			coordinates: [
				[11.5755, 48.1374, 520],
				[11.8598, 47.7362, 785],
				[11.5755, 48.1374, 520],
			],
		};

		const gpx = buildRouteGpx(outAndBackRoute, {
			exportedAt: new Date("2026-04-22T18:30:00.000Z"),
		});

		expect(gpx).toContain(
			"<name>Marienplatz, Munich, Germany to Schliersee, Germany out and back</name>",
		);
		expect(gpx.match(/<wpt /g)).toHaveLength(2);
		expect(gpx).toContain("<name>Marienplatz, Munich, Germany</name>");
		expect(gpx).toContain("<name>Schliersee, Germany</name>");
		expect(gpx.match(/<trkpt /g)).toHaveLength(
			outAndBackRoute.coordinates.length,
		);
	});

	it("escapes XML-sensitive characters in names and titles", () => {
		const gpx = buildRouteGpx(
			{
				...pointToPointRoute,
				startLabel: `A&B's <Start>`,
				destinationLabel: 'Finish "Line"',
				waypoints: [
					{
						label: "Via & climb",
						coordinate: [11.7581, 47.7123, 734],
					},
				],
			},
			{
				exportedAt: new Date("2026-04-22T18:30:00.000Z"),
				creator: `Velix & "Tests"`,
			},
		);

		expect(gpx).toContain('creator="Velix &amp; &quot;Tests&quot;"');
		expect(gpx).toContain(
			"<name>A&amp;B&apos;s &lt;Start&gt; to Finish &quot;Line&quot;</name>",
		);
		expect(gpx).toContain("<name>Via &amp; climb</name>");
	});

	it("derives metadata bounds when the route bounds are missing at runtime", () => {
		const gpx = buildRouteGpx({
			...pointToPointRoute,
			bounds: undefined as unknown as PlannedRoute["bounds"],
		});

		expect(gpx).toContain(
			'<bounds minlon="11.5755" minlat="47.7362" maxlon="11.8598" maxlat="48.1374" />',
		);
	});

	it("throws when a waypoint coordinate includes a non-finite latitude", () => {
		expect(() =>
			buildRouteGpx({
				...pointToPointRoute,
				waypoints: [
					{
						label: "Broken waypoint",
						coordinate: [11.7581, Number.NaN],
					},
				],
			}),
		).toThrow(
			'Waypoint "Broken waypoint" must include finite longitude and latitude values.',
		);
	});

	it("throws when a track coordinate is missing latitude data", () => {
		expect(() =>
			buildRouteGpx({
				...pointToPointRoute,
				coordinates: [
					pointToPointRoute.coordinates[0],
					[11.62] as unknown as PlannedRoute["coordinates"][number],
					pointToPointRoute.coordinates[
						pointToPointRoute.coordinates.length - 1
					],
				],
			}),
		).toThrow("Route track point 2 is missing longitude/latitude values.");
	});

	it("treats null export options like omitted options", () => {
		const gpx = buildRouteGpx(pointToPointRoute, null);

		expect(gpx).toContain('<gpx version="1.1" creator="Velix"');
		expect(gpx).toContain("<metadata>");
	});
});

describe("buildRouteGpxFilename", () => {
	it("builds a point-to-point filename from the route labels", () => {
		expect(buildRouteGpxFilename(pointToPointRoute)).toBe(
			"marienplatz-munich-germany-to-schliersee-germany.gpx",
		);
	});

	it("builds a round-course filename from the start label", () => {
		expect(
			buildRouteGpxFilename({
				...pointToPointRoute,
				mode: "round_course",
			}),
		).toBe("marienplatz-munich-germany-round-course.gpx");
	});

	it("builds an out-and-back filename from the route labels", () => {
		expect(
			buildRouteGpxFilename({
				...pointToPointRoute,
				mode: "out_and_back",
			}),
		).toBe("marienplatz-munich-germany-to-schliersee-germany-out-and-back.gpx");
	});

	it("falls back when slugging yields an empty filename", () => {
		expect(
			buildRouteGpxFilename({
				...pointToPointRoute,
				startLabel: "!!!",
				destinationLabel: "???",
			}),
		).toBe("velix-route.gpx");
	});
});
