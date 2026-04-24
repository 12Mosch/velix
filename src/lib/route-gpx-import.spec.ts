import { describe, expect, it } from "vitest";

import { parseRouteGpx, RouteGpxImportError } from "$lib/route-gpx-import";

const waypointTrackGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Velix tests" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="48.1374" lon="11.5755"><name>Marienplatz, Munich, Germany</name></wpt>
  <wpt lat="47.7123" lon="11.7581"><name>Tegernsee, Germany</name></wpt>
  <wpt lat="47.7362" lon="11.8598"><name>Schliersee, Germany</name></wpt>
  <trk>
    <trkseg>
      <trkpt lat="48.1374" lon="11.5755"><ele>520</ele><time>2026-04-22T08:00:00Z</time></trkpt>
      <trkpt lat="47.7123" lon="11.7581"><ele>734</ele><time>2026-04-22T09:15:00Z</time></trkpt>
      <trkpt lat="47.7362" lon="11.8598"><ele>785</ele><time>2026-04-22T10:45:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;
const trackOnlyGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Velix tests" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="48.1374" lon="11.5755"><ele>520</ele></trkpt>
      <trkpt lat="48.1000" lon="11.6200"><ele>545</ele></trkpt>
      <trkpt lat="47.7362" lon="11.8598"><ele>785</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;
const routePointGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Velix tests" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>Route point import</name>
    <rtept lat="48.1374" lon="11.5755"><name>Munich start</name><ele>520</ele></rtept>
    <rtept lat="47.7123" lon="11.7581"><name>Tegernsee, Germany</name><ele>734</ele></rtept>
    <rtept lat="47.7362" lon="11.8598"><name>Schliersee, Germany</name><ele>785</ele></rtept>
  </rte>
</gpx>`;
const closedLoopTrackGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Velix tests" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="48.1374" lon="11.5755"><ele>520</ele></trkpt>
      <trkpt lat="48.1500" lon="11.6200"><ele>580</ele></trkpt>
      <trkpt lat="48.1100" lon="11.6700"><ele>610</ele></trkpt>
      <trkpt lat="48.13745" lon="11.57555"><ele>521</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;
const outAndBackGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Velix tests" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="48.1374" lon="11.5755"><name>Marienplatz, Munich, Germany</name></wpt>
  <wpt lat="47.7362" lon="11.8598"><name>Schliersee, Germany</name></wpt>
  <trk>
    <trkseg>
      <trkpt lat="48.1374" lon="11.5755"><ele>520</ele></trkpt>
      <trkpt lat="48.0200" lon="11.7000"><ele>575</ele></trkpt>
      <trkpt lat="47.7362" lon="11.8598"><ele>785</ele></trkpt>
      <trkpt lat="48.0200" lon="11.7000"><ele>575</ele></trkpt>
      <trkpt lat="48.1374" lon="11.5755"><ele>520</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

function expectImportError(
	gpx: string,
	expectedCode: RouteGpxImportError["code"],
): RouteGpxImportError {
	try {
		parseRouteGpx(gpx);
		throw new Error("Expected GPX import to fail.");
	} catch (error) {
		expect(error).toBeInstanceOf(RouteGpxImportError);
		expect((error as RouteGpxImportError).code).toBe(expectedCode);
		return error as RouteGpxImportError;
	}
}

describe("parseRouteGpx", () => {
	it("imports a track with GPX waypoints into an editable point-to-point route", () => {
		const route = parseRouteGpx(waypointTrackGpx, {
			filename: "waypoint-track.gpx",
		});

		expect(route.mode).toBe("point_to_point");
		expect(route.source).toEqual({
			kind: "gpx_import",
			filename: "waypoint-track.gpx",
			stopDerivation: "wpt",
			hasDuration: true,
		});
		expect(route.startLabel).toBe("Marienplatz, Munich, Germany");
		expect(route.destinationLabel).toBe("Schliersee, Germany");
		expect(route.waypoints).toEqual([
			{
				label: "Tegernsee, Germany",
				coordinate: [11.7581, 47.7123],
			},
		]);
		expect(route.coordinates).toHaveLength(3);
		expect(route.durationMs).toBe(9900000);
		expect(route.distanceMeters).toBeGreaterThan(0);
		expect(route.ascendMeters).toBe(265);
		expect(route.descendMeters).toBe(0);
	});

	it("accepts track-only GPX files by inferring start and destination", () => {
		const route = parseRouteGpx(trackOnlyGpx, {
			filename: "track-only.gpx",
		});

		expect(route.mode).toBe("point_to_point");
		expect(route.source).toEqual({
			kind: "gpx_import",
			filename: "track-only.gpx",
			stopDerivation: "track",
			hasDuration: false,
		});
		expect(route.startLabel).toBe("48.13740, 11.57550");
		expect(route.destinationLabel).toBe("47.73620, 11.85980");
		expect(route.waypoints).toEqual([]);
		expect(route.durationMs).toBe(0);
	});

	it("uses route points when no track geometry exists", () => {
		const route = parseRouteGpx(routePointGpx, {
			filename: "route-points.gpx",
		});

		expect(route.mode).toBe("point_to_point");
		expect(route.source).toEqual({
			kind: "gpx_import",
			filename: "route-points.gpx",
			stopDerivation: "rtept",
			hasDuration: false,
		});
		expect(route.startLabel).toBe("Munich start");
		expect(route.waypoints).toEqual([
			{
				label: "Tegernsee, Germany",
				coordinate: [11.7581, 47.7123, 734],
			},
		]);
		expect(route.destinationLabel).toBe("Schliersee, Germany");
		expect(route.coordinates).toEqual([
			[11.5755, 48.1374, 520],
			[11.7581, 47.7123, 734],
			[11.8598, 47.7362, 785],
		]);
	});

	it("rejects malformed GPX XML", () => {
		const error = expectImportError(
			`<gpx><trk><trkseg><trkpt lat="48.1374" lon="11.5755"></gpx>`,
			"invalid_xml",
		);

		expect(error.message).toContain("valid GPX XML");
	});

	it("rejects GPX files without usable route geometry", () => {
		const error = expectImportError(
			`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><wpt lat="48.1374" lon="11.5755" /></gpx>`,
			"no_geometry",
		);

		expect(error.message).toContain("route geometry");
	});

	it("rejects GPX files with too many explicit stops", () => {
		const error = expectImportError(
			`<?xml version="1.0" encoding="UTF-8"?>
			<gpx version="1.1" creator="Velix tests">
				<trk><trkseg><trkpt lat="48.1" lon="11.5" /><trkpt lat="47.7" lon="11.9" /></trkseg></trk>
				<wpt lat="48.1" lon="11.5" />
				<wpt lat="48.0" lon="11.6" />
				<wpt lat="47.9" lon="11.7" />
				<wpt lat="47.8" lon="11.8" />
				<wpt lat="47.75" lon="11.85" />
				<wpt lat="47.7" lon="11.9" />
			</gpx>`,
			"too_many_stops",
		);

		expect(error.message).toContain("supports up to 5");
	});

	it("infers closed-loop tracks as round courses when stops are track-derived", () => {
		const route = parseRouteGpx(closedLoopTrackGpx, {
			filename: "loop.gpx",
		});

		expect(route.mode).toBe("round_course");
		expect(route.source).toEqual({
			kind: "gpx_import",
			filename: "loop.gpx",
			stopDerivation: "track",
			hasDuration: false,
		});
		expect(route.startLabel).toBe(route.destinationLabel);
		expect(route.roundCourseTarget).toEqual({
			kind: "distance",
			distanceMeters: Math.round(route.distanceMeters),
		});
		expect(route.waypoints).toEqual([]);
	});

	it("preserves Velix-style exported out-and-back tracks", () => {
		const route = parseRouteGpx(outAndBackGpx, {
			filename: "out-and-back.gpx",
		});

		expect(route.mode).toBe("out_and_back");
		expect(route.source).toEqual({
			kind: "gpx_import",
			filename: "out-and-back.gpx",
			stopDerivation: "wpt",
			hasDuration: false,
		});
		expect(route.startLabel).toBe("Marienplatz, Munich, Germany");
		expect(route.destinationLabel).toBe("Schliersee, Germany");
		expect(route.waypoints).toEqual([
			{
				label: "Schliersee, Germany",
				coordinate: [11.8598, 47.7362],
			},
		]);
	});
});
