import {
	getRouteStopInputs,
	type PlannedRoute,
	type RouteCoordinate,
} from "$lib/route-planning";

type RouteExportOptions = {
	exportedAt?: Date;
	creator?: string;
};

function normalizeExportOptions(
	options: RouteExportOptions | null | undefined,
): RouteExportOptions {
	return options ?? {};
}

type NormalizedCoordinate = {
	longitude: number;
	latitude: number;
	elevation?: number;
};

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function formatRouteTitle(route: PlannedRoute): string {
	return route.mode === "round_course"
		? `${route.startLabel} round course`
		: `${route.startLabel} to ${route.destinationLabel}`;
}

function toSlugPart(value: string): string {
	return value
		.normalize("NFKD")
		.replaceAll(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "");
}

function normalizeCoordinate(
	coordinate: [number, number] | RouteCoordinate,
	context: string,
): NormalizedCoordinate {
	if (!Array.isArray(coordinate) || coordinate.length < 2) {
		throw new Error(`${context} is missing longitude/latitude values.`);
	}

	const [longitude, latitude, elevation] = coordinate;

	if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
		throw new Error(
			`${context} must include finite longitude and latitude values.`,
		);
	}

	return {
		longitude,
		latitude,
		elevation: Number.isFinite(elevation) ? elevation : undefined,
	};
}

function normalizeBounds(
	bounds: PlannedRoute["bounds"] | undefined,
): PlannedRoute["bounds"] | null {
	if (
		!Array.isArray(bounds) ||
		bounds.length !== 4 ||
		!bounds.every((value) => Number.isFinite(value))
	) {
		return null;
	}

	return bounds;
}

function deriveBoundsFromCoordinates(
	coordinates: RouteCoordinate[],
): PlannedRoute["bounds"] | null {
	if (coordinates.length === 0) {
		return null;
	}

	let minLon = Number.POSITIVE_INFINITY;
	let minLat = Number.POSITIVE_INFINITY;
	let maxLon = Number.NEGATIVE_INFINITY;
	let maxLat = Number.NEGATIVE_INFINITY;

	for (const [index, coordinate] of coordinates.entries()) {
		const normalizedCoordinate = normalizeCoordinate(
			coordinate,
			`Route track point ${index + 1}`,
		);

		minLon = Math.min(minLon, normalizedCoordinate.longitude);
		minLat = Math.min(minLat, normalizedCoordinate.latitude);
		maxLon = Math.max(maxLon, normalizedCoordinate.longitude);
		maxLat = Math.max(maxLat, normalizedCoordinate.latitude);
	}

	return [minLon, minLat, maxLon, maxLat];
}

function getTrackCoordinates(route: PlannedRoute): RouteCoordinate[] {
	if (!Array.isArray(route.coordinates)) {
		throw new Error("Route is missing track coordinates.");
	}

	return route.coordinates;
}

function buildWaypointXml(
	label: string,
	coordinate: [number, number] | RouteCoordinate,
): string {
	const normalizedCoordinate = normalizeCoordinate(
		coordinate,
		`Waypoint "${label}"`,
	);
	const elevationXml = Number.isFinite(normalizedCoordinate.elevation)
		? `\n    <ele>${normalizedCoordinate.elevation}</ele>`
		: "";

	return [
		`  <wpt lat="${normalizedCoordinate.latitude}" lon="${normalizedCoordinate.longitude}">`,
		elevationXml,
		`    <name>${escapeXml(label)}</name>`,
		"  </wpt>",
	]
		.filter(Boolean)
		.join("\n");
}

export function buildRouteGpx(
	route: PlannedRoute,
	options: RouteExportOptions | null = {},
): string {
	const normalizedOptions = normalizeExportOptions(options);
	const exportedAt = normalizedOptions.exportedAt ?? new Date();
	const creator = normalizedOptions.creator ?? "Velix";
	const title = formatRouteTitle(route);
	const coordinates = getTrackCoordinates(route);
	const bounds =
		normalizeBounds(route.bounds) ?? deriveBoundsFromCoordinates(coordinates);
	const waypointXml = getRouteStopInputs(route)
		.map((stop) =>
			stop.point ? buildWaypointXml(stop.label, stop.point) : null,
		)
		.filter((value): value is string => value !== null)
		.join("\n");
	const trackPointXml = coordinates
		.map((coordinate, index) => buildTrackPointXml(coordinate, index))
		.join("\n");
	const waypointBlock = waypointXml ? `${waypointXml}\n` : "";
	const boundsXml = bounds
		? `    <bounds minlon="${bounds[0]}" minlat="${bounds[1]}" maxlon="${bounds[2]}" maxlat="${bounds[3]}" />`
		: "";

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<gpx version="1.1" creator="${escapeXml(creator)}" xmlns="http://www.topografix.com/GPX/1/1">`,
		"  <metadata>",
		`    <name>${escapeXml(title)}</name>`,
		`    <time>${exportedAt.toISOString()}</time>`,
		boundsXml,
		"  </metadata>",
		waypointBlock.trimEnd(),
		"  <trk>",
		`    <name>${escapeXml(title)}</name>`,
		"    <trkseg>",
		trackPointXml,
		"    </trkseg>",
		"  </trk>",
		"</gpx>",
	]
		.filter(Boolean)
		.join("\n");
}

function buildTrackPointXml(
	coordinate: RouteCoordinate,
	index: number,
): string {
	const normalizedCoordinate = normalizeCoordinate(
		coordinate,
		`Route track point ${index + 1}`,
	);
	const elevationXml = Number.isFinite(normalizedCoordinate.elevation)
		? `\n      <ele>${normalizedCoordinate.elevation}</ele>`
		: "";

	return [
		`    <trkpt lat="${normalizedCoordinate.latitude}" lon="${normalizedCoordinate.longitude}">`,
		elevationXml,
		"    </trkpt>",
	]
		.filter(Boolean)
		.join("\n");
}

export function buildRouteGpxFilename(route: PlannedRoute): string {
	const startSlug = toSlugPart(route.startLabel);

	if (route.mode === "round_course") {
		return startSlug ? `${startSlug}-round-course.gpx` : "velix-route.gpx";
	}

	const destinationSlug = toSlugPart(route.destinationLabel);

	if (!startSlug || !destinationSlug) {
		return "velix-route.gpx";
	}

	return `${startSlug}-to-${destinationSlug}.gpx`;
}

export function downloadRouteGpx(
	route: PlannedRoute,
	options: RouteExportOptions | null = {},
): void {
	const normalizedOptions = normalizeExportOptions(options);
	const gpx = buildRouteGpx(route, normalizedOptions);
	const blob = new Blob([gpx], {
		type: "application/gpx+xml;charset=utf-8",
	});
	const objectUrl = URL.createObjectURL(blob);
	const link = document.createElement("a");

	try {
		link.href = objectUrl;
		link.download = buildRouteGpxFilename(route);
		link.click();
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}
