import type {
	Feature,
	FeatureCollection,
	LineString,
	Point,
	Position,
} from "geojson";

export type RouteBounds = [number, number, number, number];

export type RouteCoordinate = [number, number] | [number, number, number];

export type RouteSuggestion = {
	label: string;
	point: [number, number];
};

export type ImportedRouteStopDerivation = "rtept" | "wpt" | "track";

export type RouteSource =
	| {
			kind: "graphhopper";
	  }
	| {
			kind: "gpx_import";
			filename: string;
			stopDerivation: ImportedRouteStopDerivation;
			hasDuration: boolean;
	  };

export type RouteMode = "point_to_point" | "round_course";

export type RouteStopInput = {
	label: string;
	point?: [number, number];
};

export type PointToPointRouteRequestPayload = {
	mode: "point_to_point";
	start: RouteStopInput;
	waypoints: RouteStopInput[];
	destination: RouteStopInput;
};

export type RoundCourseTarget =
	| {
			kind: "distance";
			distanceMeters: number;
	  }
	| {
			kind: "duration";
			durationMs: number;
	  }
	| {
			kind: "ascend";
			ascendMeters: number;
	  };

export type RoundCourseRouteRequestPayload = {
	mode: "round_course";
	start: RouteStopInput;
	target: RoundCourseTarget;
};

export type RouteRequestPayload =
	| PointToPointRouteRequestPayload
	| RoundCourseRouteRequestPayload;

export type RouteDetailInterval = {
	from: number;
	to: number;
	value: string;
};

export type RouteWaypoint = {
	label: string;
	coordinate: RouteCoordinate;
};

export type ElevationProfilePoint = {
	distanceMeters: number;
	elevationMeters: number;
	coordinate: RouteCoordinate;
};

export type PlannedRoute = {
	mode: RouteMode;
	source: RouteSource;
	startLabel: string;
	destinationLabel: string;
	requestedDistanceMeters?: number;
	roundCourseTarget?: RoundCourseTarget;
	routingProfile?: string;
	routingStrategy?: string;
	routingWarnings?: string[];
	waypoints: RouteWaypoint[];
	bounds: RouteBounds;
	distanceMeters: number;
	durationMs: number;
	ascendMeters: number;
	descendMeters: number;
	coordinates: RouteCoordinate[];
	surfaceDetails: RouteDetailInterval[];
	smoothnessDetails: RouteDetailInterval[];
};

export type RouteApiSuccess = {
	routes: PlannedRoute[];
	selectedRouteIndex: number;
};

export type RouteSuggestionsApiSuccess = {
	suggestions: RouteSuggestion[];
};

export type RouteMapOverlay = {
	id: string;
	geoJson: FeatureCollection;
	bounds: RouteBounds;
	isSelected: boolean;
};

export type RouteFieldErrors = {
	startQuery?: string;
	destinationQuery?: string;
	waypointQueries?: string[];
	roundCourseTarget?: string;
};

export type RouteApiError = {
	error: string;
	fieldErrors?: RouteFieldErrors;
};

type RouteFeatureProperties =
	| {
			kind: "route";
	  }
	| {
			kind: "start" | "destination" | "waypoint";
			label: string;
			order?: number;
	  };

const smoothSurfaceValues = new Set([
	"ASPHALT",
	"PAVED",
	"CONCRETE",
	"CONCRETE_LANES",
	"CONCRETE_PLATES",
]);

const mixedSurfaceValues = new Set([
	"PAVING_STONES",
	"SETT",
	"COBBLESTONE",
	"UNHEWN_COBBLESTONE",
	"COMPACTED",
	"FINE_GRAVEL",
	"CHIPSEAL",
]);

const coarseSurfaceValues = new Set([
	"DIRT",
	"EARTH",
	"GROUND",
	"GRASS",
	"GRAVEL",
	"MUD",
	"PEBBLESTONE",
	"ROCK",
	"SAND",
	"UNPAVED",
	"WOODCHIPS",
]);

const smoothnessSurfaceFallback = {
	smooth: new Set(["EXCELLENT", "GOOD"]),
	mixed: new Set(["INTERMEDIATE"]),
};

const earthRadiusMeters = 6371008.8;

function toStopPoint(
	coordinate: RouteCoordinate | [number, number],
): [number, number] {
	return [coordinate[0], coordinate[1]];
}

function normalizeDetailValue(value: string): string {
	return value
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function classifySurfaceValue(
	value: string,
): keyof typeof smoothnessSurfaceFallback | "coarse" | null {
	const normalizedValue = normalizeDetailValue(value);

	if (
		!normalizedValue ||
		normalizedValue === "MISSING" ||
		normalizedValue === "UNKNOWN"
	) {
		return null;
	}

	if (smoothSurfaceValues.has(normalizedValue)) {
		return "smooth";
	}

	if (mixedSurfaceValues.has(normalizedValue)) {
		return "mixed";
	}

	if (coarseSurfaceValues.has(normalizedValue)) {
		return "coarse";
	}

	return null;
}

export function buildRouteGeoJson(route: PlannedRoute): FeatureCollection {
	const lineFeature: Feature<LineString, RouteFeatureProperties> = {
		type: "Feature",
		properties: {
			kind: "route",
		},
		geometry: {
			type: "LineString",
			coordinates: route.coordinates as Position[],
		},
	};

	const startCoordinate = route.coordinates[0];
	const destinationCoordinate = route.coordinates[route.coordinates.length - 1];

	const startFeature: Feature<Point, RouteFeatureProperties> | null =
		startCoordinate
			? {
					type: "Feature",
					properties: {
						kind: "start",
						label: route.startLabel,
					},
					geometry: {
						type: "Point",
						coordinates: startCoordinate as Position,
					},
				}
			: null;

	const destinationFeature: Feature<Point, RouteFeatureProperties> | null =
		route.mode !== "round_course" && destinationCoordinate
			? {
					type: "Feature",
					properties: {
						kind: "destination",
						label: route.destinationLabel,
					},
					geometry: {
						type: "Point",
						coordinates: destinationCoordinate as Position,
					},
				}
			: null;

	const waypointFeatures: Feature<Point, RouteFeatureProperties>[] =
		route.waypoints.map((waypoint, index) => ({
			type: "Feature",
			properties: {
				kind: "waypoint",
				label: waypoint.label,
				order: index + 1,
			},
			geometry: {
				type: "Point",
				coordinates: waypoint.coordinate as Position,
			},
		}));

	const features: Feature[] = [lineFeature];

	if (startFeature) {
		features.push(startFeature);
	}

	features.push(...waypointFeatures);

	if (destinationFeature) {
		features.push(destinationFeature);
	}

	return {
		type: "FeatureCollection",
		features,
	};
}

export function mergeRouteBounds(routes: PlannedRoute[]): RouteBounds | null {
	if (routes.length === 0) {
		return null;
	}

	let minLng = Number.POSITIVE_INFINITY;
	let minLat = Number.POSITIVE_INFINITY;
	let maxLng = Number.NEGATIVE_INFINITY;
	let maxLat = Number.NEGATIVE_INFINITY;

	for (const route of routes) {
		const [routeMinLng, routeMinLat, routeMaxLng, routeMaxLat] = route.bounds;
		minLng = Math.min(minLng, routeMinLng);
		minLat = Math.min(minLat, routeMinLat);
		maxLng = Math.max(maxLng, routeMaxLng);
		maxLat = Math.max(maxLat, routeMaxLat);
	}

	return [minLng, minLat, maxLng, maxLat];
}

export function isImportedRoute(
	route: Pick<PlannedRoute, "source"> | null | undefined,
): route is {
	source: Extract<RouteSource, { kind: "gpx_import" }>;
} {
	return route?.source.kind === "gpx_import";
}

function toRadians(value: number) {
	return (value * Math.PI) / 180;
}

function getCoordinateDistanceMeters(
	from: RouteCoordinate,
	to: RouteCoordinate,
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

	return earthRadiusMeters * haversineC;
}

function projectCoordinate(
	coordinate: [number, number],
	referenceLatitude: number,
): [number, number] {
	const [longitude, latitude] = coordinate;
	const latitudeRadians = toRadians(referenceLatitude);

	return [
		toRadians(longitude) * Math.cos(latitudeRadians) * earthRadiusMeters,
		toRadians(latitude) * earthRadiusMeters,
	];
}

function getPointToSegmentDistanceMeters(
	point: [number, number],
	segmentStart: [number, number],
	segmentEnd: [number, number],
): number {
	const referenceLatitude = (point[1] + segmentStart[1] + segmentEnd[1]) / 3;
	const [pointX, pointY] = projectCoordinate(point, referenceLatitude);
	const [startX, startY] = projectCoordinate(segmentStart, referenceLatitude);
	const [endX, endY] = projectCoordinate(segmentEnd, referenceLatitude);
	const deltaX = endX - startX;
	const deltaY = endY - startY;
	const segmentLengthSquared = deltaX ** 2 + deltaY ** 2;

	if (segmentLengthSquared === 0) {
		return Math.hypot(pointX - startX, pointY - startY);
	}

	const projection =
		((pointX - startX) * deltaX + (pointY - startY) * deltaY) /
		segmentLengthSquared;
	const clampedProjection = Math.min(1, Math.max(0, projection));
	const closestX = startX + deltaX * clampedProjection;
	const closestY = startY + deltaY * clampedProjection;

	return Math.hypot(pointX - closestX, pointY - closestY);
}

function getLegDistanceMeters(
	point: [number, number],
	coordinates: [number, number][],
): number {
	if (coordinates.length === 0) {
		return Number.POSITIVE_INFINITY;
	}

	if (coordinates.length === 1) {
		return getPointToSegmentDistanceMeters(
			point,
			coordinates[0],
			coordinates[0],
		);
	}

	let nearestDistance = Number.POSITIVE_INFINITY;

	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const from = coordinates[index];
		const to = coordinates[index + 1];

		if (!from || !to) {
			continue;
		}

		nearestDistance = Math.min(
			nearestDistance,
			getPointToSegmentDistanceMeters(point, from, to),
		);
	}

	return nearestDistance;
}

function getNearestPolylineIndex(
	coordinates: RouteCoordinate[],
	target: [number, number],
	searchStartIndex: number,
): number {
	let nearestIndex = searchStartIndex;
	let nearestDistance = Number.POSITIVE_INFINITY;

	for (let index = searchStartIndex; index < coordinates.length; index += 1) {
		const coordinate = coordinates[index];

		if (!coordinate) {
			continue;
		}

		const distance = getCoordinateDistanceMeters(coordinate, target);

		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearestIndex = index;
		}
	}

	return nearestIndex;
}

export function getRouteStopInputs(route: PlannedRoute): RouteStopInput[] {
	const startCoordinate = route.coordinates[0];
	const destinationCoordinate = route.coordinates[route.coordinates.length - 1];

	if (route.mode === "round_course") {
		return [
			{
				label: route.startLabel,
				point: startCoordinate ? toStopPoint(startCoordinate) : undefined,
			},
		];
	}

	return [
		{
			label: route.startLabel,
			point: startCoordinate ? toStopPoint(startCoordinate) : undefined,
		},
		...route.waypoints.map((waypoint) => ({
			label: waypoint.label,
			point: toStopPoint(waypoint.coordinate),
		})),
		{
			label: route.destinationLabel,
			point: destinationCoordinate
				? toStopPoint(destinationCoordinate)
				: undefined,
		},
	];
}

function getRouteLegInsertionIndex(
	stops: RouteStopInput[],
	point: [number, number],
	route: PlannedRoute,
): number | null {
	const routeStops = getRouteStopInputs(route);

	if (routeStops.length !== stops.length || route.coordinates.length === 0) {
		return null;
	}

	for (let index = 0; index < stops.length; index += 1) {
		const stop = stops[index];
		const routeStop = routeStops[index];

		if (!stop || !routeStop) {
			return null;
		}

		if (stop.label !== routeStop.label) {
			return null;
		}

		if (
			(stop.point && !routeStop.point) ||
			(!stop.point && routeStop.point) ||
			(stop.point &&
				routeStop.point &&
				(stop.point[0] !== routeStop.point[0] ||
					stop.point[1] !== routeStop.point[1]))
		) {
			return null;
		}
	}

	const routeStopPoints = routeStops
		.map((stop) => stop.point)
		.filter((stopPoint): stopPoint is [number, number] => !!stopPoint);

	if (routeStopPoints.length !== routeStops.length) {
		return null;
	}

	const stopIndices: number[] = [];
	let searchStartIndex = 0;

	for (const stopPoint of routeStopPoints) {
		const stopIndex = getNearestPolylineIndex(
			route.coordinates,
			stopPoint,
			searchStartIndex,
		);
		stopIndices.push(stopIndex);
		searchStartIndex = stopIndex;
	}

	for (let index = 0; index < stopIndices.length - 1; index += 1) {
		const currentIndex = stopIndices[index];
		const nextIndex = stopIndices[index + 1];

		if (
			currentIndex === undefined ||
			nextIndex === undefined ||
			nextIndex <= currentIndex
		) {
			return null;
		}
	}

	let bestLegIndex = 0;
	let bestLegDistance = Number.POSITIVE_INFINITY;

	for (let index = 0; index < stopIndices.length - 1; index += 1) {
		const fromIndex = stopIndices[index];
		const toIndex = stopIndices[index + 1];

		if (fromIndex === undefined || toIndex === undefined) {
			continue;
		}

		const legCoordinates = route.coordinates
			.slice(fromIndex, toIndex + 1)
			.map((coordinate) => toStopPoint(coordinate));
		const distance = getLegDistanceMeters(
			point,
			legCoordinates.length > 0
				? legCoordinates
				: [routeStopPoints[index], routeStopPoints[index + 1]],
		);

		if (distance < bestLegDistance) {
			bestLegDistance = distance;
			bestLegIndex = index;
		}
	}

	return bestLegIndex;
}

export function getWaypointInsertionIndex(
	stops: RouteStopInput[],
	point: [number, number],
	route: PlannedRoute | null = null,
): number {
	const routedLegIndex = route
		? getRouteLegInsertionIndex(stops, point, route)
		: null;

	if (typeof routedLegIndex === "number") {
		return routedLegIndex;
	}

	const resolvedStops = stops.filter(
		(stop) => stop.label.trim().length > 0 && !!stop.point,
	);

	if (resolvedStops.length < 2) {
		return Math.max(0, Math.min(stops.length - 1, resolvedStops.length - 1));
	}

	let bestLegIndex = 0;
	let bestLegDistance = Number.POSITIVE_INFINITY;

	for (let index = 0; index < resolvedStops.length - 1; index += 1) {
		const from = resolvedStops[index]?.point;
		const to = resolvedStops[index + 1]?.point;

		if (!from || !to) {
			continue;
		}

		const distance = getLegDistanceMeters(point, [from, to]);

		if (distance < bestLegDistance) {
			bestLegDistance = distance;
			bestLegIndex = index;
		}
	}

	return bestLegIndex;
}

export function sampleElevationProfile(
	coordinates: RouteCoordinate[],
	targetSamples = 40,
): ElevationProfilePoint[] {
	if (coordinates.length === 0) {
		return [];
	}

	let totalDistanceMeters = 0;
	let previousCoordinate = coordinates[0];
	const profilePoints: ElevationProfilePoint[] = [];

	for (const [index, coordinate] of coordinates.entries()) {
		if (index > 0 && previousCoordinate) {
			totalDistanceMeters += getCoordinateDistanceMeters(
				previousCoordinate,
				coordinate,
			);
		}

		previousCoordinate = coordinate;

		const elevationMeters = coordinate[2];

		if (elevationMeters === undefined || !Number.isFinite(elevationMeters)) {
			continue;
		}

		profilePoints.push({
			distanceMeters: totalDistanceMeters,
			elevationMeters,
			coordinate,
		});
	}

	if (profilePoints.length === 0) {
		return [];
	}

	const lastProfilePoint = profilePoints[profilePoints.length - 1];

	if (!lastProfilePoint) {
		return [];
	}

	const sampleCount = Math.max(targetSamples, 1);

	if (profilePoints.length <= sampleCount) {
		return profilePoints;
	}

	if (sampleCount === 1) {
		return [profilePoints[0] ?? lastProfilePoint];
	}

	const lastIndex = profilePoints.length - 1;
	const step = lastIndex / (sampleCount - 1);

	return Array.from({ length: sampleCount }, (_, index) => {
		const sampleIndex = Math.min(lastIndex, Math.round(index * step));
		return profilePoints[sampleIndex] ?? lastProfilePoint;
	});
}

export function getSurfaceMix(route: PlannedRoute) {
	const totals = {
		smooth: 0,
		mixed: 0,
		coarse: 0,
	};

	for (const detail of route.surfaceDetails) {
		const span = Math.max(detail.to - detail.from, 0);
		if (span === 0) continue;
		const bucket = classifySurfaceValue(detail.value);

		if (!bucket) continue;

		totals[bucket] += span;
	}

	if (totals.smooth + totals.mixed + totals.coarse === 0) {
		for (const detail of route.smoothnessDetails) {
			const span = Math.max(detail.to - detail.from, 0);
			if (span === 0) continue;

			const normalizedValue = normalizeDetailValue(detail.value);

			if (smoothnessSurfaceFallback.smooth.has(normalizedValue)) {
				totals.smooth += span;
				continue;
			}

			if (smoothnessSurfaceFallback.mixed.has(normalizedValue)) {
				totals.mixed += span;
				continue;
			}

			totals.coarse += span;
		}
	}

	const total = totals.smooth + totals.mixed + totals.coarse;

	if (total === 0) {
		return [];
	}

	const smoothPct = Math.round((totals.smooth / total) * 100);
	const mixedPct = Math.round((totals.mixed / total) * 100);
	const coarsePct = Math.round((totals.coarse / total) * 100);

	return [
		{
			label: "Smooth asphalt",
			pct: smoothPct,
			className: "bg-emerald-500",
		},
		{
			label: "Mixed / worn",
			pct: mixedPct,
			className: "bg-amber-500",
		},
		{
			label: "Coarse / rough",
			pct: coarsePct,
			className: "bg-orange-600",
		},
	].filter((item) => item.pct > 0);
}
