import type { RouteCoordinate } from "./types";

export const earthRadiusMeters = 6371008.8;

export function toDegrees(radians: number): number {
	return (radians * 180) / Math.PI;
}

export function toRadians(value: number) {
	return (value * Math.PI) / 180;
}

export function toStopPoint(
	coordinate: RouteCoordinate | [number, number],
): [number, number] {
	return [coordinate[0], coordinate[1]];
}

export function normalizeDegrees(degrees: number): number {
	return ((degrees % 360) + 360) % 360;
}

export function getSignedRelativeAngleDegrees(
	fromDegrees: number,
	toDegrees: number,
) {
	const angle = normalizeDegrees(fromDegrees - toDegrees);
	return angle > 180 ? angle - 360 : angle;
}

export function calculateBearingDegrees(
	from: RouteCoordinate | [number, number],
	to: RouteCoordinate | [number, number],
): number {
	const fromLng = toRadians(from[0]);
	const fromLat = toRadians(from[1]);
	const toLng = toRadians(to[0]);
	const toLat = toRadians(to[1]);
	const deltaLng = toLng - fromLng;
	const y = Math.sin(deltaLng) * Math.cos(toLat);
	const x =
		Math.cos(fromLat) * Math.sin(toLat) -
		Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);

	return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

export function getCoordinateDistanceMeters(
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
	const clampedHaversineA = Math.min(1, Math.max(0, haversineA));
	const haversineC =
		2 *
		Math.atan2(Math.sqrt(clampedHaversineA), Math.sqrt(1 - clampedHaversineA));

	return earthRadiusMeters * haversineC;
}

export function projectCoordinate(
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

export function getPointToSegmentDistanceMeters(
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

export function getLegDistanceMeters(
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

export function getNearestPolylineIndex(
	coordinates: RouteCoordinate[],
	target: [number, number],
	searchStartIndex: number,
): number {
	if (coordinates.length === 0) {
		return -1;
	}

	searchStartIndex = Number.isFinite(searchStartIndex)
		? Math.max(
				0,
				Math.min(Math.trunc(searchStartIndex), coordinates.length - 1),
			)
		: 0;
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
