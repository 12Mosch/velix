import type {
	ImportedRouteStopDerivation,
	PlannedRoute,
	RouteCoordinate,
} from "$lib/route-planning";

type ParsedGpxPoint = {
	coordinate: RouteCoordinate;
	label?: string;
	timestampMs?: number;
};

type ParseRouteGpxOptions = {
	filename?: string;
};

export type RouteGpxImportErrorCode =
	| "invalid_xml"
	| "no_geometry"
	| "too_many_stops";

export class RouteGpxImportError extends Error {
	code: RouteGpxImportErrorCode;

	constructor(code: RouteGpxImportErrorCode, message: string) {
		super(message);
		this.name = "RouteGpxImportError";
		this.code = code;
	}
}

const maxRoutePoints = 5;
const loopClosureThresholdMeters = 50;
const defaultFilename = "imported-route.gpx";
const parserErrorNamespace =
	"http://www.mozilla.org/newlayout/xml/parsererror.xml";

function formatCoordinateLabel(point: [number, number]) {
	return `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
}

function toRadians(value: number) {
	return (value * Math.PI) / 180;
}

function getCoordinateDistanceMeters(
	from: [number, number],
	to: [number, number],
): number {
	const [fromLon, fromLat] = from;
	const [toLon, toLat] = to;
	const latitudeDelta = toRadians(toLat - fromLat);
	const longitudeDelta = toRadians(toLon - fromLon);
	const fromLatitudeRadians = toRadians(fromLat);
	const toLatitudeRadians = toRadians(toLat);
	const haversineA =
		Math.sin(latitudeDelta / 2) ** 2 +
		Math.cos(fromLatitudeRadians) *
			Math.cos(toLatitudeRadians) *
			Math.sin(longitudeDelta / 2) ** 2;
	const haversineC =
		2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));

	return 6371008.8 * haversineC;
}

function getPointCoordinate(point: RouteCoordinate): [number, number] {
	return [point[0], point[1]];
}

function getFirstFiniteTimestamp(points: ParsedGpxPoint[]): number | null {
	for (const point of points) {
		if (
			typeof point.timestampMs === "number" &&
			Number.isFinite(point.timestampMs)
		) {
			return point.timestampMs;
		}
	}

	return null;
}

function getLastFiniteTimestamp(points: ParsedGpxPoint[]): number | null {
	for (let index = points.length - 1; index >= 0; index -= 1) {
		const point = points[index];

		if (
			typeof point?.timestampMs === "number" &&
			Number.isFinite(point.timestampMs)
		) {
			return point.timestampMs;
		}
	}

	return null;
}

function getParsedPointLabel(point: ParsedGpxPoint): string {
	return (
		point.label?.trim() ||
		formatCoordinateLabel(getPointCoordinate(point.coordinate))
	);
}

function parseTimestamp(value: string | null | undefined): number | undefined {
	if (!value) {
		return undefined;
	}

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

function parseCoordinate(
	latitudeValue: string | null | undefined,
	longitudeValue: string | null | undefined,
	elevationValue: string | null | undefined,
): RouteCoordinate | null {
	const latitude = Number(latitudeValue);
	const longitude = Number(longitudeValue);
	const elevation = Number(elevationValue);

	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
		return null;
	}

	if (Number.isFinite(elevation)) {
		return [longitude, latitude, elevation];
	}

	return [longitude, latitude];
}

function getDirectChildTextContent(
	element: Element,
	tagName: string,
): string | undefined {
	for (const child of Array.from(element.children)) {
		if (child.localName !== tagName) {
			continue;
		}

		const text = child.textContent?.trim();

		if (text) {
			return text;
		}
	}

	return undefined;
}

function getPreferredLabelFromElement(element: Element): string | undefined {
	for (const tagName of ["name", "cmt", "desc"]) {
		const text = getDirectChildTextContent(element, tagName);

		if (text) {
			return text;
		}
	}

	return undefined;
}

function parsePointElementFromDom(element: Element): ParsedGpxPoint | null {
	const coordinate = parseCoordinate(
		element.getAttribute("lat"),
		element.getAttribute("lon"),
		getDirectChildTextContent(element, "ele"),
	);

	if (!coordinate) {
		return null;
	}

	return {
		coordinate,
		label: getPreferredLabelFromElement(element),
		timestampMs: parseTimestamp(getDirectChildTextContent(element, "time")),
	};
}

function parseDomPoints(
	document: XMLDocument,
	selector: string,
): ParsedGpxPoint[] {
	return Array.from(document.querySelectorAll(selector))
		.map((element) => parsePointElementFromDom(element))
		.filter((point): point is ParsedGpxPoint => point !== null);
}

type RegexElementMatch = {
	attributes: string;
	innerXml: string;
};

function isFallbackXmlMalformed(gpx: string): boolean {
	const trimmedGpx = gpx.trim();

	if (
		trimmedGpx.length === 0 ||
		!trimmedGpx.startsWith("<") ||
		!/<gpx\b/i.test(trimmedGpx) ||
		!/<\/gpx>/i.test(trimmedGpx)
	) {
		return true;
	}

	for (const tagName of ["trk", "trkseg", "trkpt", "rte", "rtept", "wpt"]) {
		const openTagCount =
			gpx.match(new RegExp(`<${tagName}\\b(?:(?!/>)[^>])*?>`, "gi"))?.length ??
			0;
		const closeTagCount =
			gpx.match(new RegExp(`</${tagName}>`, "gi"))?.length ?? 0;

		if (closeTagCount !== openTagCount) {
			return true;
		}
	}

	return false;
}

function getRegexTagMatches(gpx: string, tagName: string): RegexElementMatch[] {
	const matches: RegexElementMatch[] = [];
	const pattern = new RegExp(
		`<${tagName}\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/${tagName}>)`,
		"gi",
	);

	for (const match of gpx.matchAll(pattern)) {
		matches.push({
			attributes: match[1] ?? "",
			innerXml: match[2] ?? "",
		});
	}

	return matches;
}

function getRegexAttributeValue(
	attributes: string,
	attributeName: string,
): string | undefined {
	const match = attributes.match(
		new RegExp(`${attributeName}\\s*=\\s*(['"])(.*?)\\1`, "i"),
	);

	return match?.[2];
}

function getRegexChildText(
	innerXml: string,
	tagName: string,
): string | undefined {
	const match = innerXml.match(
		new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"),
	);
	const text = match?.[1]?.trim();

	return text || undefined;
}

function getPreferredLabelFromRegex(innerXml: string): string | undefined {
	for (const tagName of ["name", "cmt", "desc"]) {
		const text = getRegexChildText(innerXml, tagName);

		if (text) {
			return text;
		}
	}

	return undefined;
}

function parsePointElementFromRegex(
	match: RegexElementMatch,
): ParsedGpxPoint | null {
	const coordinate = parseCoordinate(
		getRegexAttributeValue(match.attributes, "lat"),
		getRegexAttributeValue(match.attributes, "lon"),
		getRegexChildText(match.innerXml, "ele"),
	);

	if (!coordinate) {
		return null;
	}

	return {
		coordinate,
		label: getPreferredLabelFromRegex(match.innerXml),
		timestampMs: parseTimestamp(getRegexChildText(match.innerXml, "time")),
	};
}

function parseRegexPoints(gpx: string, tagName: string): ParsedGpxPoint[] {
	return getRegexTagMatches(gpx, tagName)
		.map((match) => parsePointElementFromRegex(match))
		.filter((point): point is ParsedGpxPoint => point !== null);
}

function parseGpxPoints(gpx: string) {
	if (typeof DOMParser !== "undefined") {
		const parser = new DOMParser();
		const document = parser.parseFromString(gpx, "application/xml");
		const parserError =
			document.querySelector("parsererror") ??
			document.getElementsByTagNameNS(parserErrorNamespace, "parsererror")[0];

		if (parserError) {
			throw new RouteGpxImportError(
				"invalid_xml",
				"The selected file is not valid GPX XML.",
			);
		}

		return {
			trackPoints: parseDomPoints(document, "trk trkseg trkpt"),
			routePoints: parseDomPoints(document, "rte rtept"),
			waypoints: parseDomPoints(document, "wpt"),
		};
	}

	if (isFallbackXmlMalformed(gpx)) {
		throw new RouteGpxImportError(
			"invalid_xml",
			"The selected file is not valid GPX XML.",
		);
	}

	return {
		trackPoints: parseRegexPoints(gpx, "trkpt"),
		routePoints: parseRegexPoints(gpx, "rtept"),
		waypoints: parseRegexPoints(gpx, "wpt"),
	};
}

function buildRouteMetrics(coordinates: RouteCoordinate[]) {
	let distanceMeters = 0;
	let ascendMeters = 0;
	let descendMeters = 0;
	let minLongitude = Number.POSITIVE_INFINITY;
	let minLatitude = Number.POSITIVE_INFINITY;
	let maxLongitude = Number.NEGATIVE_INFINITY;
	let maxLatitude = Number.NEGATIVE_INFINITY;

	for (const [index, coordinate] of coordinates.entries()) {
		const [longitude, latitude, elevation] = coordinate;
		minLongitude = Math.min(minLongitude, longitude);
		minLatitude = Math.min(minLatitude, latitude);
		maxLongitude = Math.max(maxLongitude, longitude);
		maxLatitude = Math.max(maxLatitude, latitude);

		if (index === 0) {
			continue;
		}

		const previousCoordinate = coordinates[index - 1];

		if (!previousCoordinate) {
			continue;
		}

		distanceMeters += getCoordinateDistanceMeters(
			getPointCoordinate(previousCoordinate),
			getPointCoordinate(coordinate),
		);

		const previousElevation = previousCoordinate[2];

		if (Number.isFinite(previousElevation) && Number.isFinite(elevation)) {
			const currentElevation = elevation as number;
			const lastElevation = previousElevation as number;
			const elevationDelta = currentElevation - lastElevation;

			if (elevationDelta > 0) {
				ascendMeters += elevationDelta;
			} else {
				descendMeters += Math.abs(elevationDelta);
			}
		}
	}

	return {
		bounds: [minLongitude, minLatitude, maxLongitude, maxLatitude] as [
			number,
			number,
			number,
			number,
		],
		distanceMeters,
		ascendMeters,
		descendMeters,
	};
}

function buildEditableStops(
	stopPoints: ParsedGpxPoint[],
	stopDerivation: ImportedRouteStopDerivation,
) {
	if (stopPoints.length > maxRoutePoints) {
		throw new RouteGpxImportError(
			"too_many_stops",
			`This GPX contains ${stopPoints.length} editable stops. Velix supports up to ${maxRoutePoints}.`,
		);
	}

	return {
		startLabel: getParsedPointLabel(stopPoints[0] as ParsedGpxPoint),
		destinationLabel: getParsedPointLabel(
			stopPoints[stopPoints.length - 1] as ParsedGpxPoint,
		),
		waypoints: stopPoints.slice(1, -1).map((point) => ({
			label: getParsedPointLabel(point),
			coordinate: point.coordinate,
		})),
		stopDerivation,
	};
}

export function parseRouteGpx(
	gpx: string,
	options: ParseRouteGpxOptions = {},
): PlannedRoute {
	const { trackPoints, routePoints, waypoints } = parseGpxPoints(gpx);
	const geometryPoints = trackPoints.length >= 2 ? trackPoints : routePoints;

	if (geometryPoints.length < 2) {
		throw new RouteGpxImportError(
			"no_geometry",
			"The selected GPX does not contain enough route geometry.",
		);
	}

	const firstTimestamp = getFirstFiniteTimestamp(geometryPoints);
	const lastTimestamp = getLastFiniteTimestamp(geometryPoints);
	const hasDuration =
		firstTimestamp !== null &&
		lastTimestamp !== null &&
		lastTimestamp >= firstTimestamp;
	const coordinates = geometryPoints.map((point) => point.coordinate);
	const metrics = buildRouteMetrics(coordinates);
	const explicitStops =
		routePoints.length >= 2
			? buildEditableStops(routePoints, "rtept")
			: waypoints.length >= 2
				? buildEditableStops(waypoints, "wpt")
				: null;
	const isClosedLoop =
		getCoordinateDistanceMeters(
			getPointCoordinate(coordinates[0] as RouteCoordinate),
			getPointCoordinate(
				coordinates[coordinates.length - 1] as RouteCoordinate,
			),
		) <= loopClosureThresholdMeters;
	const mode =
		explicitStops === null && isClosedLoop ? "round_course" : "point_to_point";
	const startLabel =
		explicitStops?.startLabel ??
		formatCoordinateLabel(
			getPointCoordinate(coordinates[0] as RouteCoordinate),
		);
	const destinationLabel =
		mode === "round_course"
			? startLabel
			: (explicitStops?.destinationLabel ??
				formatCoordinateLabel(
					getPointCoordinate(
						coordinates[coordinates.length - 1] as RouteCoordinate,
					),
				));

	return {
		mode,
		source: {
			kind: "gpx_import",
			filename: options.filename?.trim() || defaultFilename,
			stopDerivation: explicitStops?.stopDerivation ?? "track",
			hasDuration,
		},
		startLabel,
		destinationLabel,
		roundCourseTarget:
			mode === "round_course"
				? {
						kind: "distance",
						distanceMeters: Math.round(metrics.distanceMeters),
					}
				: undefined,
		waypoints: mode === "round_course" ? [] : (explicitStops?.waypoints ?? []),
		bounds: metrics.bounds,
		distanceMeters: metrics.distanceMeters,
		durationMs: hasDuration
			? (getLastFiniteTimestamp(geometryPoints) as number) -
				(getFirstFiniteTimestamp(geometryPoints) as number)
			: 0,
		ascendMeters: metrics.ascendMeters,
		descendMeters: metrics.descendMeters,
		coordinates,
		surfaceDetails: [],
		smoothnessDetails: [],
	};
}
