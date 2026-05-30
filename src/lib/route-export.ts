import {
	getRouteStopInputs,
	type PlannedRoute,
	type RouteCoordinate,
	type RouteInstruction,
	type RouteInstructionType,
} from "$lib/route-planning";
import { Effect } from "effect";
import { Encoder, Profile } from "@garmin/fitsdk";

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

const FIT_MIME_TYPE = "application/vnd.ant.fit";
const SEMICIRCLES_PER_DEGREE = 2 ** 31 / 180;
const EARTH_RADIUS_METERS = 6_371_000;

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function formatRouteTitle(route: PlannedRoute): string {
	if (route.mode === "round_course") {
		return `${route.startLabel} round course`;
	}

	if (route.mode === "out_and_back") {
		return `${route.startLabel} to ${route.destinationLabel} out and back`;
	}

	return `${route.startLabel} to ${route.destinationLabel}`;
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

function buildCueRoutePointXml(instruction: RouteInstruction): string {
	const normalizedCoordinate = normalizeCoordinate(
		instruction.coordinate,
		`Cue "${instruction.text}"`,
	);
	const elevationXml = Number.isFinite(normalizedCoordinate.elevation)
		? `\n    <ele>${normalizedCoordinate.elevation}</ele>`
		: "";

	return [
		`  <rtept lat="${normalizedCoordinate.latitude}" lon="${normalizedCoordinate.longitude}">`,
		elevationXml,
		`    <name>${escapeXml(instruction.text)}</name>`,
		"    <extensions>",
		`      <velix:cue distanceFromStartMeters="${escapeXml(String(instruction.distanceFromStartMeters))}" segmentDistanceMeters="${escapeXml(String(instruction.segmentDistanceMeters))}" segmentTimeMs="${escapeXml(String(instruction.segmentTimeMs))}" sign="${escapeXml(String(instruction.sign))}" type="${escapeXml(instruction.type)}" coordinateIndex="${escapeXml(String(instruction.coordinateIndex))}" />`,
		"    </extensions>",
		"  </rtept>",
	]
		.filter(Boolean)
		.join("\n");
}

function buildCueRouteXml(route: PlannedRoute, title: string): string {
	const instructions = route.instructions ?? [];

	if (instructions.length === 0) {
		return "";
	}

	return [
		"  <rte>",
		`    <name>${escapeXml(title)}</name>`,
		instructions.map(buildCueRoutePointXml).join("\n"),
		"  </rte>",
	].join("\n");
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
	const waypointXml = Effect.runSync(getRouteStopInputs(route))
		.map((stop) =>
			stop.point ? buildWaypointXml(stop.label, stop.point) : null,
		)
		.filter((value): value is string => value !== null)
		.join("\n");
	const trackPointXml = coordinates
		.map((coordinate, index) => buildTrackPointXml(coordinate, index))
		.join("\n");
	const waypointBlock = waypointXml ? `${waypointXml}\n` : "";
	const cueRouteXml = buildCueRouteXml(route, title);
	const cueRouteBlock = cueRouteXml ? `${cueRouteXml}\n` : "";
	const boundsXml = bounds
		? `    <bounds minlon="${bounds[0]}" minlat="${bounds[1]}" maxlon="${bounds[2]}" maxlat="${bounds[3]}" />`
		: "";
	const cueNamespace =
		(route.instructions?.length ?? 0) > 0
			? ' xmlns:velix="https://velix.app/gpx/1"'
			: "";

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<gpx version="1.1" creator="${escapeXml(creator)}" xmlns="http://www.topografix.com/GPX/1/1"${cueNamespace}>`,
		"  <metadata>",
		`    <name>${escapeXml(title)}</name>`,
		`    <time>${exportedAt.toISOString()}</time>`,
		boundsXml,
		"  </metadata>",
		waypointBlock.trimEnd(),
		cueRouteBlock.trimEnd(),
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

function toSemicircles(degrees: number): number {
	return Math.round(degrees * SEMICIRCLES_PER_DEGREE);
}

function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function distanceBetweenMeters(
	start: NormalizedCoordinate,
	end: NormalizedCoordinate,
): number {
	const deltaLatitude = toRadians(end.latitude - start.latitude);
	const deltaLongitude = toRadians(end.longitude - start.longitude);
	const startLatitude = toRadians(start.latitude);
	const endLatitude = toRadians(end.latitude);
	const halfChord =
		Math.sin(deltaLatitude / 2) ** 2 +
		Math.cos(startLatitude) *
			Math.cos(endLatitude) *
			Math.sin(deltaLongitude / 2) ** 2;

	return (
		2 *
		EARTH_RADIUS_METERS *
		Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord))
	);
}

function normalizeTrackCoordinates(
	route: PlannedRoute,
): NormalizedCoordinate[] {
	return getTrackCoordinates(route).map((coordinate, index) =>
		normalizeCoordinate(coordinate, `Route track point ${index + 1}`),
	);
}

function deriveCumulativeDistances(
	coordinates: NormalizedCoordinate[],
): number[] {
	const distances = [0];

	for (let index = 1; index < coordinates.length; index += 1) {
		distances.push(
			distances[index - 1] +
				distanceBetweenMeters(coordinates[index - 1], coordinates[index]),
		);
	}

	return distances;
}

function deriveTimestamp(
	exportedAt: Date,
	index: number,
	distance: number,
	totalDistance: number,
	durationMs: number,
): Date {
	const offsetMs =
		Number.isFinite(durationMs) && durationMs > 0
			? totalDistance > 0
				? (distance / totalDistance) * durationMs
				: 0
			: index * 1000;

	return new Date(exportedAt.getTime() + Math.round(offsetMs));
}

function mapInstructionTypeToFitCoursePoint(
	type: RouteInstructionType,
): string {
	switch (type) {
		case "left":
			return "left";
		case "right":
			return "right";
		case "slight_left":
			return "slightLeft";
		case "slight_right":
			return "slightRight";
		case "sharp_left":
			return "sharpLeft";
		case "sharp_right":
			return "sharpRight";
		case "u_turn":
			return "uTurn";
		case "continue":
			return "straight";
		case "keep_left":
			return "leftFork";
		case "keep_right":
			return "rightFork";
		default:
			return "generic";
	}
}

function truncateFitCoursePointName(name: string): string {
	const maxLength = 16;

	return name.length > maxLength
		? name.slice(0, maxLength - 1).trimEnd()
		: name;
}

function isFiniteNonNegativeInteger(value: number): boolean {
	return Number.isFinite(value) && value >= 0 && value <= 0xffff;
}

export function buildRouteFit(
	route: PlannedRoute,
	options: RouteExportOptions | null = {},
): Uint8Array {
	const normalizedOptions = normalizeExportOptions(options);
	const exportedAt = normalizedOptions.exportedAt ?? new Date();
	const title = formatRouteTitle(route);
	const coordinates = normalizeTrackCoordinates(route);
	const cumulativeDistances = deriveCumulativeDistances(coordinates);
	const totalDistance = cumulativeDistances.at(-1) ?? 0;
	const durationMs =
		Number.isFinite(route.durationMs) && route.durationMs > 0
			? route.durationMs
			: Math.max(0, coordinates.length - 1) * 1000;
	const encoder = new Encoder();

	encoder.onMesg(Profile.MesgNum.FILE_ID, {
		type: "course",
		manufacturer: "development",
		product: 1,
		productName: "Velix",
		timeCreated: exportedAt,
	});
	encoder.onMesg(Profile.MesgNum.COURSE, {
		name: title,
		sport: "cycling",
	});

	for (const [index, instruction] of (route.instructions ?? []).entries()) {
		const coordinate = normalizeCoordinate(
			instruction.coordinate,
			`Cue "${instruction.text}"`,
		);
		const safeDistance = Number.isFinite(route.distanceMeters)
			? route.distanceMeters
			: totalDistance;
		encoder.onMesg(Profile.MesgNum.COURSE_POINT, {
			messageIndex: index,
			timestamp: deriveTimestamp(
				exportedAt,
				instruction.coordinateIndex,
				instruction.distanceFromStartMeters,
				Math.max(safeDistance, totalDistance),
				route.durationMs,
			),
			positionLat: toSemicircles(coordinate.latitude),
			positionLong: toSemicircles(coordinate.longitude),
			distance: instruction.distanceFromStartMeters,
			type: mapInstructionTypeToFitCoursePoint(instruction.type),
			name: truncateFitCoursePointName(instruction.text),
		});
	}

	for (const [index, coordinate] of coordinates.entries()) {
		const record: {
			timestamp: Date;
			positionLat: number;
			positionLong: number;
			distance: number;
			altitude?: number;
		} = {
			timestamp: deriveTimestamp(
				exportedAt,
				index,
				cumulativeDistances[index],
				totalDistance,
				route.durationMs,
			),
			positionLat: toSemicircles(coordinate.latitude),
			positionLong: toSemicircles(coordinate.longitude),
			distance: cumulativeDistances[index],
		};

		if (Number.isFinite(coordinate.elevation)) {
			record.altitude = coordinate.elevation;
		}

		encoder.onMesg(Profile.MesgNum.RECORD, record);
	}

	const firstCoordinate = coordinates[0];
	const lastCoordinate = coordinates.at(-1);

	if (firstCoordinate && lastCoordinate) {
		const lap: {
			timestamp: Date;
			startTime: Date;
			startPositionLat: number;
			startPositionLong: number;
			endPositionLat: number;
			endPositionLong: number;
			totalElapsedTime: number;
			totalTimerTime: number;
			totalDistance: number;
			event: string;
			eventType: string;
			sport: string;
			totalAscent?: number;
			totalDescent?: number;
		} = {
			timestamp: deriveTimestamp(
				exportedAt,
				coordinates.length - 1,
				totalDistance,
				totalDistance,
				route.durationMs,
			),
			startTime: exportedAt,
			startPositionLat: toSemicircles(firstCoordinate.latitude),
			startPositionLong: toSemicircles(firstCoordinate.longitude),
			endPositionLat: toSemicircles(lastCoordinate.latitude),
			endPositionLong: toSemicircles(lastCoordinate.longitude),
			totalElapsedTime: durationMs / 1000,
			totalTimerTime: durationMs / 1000,
			totalDistance,
			event: "lap",
			eventType: "stop",
			sport: "cycling",
		};

		if (isFiniteNonNegativeInteger(route.ascendMeters)) {
			lap.totalAscent = Math.round(route.ascendMeters);
		}

		if (isFiniteNonNegativeInteger(route.descendMeters)) {
			lap.totalDescent = Math.round(route.descendMeters);
		}

		encoder.onMesg(Profile.MesgNum.LAP, lap);
	}

	return encoder.close();
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

	if (route.mode === "out_and_back") {
		return `${startSlug}-to-${destinationSlug}-out-and-back.gpx`;
	}

	return `${startSlug}-to-${destinationSlug}.gpx`;
}

export function buildRouteFitFilename(route: PlannedRoute): string {
	return buildRouteGpxFilename(route).replace(/\.gpx$/u, ".fit");
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

export function downloadRouteFit(
	route: PlannedRoute,
	options: RouteExportOptions | null = {},
): void {
	const normalizedOptions = normalizeExportOptions(options);
	const fit = buildRouteFit(route, normalizedOptions);
	const fitBlobPart = fit.buffer.slice(
		fit.byteOffset,
		fit.byteOffset + fit.byteLength,
	) as ArrayBuffer;
	const blob = new Blob([fitBlobPart], {
		type: FIT_MIME_TYPE,
	});
	const objectUrl = URL.createObjectURL(blob);
	const link = document.createElement("a");

	try {
		link.href = objectUrl;
		link.download = buildRouteFitFilename(route);
		link.click();
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}
