import type { RouteCoordinate } from "$lib/route-planning";

import { areaPolygonSegments, earthRadiusMeters } from "./constants";

function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
	return (radians * 180) / Math.PI;
}

export function getDistanceMeters(
	left: [number, number],
	right: [number, number],
) {
	const leftLat = toRadians(left[1]);
	const rightLat = toRadians(right[1]);
	const deltaLat = toRadians(right[1] - left[1]);
	const deltaLng = toRadians(right[0] - left[0]);
	const a =
		Math.sin(deltaLat / 2) ** 2 +
		Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;

	return (
		earthRadiusMeters *
		2 *
		Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
	);
}

export function toCoordinatePair(
	coordinate: RouteCoordinate,
): [number, number] {
	return [coordinate[0], coordinate[1]];
}

export function interpolateCoordinate(
	from: RouteCoordinate,
	to: RouteCoordinate,
	ratio: number,
): [number, number] {
	return [
		from[0] + (to[0] - from[0]) * ratio,
		from[1] + (to[1] - from[1]) * ratio,
	];
}

function isSamePoint(left: [number, number], right: [number, number]) {
	return left[0] === right[0] && left[1] === right[1];
}

function closePolygonRing(points: [number, number][]): [number, number][] {
	const firstPoint = points[0];
	const lastPoint = points[points.length - 1];

	if (!firstPoint) {
		return [];
	}

	if (lastPoint && isSamePoint(firstPoint, lastPoint)) {
		return points;
	}

	return [...points, firstPoint];
}

function getRingSignedArea(points: [number, number][]): number {
	let area = 0;

	for (let index = 0; index < points.length - 1; index += 1) {
		const point = points[index];
		const nextPoint = points[index + 1];

		if (!point || !nextPoint) {
			continue;
		}

		area += point[0] * nextPoint[1] - nextPoint[0] * point[1];
	}

	return area / 2;
}

function ensureCounterClockwiseRing(
	points: [number, number][],
): [number, number][] {
	const closedRing = closePolygonRing(points);
	const openRing = closedRing.slice(0, -1);

	if (getRingSignedArea(closedRing) >= 0) {
		return closedRing;
	}

	return closePolygonRing([...openRing].reverse());
}

export function buildAreaPolygon(
	center: [number, number],
	radiusMeters: number,
): [number, number][] {
	const centerLng = toRadians(center[0]);
	const centerLat = toRadians(center[1]);
	const angularDistance = radiusMeters / earthRadiusMeters;
	const coordinates: [number, number][] = [];

	for (let index = 0; index < areaPolygonSegments; index += 1) {
		const bearing = (2 * Math.PI * index) / areaPolygonSegments;
		const lat = Math.asin(
			Math.sin(centerLat) * Math.cos(angularDistance) +
				Math.cos(centerLat) * Math.sin(angularDistance) * Math.cos(bearing),
		);
		const lng =
			centerLng +
			Math.atan2(
				Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centerLat),
				Math.cos(angularDistance) - Math.sin(centerLat) * Math.sin(lat),
			);

		coordinates.push([toDegrees(lng), toDegrees(lat)]);
	}

	return ensureCounterClockwiseRing(coordinates);
}

function getProjectionOrigin(points: [number, number][]) {
	const lng =
		points.reduce((sum, point) => sum + point[0], 0) /
		Math.max(points.length, 1);
	const lat =
		points.reduce((sum, point) => sum + point[1], 0) /
		Math.max(points.length, 1);

	return {
		lng,
		lat,
		cosLat: Math.cos(toRadians(lat)),
	};
}

export function buildCorridorPolygon(
	points: [number, number][],
	widthMeters: number,
): [number, number][] {
	return buildBufferedLinePolygon(points, widthMeters);
}

export function buildBufferedLinePolygon(
	points: [number, number][],
	widthMeters: number,
): [number, number][] {
	const uniquePoints = points.filter((point, index) => {
		const previousPoint = points[index - 1];
		return !previousPoint || getDistanceMeters(previousPoint, point) > 1;
	});
	const fallbackPoint =
		uniquePoints[0] ?? points[0] ?? ([0, 0] as [number, number]);
	const controlPoints: [number, number][] =
		uniquePoints.length >= 2
			? uniquePoints
			: [fallbackPoint, [fallbackPoint[0] + 0.0001, fallbackPoint[1]]];
	const origin = getProjectionOrigin(controlPoints);
	const halfWidthMeters = widthMeters / 2;
	const projected = controlPoints.map((point) => ({
		x:
			toRadians(point[0] - origin.lng) *
			earthRadiusMeters *
			Math.max(origin.cosLat, 1e-6),
		y: toRadians(point[1] - origin.lat) * earthRadiusMeters,
	}));
	const segments = projected.slice(0, -1).map((point, index) => {
		const nextPoint = projected[index + 1] ?? point;
		const dx = nextPoint.x - point.x;
		const dy = nextPoint.y - point.y;
		const length = Math.hypot(dx, dy) || 1;
		const unit = {
			x: dx / length,
			y: dy / length,
		};

		return {
			unit,
			normal: {
				x: -unit.y,
				y: unit.x,
			},
		};
	});
	const left: Array<{ x: number; y: number }> = [];
	const right: Array<{ x: number; y: number }> = [];

	for (const [index, point] of projected.entries()) {
		const previousSegment = segments[Math.max(0, index - 1)] ?? segments[0];
		const nextSegment =
			segments[Math.min(index, segments.length - 1)] ?? previousSegment;
		const summedNormal = {
			x: (previousSegment?.normal.x ?? 0) + (nextSegment?.normal.x ?? 0),
			y: (previousSegment?.normal.y ?? 0) + (nextSegment?.normal.y ?? 0),
		};
		const summedLength = Math.hypot(summedNormal.x, summedNormal.y);
		const miter =
			summedLength > 1e-6
				? {
						x: summedNormal.x / summedLength,
						y: summedNormal.y / summedLength,
					}
				: (nextSegment?.normal ?? { x: 0, y: 1 });
		const denominator =
			miter.x * (nextSegment?.normal.x ?? 0) +
			miter.y * (nextSegment?.normal.y ?? 0);
		const miterLength =
			Math.abs(denominator) > 1e-6
				? Math.min(Math.abs(halfWidthMeters / denominator), halfWidthMeters * 2)
				: halfWidthMeters;
		const offset = {
			x: miter.x * miterLength,
			y: miter.y * miterLength,
		};

		left.push({
			x: point.x + offset.x,
			y: point.y + offset.y,
		});
		right.push({
			x: point.x - offset.x,
			y: point.y - offset.y,
		});
	}

	const unproject = (point: { x: number; y: number }): [number, number] => [
		origin.lng +
			toDegrees(point.x / (earthRadiusMeters * Math.max(origin.cosLat, 1e-6))),
		origin.lat + toDegrees(point.y / earthRadiusMeters),
	];
	return ensureCounterClockwiseRing(
		[...right.reverse(), ...left].map(unproject),
	);
}
