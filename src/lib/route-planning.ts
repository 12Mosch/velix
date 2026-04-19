import type {
	Feature,
	FeatureCollection,
	LineString,
	Point,
	Position,
} from "geojson";

export type RouteBounds = [number, number, number, number];

export type RouteCoordinate = [number, number] | [number, number, number];

export type RouteDetailInterval = {
	from: number;
	to: number;
	value: string;
};

export type PlannedRoute = {
	startLabel: string;
	destinationLabel: string;
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
	route: PlannedRoute;
};

export type RouteApiError = {
	error: string;
	fieldErrors?: Partial<Record<"startQuery" | "destinationQuery", string>>;
};

type RouteFeatureProperties =
	| {
			kind: "route";
	  }
	| {
			kind: "start" | "destination";
			label: string;
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
		destinationCoordinate
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

	const features: Feature[] = [lineFeature];

	if (startFeature) {
		features.push(startFeature);
	}

	if (destinationFeature) {
		features.push(destinationFeature);
	}

	return {
		type: "FeatureCollection",
		features,
	};
}

export function sampleElevationProfile(
	coordinates: RouteCoordinate[],
	targetSamples = 40,
): number[] {
	const elevations = coordinates
		.map((coordinate) => coordinate[2])
		.filter((value): value is number => Number.isFinite(value));

	if (elevations.length === 0) {
		return [];
	}

	if (elevations.length <= targetSamples) {
		return elevations;
	}

	const lastIndex = elevations.length - 1;
	const step = lastIndex / (targetSamples - 1);

	return Array.from({ length: targetSamples }, (_, index) => {
		const sampleIndex = Math.min(lastIndex, Math.round(index * step));
		return elevations[sampleIndex] ?? elevations[lastIndex];
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
