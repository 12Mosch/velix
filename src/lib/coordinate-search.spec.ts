import { describe, expect, it } from "vitest";

import { parseCoordinateSearchInput } from "./coordinate-search";

describe("parseCoordinateSearchInput", () => {
	it("parses comma-separated decimal coordinates", () => {
		expect(parseCoordinateSearchInput("48.1374, 11.5755")).toEqual({
			kind: "coordinate",
			label: "48.13740, 11.57550",
			point: [11.5755, 48.1374],
		});
	});

	it("parses whitespace-separated decimal coordinates", () => {
		expect(parseCoordinateSearchInput("48.1374 11.5755")).toEqual({
			kind: "coordinate",
			label: "48.13740, 11.57550",
			point: [11.5755, 48.1374],
		});
	});

	it("parses labeled lat/lng coordinates", () => {
		expect(parseCoordinateSearchInput("lat: 48.1374 lng: 11.5755")).toEqual({
			kind: "coordinate",
			label: "48.13740, 11.57550",
			point: [11.5755, 48.1374],
		});
	});

	it("parses labeled latitude/longitude coordinates", () => {
		expect(
			parseCoordinateSearchInput("latitude: 48.1374 longitude: 11.5755"),
		).toEqual({
			kind: "coordinate",
			label: "48.13740, 11.57550",
			point: [11.5755, 48.1374],
		});
	});

	it("accepts labeled coordinates in either order", () => {
		expect(parseCoordinateSearchInput("lng: 11.5755 lat: 48.1374")).toEqual({
			kind: "coordinate",
			label: "48.13740, 11.57550",
			point: [11.5755, 48.1374],
		});
	});

	it("treats unlabeled pairs as latitude, longitude", () => {
		expect(parseCoordinateSearchInput("11.5755, 48.1374")).toEqual({
			kind: "coordinate",
			label: "11.57550, 48.13740",
			point: [48.1374, 11.5755],
		});
	});

	it("rejects out-of-range latitude and longitude values", () => {
		expect(parseCoordinateSearchInput("91, 11")).toMatchObject({
			kind: "invalid_coordinate",
		});
		expect(parseCoordinateSearchInput("48, 181")).toMatchObject({
			kind: "invalid_coordinate",
		});
		expect(parseCoordinateSearchInput("lat: -91 lng: 11")).toMatchObject({
			kind: "invalid_coordinate",
		});
		expect(parseCoordinateSearchInput("lat: 48 lng: -181")).toMatchObject({
			kind: "invalid_coordinate",
		});
	});

	it("does not parse single numbers, place names, URLs, or DMS-style strings", () => {
		expect(parseCoordinateSearchInput("48.1374")).toEqual({
			kind: "not_coordinate",
		});
		expect(parseCoordinateSearchInput("Marienplatz Munich")).toEqual({
			kind: "not_coordinate",
		});
		expect(parseCoordinateSearchInput("Latitude 38")).toEqual({
			kind: "not_coordinate",
		});
		expect(parseCoordinateSearchInput("Long 5th Street")).toEqual({
			kind: "not_coordinate",
		});
		expect(parseCoordinateSearchInput("Longitude 131 Resort")).toEqual({
			kind: "not_coordinate",
		});
		expect(
			parseCoordinateSearchInput(
				"https://www.openstreetmap.org/#map=16/48.1374/11.5755",
			),
		).toEqual({
			kind: "not_coordinate",
		});
		expect(parseCoordinateSearchInput("48° 8' 14\" N 11° 34' 31\" E")).toEqual({
			kind: "not_coordinate",
		});
	});
});
