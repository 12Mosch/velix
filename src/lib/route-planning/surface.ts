import type {
	PlannedRoute,
	RouteCoordinate,
	RouteDetailInterval,
} from "./types";
import { getCoordinateDistanceMeters } from "./geometry";

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

export function normalizeDetailValue(value: string): string {
	return value
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

export function classifySurfaceValue(
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

export function classifySmoothnessSurfaceFallbackValue(
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

	if (smoothnessSurfaceFallback.smooth.has(normalizedValue)) {
		return "smooth";
	}

	if (smoothnessSurfaceFallback.mixed.has(normalizedValue)) {
		return "mixed";
	}

	return "coarse";
}

export type SurfaceBucket = keyof typeof smoothnessSurfaceFallback | "coarse";
export type RouteSurfaceFeature = {
	type: "Feature";
	properties: { kind: "surface"; surfaceBucket: SurfaceBucket };
	geometry: { type: "LineString"; coordinates: RouteCoordinate[] };
};

export function buildRouteSurfaceFeatures(
	route: PlannedRoute,
	details: RouteDetailInterval[],
	classify: (
		value: string,
	) => keyof typeof smoothnessSurfaceFallback | "coarse" | null,
): RouteSurfaceFeature[] {
	return details.flatMap((detail) => {
		const bucket = classify(detail.value);

		if (!bucket) {
			return [];
		}

		const from = Math.trunc(detail.from);
		const to = Math.trunc(detail.to);

		if (
			from < 0 ||
			to < 0 ||
			to <= from ||
			from !== detail.from ||
			to !== detail.to ||
			to >= route.coordinates.length
		) {
			return [];
		}

		const coordinates = route.coordinates.slice(
			from,
			to + 1,
		) as RouteCoordinate[];

		if (coordinates.length < 2) {
			return [];
		}

		return [
			{
				type: "Feature",
				properties: {
					kind: "surface",
					surfaceBucket: bucket,
				},
				geometry: {
					type: "LineString",
					coordinates,
				},
			},
		];
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

			if (
				!normalizedValue ||
				normalizedValue === "MISSING" ||
				normalizedValue === "UNKNOWN"
			) {
				continue;
			}

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

function getDetailIntervalDistanceMeters(
	route: PlannedRoute,
	detail: RouteDetailInterval,
): number {
	const from = Math.max(0, Math.trunc(detail.from));
	const to = Math.min(route.coordinates.length - 1, Math.trunc(detail.to));
	let distanceMeters = 0;

	for (let index = from; index < to; index += 1) {
		const left = route.coordinates[index];
		const right = route.coordinates[index + 1];

		if (!left || !right) continue;

		distanceMeters += getCoordinateDistanceMeters(left, right);
	}

	return distanceMeters;
}

export function getSurfaceDistanceTotals(route: PlannedRoute): {
	smooth: number;
	mixed: number;
	coarse: number;
	total: number;
} {
	const totals = {
		smooth: 0,
		mixed: 0,
		coarse: 0,
	};
	const addDetails = (
		details: RouteDetailInterval[],
		classify: (value: string) => keyof typeof totals | null,
	) => {
		for (const detail of details) {
			const bucket = classify(detail.value);

			if (!bucket) continue;

			totals[bucket] += getDetailIntervalDistanceMeters(route, detail);
		}
	};

	addDetails(route.surfaceDetails, classifySurfaceValue);

	if (totals.smooth + totals.mixed + totals.coarse === 0) {
		addDetails(route.smoothnessDetails, classifySmoothnessSurfaceFallbackValue);
	}

	return {
		...totals,
		total: totals.smooth + totals.mixed + totals.coarse,
	};
}
