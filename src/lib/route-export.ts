import {
	getRouteStopInputs,
	type PlannedRoute,
	type RouteCoordinate,
	type RouteInstruction,
	type RouteInstructionType,
} from "$lib/route-planning";
import { Encoder, Profile } from "@garmin/fitsdk";
import { Data, Effect } from "effect";

type RouteExportOptions = {
	exportedAt?: Date;
	creator?: string;
};

export class RouteExportError extends Data.TaggedError("RouteExportError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

function normalizeExportOptions(
	options: RouteExportOptions | null | undefined,
): RouteExportOptions {
	return options ?? {};
}

function routeExportFailureMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error ? cause.message : fallback;
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

const normalizeCoordinateEffect = Effect.fn("normalizeCoordinateEffect")(
	function* (
		coordinate: [number, number] | RouteCoordinate,
		context: string,
	): Effect.fn.Return<NormalizedCoordinate, RouteExportError> {
		if (!Array.isArray(coordinate) || coordinate.length < 2) {
			return yield* new RouteExportError({
				message: `${context} is missing longitude/latitude values.`,
			});
		}

		const [longitude, latitude, elevation] = coordinate;

		if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
			return yield* new RouteExportError({
				message: `${context} must include finite longitude and latitude values.`,
			});
		}

		return {
			longitude,
			latitude,
			elevation: Number.isFinite(elevation) ? elevation : undefined,
		};
	},
);

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

const deriveBoundsFromCoordinatesEffect = Effect.fn(
	"deriveBoundsFromCoordinatesEffect",
)(function* (
	coordinates: RouteCoordinate[],
): Effect.fn.Return<PlannedRoute["bounds"] | null, RouteExportError> {
	if (coordinates.length === 0) {
		return null;
	}

	let minLon = Number.POSITIVE_INFINITY;
	let minLat = Number.POSITIVE_INFINITY;
	let maxLon = Number.NEGATIVE_INFINITY;
	let maxLat = Number.NEGATIVE_INFINITY;

	for (const [index, coordinate] of coordinates.entries()) {
		const normalizedCoordinate = yield* normalizeCoordinateEffect(
			coordinate,
			`Route track point ${index + 1}`,
		);

		minLon = Math.min(minLon, normalizedCoordinate.longitude);
		minLat = Math.min(minLat, normalizedCoordinate.latitude);
		maxLon = Math.max(maxLon, normalizedCoordinate.longitude);
		maxLat = Math.max(maxLat, normalizedCoordinate.latitude);
	}

	return [minLon, minLat, maxLon, maxLat];
});

const getTrackCoordinatesEffect = Effect.fn("getTrackCoordinatesEffect")(
	function* (
		route: PlannedRoute,
	): Effect.fn.Return<RouteCoordinate[], RouteExportError> {
		if (!Array.isArray(route.coordinates)) {
			return yield* new RouteExportError({
				message: "Route is missing track coordinates.",
			});
		}

		return route.coordinates;
	},
);

const buildWaypointXmlEffect = Effect.fn("buildWaypointXmlEffect")(function* (
	label: string,
	coordinate: [number, number] | RouteCoordinate,
): Effect.fn.Return<string, RouteExportError> {
	const normalizedCoordinate = yield* normalizeCoordinateEffect(
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
});

const buildCueRoutePointXmlEffect = Effect.fn("buildCueRoutePointXmlEffect")(
	function* (
		instruction: RouteInstruction,
	): Effect.fn.Return<string, RouteExportError> {
		const normalizedCoordinate = yield* normalizeCoordinateEffect(
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
	},
);

const buildCueRouteXmlEffect = Effect.fn("buildCueRouteXmlEffect")(function* (
	route: PlannedRoute,
	title: string,
): Effect.fn.Return<string, RouteExportError> {
	const instructions = route.instructions ?? [];

	if (instructions.length === 0) {
		return "";
	}

	const routePointXml = [];

	for (const instruction of instructions) {
		routePointXml.push(yield* buildCueRoutePointXmlEffect(instruction));
	}

	return [
		"  <rte>",
		`    <name>${escapeXml(title)}</name>`,
		routePointXml.join("\n"),
		"  </rte>",
	].join("\n");
});

export const buildRouteGpxEffect = Effect.fn("buildRouteGpxEffect")(function* (
	route: PlannedRoute,
	options: RouteExportOptions | null = {},
): Effect.fn.Return<string, RouteExportError> {
	const normalizedOptions = normalizeExportOptions(options);
	const exportedAt = normalizedOptions.exportedAt ?? new Date();
	const creator = normalizedOptions.creator ?? "Velix";
	const title = formatRouteTitle(route);
	const coordinates = yield* getTrackCoordinatesEffect(route);
	const bounds =
		normalizeBounds(route.bounds) ??
		(yield* deriveBoundsFromCoordinatesEffect(coordinates));
	const waypointXmlParts = [];

	for (const stop of getRouteStopInputs(route)) {
		if (stop.point) {
			waypointXmlParts.push(
				yield* buildWaypointXmlEffect(stop.label, stop.point),
			);
		}
	}

	const waypointXml = waypointXmlParts.join("\n");
	const trackPointXmlParts = [];

	for (const [index, coordinate] of coordinates.entries()) {
		trackPointXmlParts.push(yield* buildTrackPointXmlEffect(coordinate, index));
	}

	const trackPointXml = trackPointXmlParts.join("\n");
	const waypointBlock = waypointXml ? `${waypointXml}\n` : "";
	const cueRouteXml = yield* buildCueRouteXmlEffect(route, title);
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
});

const buildTrackPointXmlEffect = Effect.fn("buildTrackPointXmlEffect")(
	function* (
		coordinate: RouteCoordinate,
		index: number,
	): Effect.fn.Return<string, RouteExportError> {
		const normalizedCoordinate = yield* normalizeCoordinateEffect(
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
	},
);

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

const normalizeTrackCoordinatesEffect = Effect.fn(
	"normalizeTrackCoordinatesEffect",
)(function* (
	route: PlannedRoute,
): Effect.fn.Return<NormalizedCoordinate[], RouteExportError> {
	const coordinates = yield* getTrackCoordinatesEffect(route);
	const normalizedCoordinates = [];

	for (const [index, coordinate] of coordinates.entries()) {
		normalizedCoordinates.push(
			yield* normalizeCoordinateEffect(
				coordinate,
				`Route track point ${index + 1}`,
			),
		);
	}

	return normalizedCoordinates;
});

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

const closeFitEncoderEffect = Effect.fn("closeFitEncoderEffect")(
	function* (encoder: {
		close(): Uint8Array;
	}): Effect.fn.Return<Uint8Array, RouteExportError> {
		return yield* Effect.try({
			try: () => encoder.close(),
			catch: (cause) =>
				new RouteExportError({
					message: routeExportFailureMessage(
						cause,
						"Could not encode FIT route.",
					),
					cause,
				}),
		});
	},
);

export const buildRouteFitEffect = Effect.fn("buildRouteFitEffect")(function* (
	route: PlannedRoute,
	options: RouteExportOptions | null = {},
): Effect.fn.Return<Uint8Array, RouteExportError> {
	const normalizedOptions = normalizeExportOptions(options);
	const exportedAt = normalizedOptions.exportedAt ?? new Date();
	const title = formatRouteTitle(route);
	const coordinates = yield* normalizeTrackCoordinatesEffect(route);
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
		const coordinate = yield* normalizeCoordinateEffect(
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

	return yield* closeFitEncoderEffect(encoder);
});

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
	const gpxFilename = buildRouteGpxFilename(route);
	return gpxFilename.replace(/\.gpx$/u, ".fit");
}

const clickDownloadLinkEffect = Effect.fn("clickDownloadLinkEffect")(function* (
	link: HTMLAnchorElement,
): Effect.fn.Return<void, RouteExportError> {
	return yield* Effect.try({
		try: () => {
			link.click();
		},
		catch: (cause) =>
			new RouteExportError({
				message: routeExportFailureMessage(
					cause,
					"Could not start route download.",
				),
				cause,
			}),
	});
});

export const downloadRouteGpxEffect = Effect.fn("downloadRouteGpxEffect")(
	function* (
		route: PlannedRoute,
		options: RouteExportOptions | null = {},
	): Effect.fn.Return<void, RouteExportError> {
		const normalizedOptions = normalizeExportOptions(options);
		const gpx = yield* buildRouteGpxEffect(route, normalizedOptions);
		const objectUrl = yield* Effect.try({
			try: () => {
				const blob = new Blob([gpx], {
					type: "application/gpx+xml;charset=utf-8",
				});
				return URL.createObjectURL(blob);
			},
			catch: (cause) =>
				new RouteExportError({
					message: routeExportFailureMessage(
						cause,
						"Could not create GPX download.",
					),
					cause,
				}),
		});

		return yield* Effect.gen(function* () {
			const link = yield* Effect.try({
				try: () => document.createElement("a"),
				catch: (cause) =>
					new RouteExportError({
						message: routeExportFailureMessage(
							cause,
							"Could not create GPX download link.",
						),
						cause,
					}),
			});

			link.href = objectUrl;
			link.download = buildRouteGpxFilename(route);
			yield* clickDownloadLinkEffect(link);
		}).pipe(
			Effect.ensuring(
				Effect.sync(() => {
					URL.revokeObjectURL(objectUrl);
				}),
			),
		);
	},
);

export const downloadRouteFitEffect = Effect.fn("downloadRouteFitEffect")(
	function* (
		route: PlannedRoute,
		options: RouteExportOptions | null = {},
	): Effect.fn.Return<void, RouteExportError> {
		const normalizedOptions = normalizeExportOptions(options);
		const fit = yield* buildRouteFitEffect(route, normalizedOptions);
		const objectUrl = yield* Effect.try({
			try: () => {
				const fitBlobPart = fit.buffer.slice(
					fit.byteOffset,
					fit.byteOffset + fit.byteLength,
				) as ArrayBuffer;
				const blob = new Blob([fitBlobPart], {
					type: FIT_MIME_TYPE,
				});
				return URL.createObjectURL(blob);
			},
			catch: (cause) =>
				new RouteExportError({
					message: routeExportFailureMessage(
						cause,
						"Could not create FIT download.",
					),
					cause,
				}),
		});

		return yield* Effect.gen(function* () {
			const link = yield* Effect.try({
				try: () => document.createElement("a"),
				catch: (cause) =>
					new RouteExportError({
						message: routeExportFailureMessage(
							cause,
							"Could not create FIT download link.",
						),
						cause,
					}),
			});

			link.href = objectUrl;
			link.download = buildRouteFitFilename(route);
			yield* clickDownloadLinkEffect(link);
		}).pipe(
			Effect.ensuring(
				Effect.sync(() => {
					URL.revokeObjectURL(objectUrl);
				}),
			),
		);
	},
);
