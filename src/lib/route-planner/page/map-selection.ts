import type { ResolvedRouteAvoidance } from "$lib/route-planning";

export function getDistanceToSegmentMeters(
	point: [number, number],
	start: [number, number],
	end: [number, number],
): number {
	const lat = (((point[1] + start[1] + end[1]) / 3) * Math.PI) / 180;
	const metersPerLng = 111_320 * Math.cos(lat);
	const metersPerLat = 110_540;
	const startX = (start[0] - point[0]) * metersPerLng;
	const startY = (start[1] - point[1]) * metersPerLat;
	const endX = (end[0] - point[0]) * metersPerLng;
	const endY = (end[1] - point[1]) * metersPerLat;
	const dx = endX - startX;
	const dy = endY - startY;
	const lengthSquared = dx * dx + dy * dy;

	if (lengthSquared <= 0) {
		return Math.hypot(startX, startY);
	}

	const ratio = Math.max(
		0,
		Math.min(1, -(startX * dx + startY * dy) / lengthSquared),
	);
	return Math.hypot(startX + dx * ratio, startY + dy * ratio);
}

export function isPointNearLine(
	point: [number, number],
	line: [number, number][],
	toleranceMeters: number,
): boolean {
	return line.slice(0, -1).some((start, index) => {
		const end = line[index + 1];
		return end
			? getDistanceToSegmentMeters(point, start, end) <= toleranceMeters
			: false;
	});
}

export function buildAvoidancePlaceholderPolygon(
	centerline: [number, number][],
	bufferMeters: number,
): [number, number][] {
	if (centerline.length === 0) {
		return [];
	}

	const lngs = centerline.map((point) => point[0]);
	const lats = centerline.map((point) => point[1]);
	const centerLat =
		lats.reduce((sum, lat) => sum + lat, 0) / Math.max(lats.length, 1);
	const deltaLng =
		bufferMeters / Math.max(111_320 * Math.cos((centerLat * Math.PI) / 180), 1);
	const deltaLat = bufferMeters / 110_540;
	const minLng = Math.min(...lngs) - deltaLng;
	const maxLng = Math.max(...lngs) + deltaLng;
	const minLat = Math.min(...lats) - deltaLat;
	const maxLat = Math.max(...lats) + deltaLat;

	return [
		[minLng, minLat],
		[maxLng, minLat],
		[maxLng, maxLat],
		[minLng, maxLat],
		[minLng, minLat],
	];
}

export function findAvoidanceNearSelection(
	point: [number, number],
	avoidances: ResolvedRouteAvoidance[],
	extraToleranceMeters = 20,
): ResolvedRouteAvoidance | null {
	return (
		avoidances.find((avoidance) =>
			isPointNearLine(
				point,
				avoidance.centerline,
				avoidance.bufferMeters + extraToleranceMeters,
			),
		) ?? null
	);
}
