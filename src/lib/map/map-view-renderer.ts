import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import type { RouteCoordinate, RouteMapOverlay } from "$lib/route-planning";

const routeSourcePrefix = "planned-route";
const constraintSourceId = "route-constraint";
const constraintFillLayerId = "route-constraint-fill";
const constraintLineLayerId = "route-constraint-line";
const lockedSegmentSourceId = "route-locked-segments";
const lockedSegmentCasingLayerId = "route-locked-segments-casing";
const lockedSegmentLineLayerId = "route-locked-segments-line";
const hoveredRouteSourceId = "planned-route-hover";
const hoveredRouteLayerId = "planned-route-hover-point";
const currentLocationSourceId = "current-location";
const currentLocationAccuracyLayerId = "current-location-accuracy";
const currentLocationPointLayerId = "current-location-point";
const alternativeRoutePalette = [
	"rgba(15, 23, 42, 0.34)",
	"rgba(71, 85, 105, 0.34)",
	"rgba(100, 116, 139, 0.34)",
] as const;

export function getRouteSourceId(overlayId: string) {
	return `${routeSourcePrefix}-${overlayId}`;
}

export function getRouteLineLayerId(overlayId: string) {
	return `${getRouteSourceId(overlayId)}-line`;
}

export function getRouteSurfaceLayerId(overlayId: string) {
	return `${getRouteSourceId(overlayId)}-surface`;
}

export function getRouteGradientLayerId(overlayId: string) {
	return `${getRouteSourceId(overlayId)}-gradient`;
}

export function getRouteClimbLayerId(overlayId: string) {
	return `${getRouteSourceId(overlayId)}-climbs`;
}

export function getRouteCasingLayerId(overlayId: string) {
	return `${getRouteSourceId(overlayId)}-casing`;
}

export function getRouteStartLayerId(overlayId: string) {
	return `${getRouteSourceId(overlayId)}-start`;
}

export function getRouteWaypointLayerId(overlayId: string) {
	return `${getRouteSourceId(overlayId)}-waypoint`;
}

export function getRouteDestinationLayerId(overlayId: string) {
	return `${getRouteSourceId(overlayId)}-destination`;
}

export function removeRouteOverlayById(map: MapLibreMap, overlayId: string) {
	for (const layerId of [
		getRouteDestinationLayerId(overlayId),
		getRouteWaypointLayerId(overlayId),
		getRouteStartLayerId(overlayId),
		getRouteClimbLayerId(overlayId),
		getRouteGradientLayerId(overlayId),
		getRouteSurfaceLayerId(overlayId),
		getRouteLineLayerId(overlayId),
		getRouteCasingLayerId(overlayId),
	]) {
		if (map.getLayer(layerId)) {
			map.removeLayer(layerId);
		}
	}

	const sourceId = getRouteSourceId(overlayId);

	if (map.getSource(sourceId)) {
		map.removeSource(sourceId);
	}
}

export function removeRouteOverlays(map: MapLibreMap, overlayIds: string[]) {
	for (const overlayId of overlayIds) {
		removeRouteOverlayById(map, overlayId);
	}
}

function addRouteOverlay(
	map: MapLibreMap,
	overlay: RouteMapOverlay,
	index: number,
) {
	const sourceId = getRouteSourceId(overlay.id);
	const alternativeColor =
		alternativeRoutePalette[index % alternativeRoutePalette.length];
	const hasGradientFeatures = overlay.geoJson.features.some(
		(feature) => feature.properties?.kind === "gradient",
	);

	map.addSource(sourceId, {
		type: "geojson",
		data: overlay.geoJson,
	});

	map.addLayer({
		id: getRouteCasingLayerId(overlay.id),
		type: "line",
		source: sourceId,
		filter: ["==", ["get", "kind"], "route"],
		layout: { "line-cap": "round", "line-join": "round" },
		paint: overlay.isSelected
			? {
					"line-color": "rgba(255, 255, 255, 0.88)",
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						5,
						12,
						8,
						16,
						11,
					],
					"line-opacity": 0.95,
				}
			: {
					"line-color": "rgba(255, 255, 255, 0.32)",
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						2.5,
						12,
						4,
						16,
						5.5,
					],
					"line-opacity": 0.55,
				},
	});
	map.addLayer({
		id: getRouteLineLayerId(overlay.id),
		type: "line",
		source: sourceId,
		filter: ["==", ["get", "kind"], "route"],
		layout: { "line-cap": "round", "line-join": "round" },
		paint: overlay.isSelected
			? {
					"line-color": "rgb(37, 99, 235)",
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						3,
						12,
						5,
						16,
						7,
					],
				}
			: {
					"line-color": alternativeColor,
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						1.5,
						12,
						2.5,
						16,
						3.5,
					],
				},
	});

	if (overlay.isSelected) {
		map.addLayer({
			id: getRouteSurfaceLayerId(overlay.id),
			type: "line",
			source: sourceId,
			filter: ["==", ["get", "kind"], "surface"],
			layout: { "line-cap": "round", "line-join": "round" },
			paint: {
				"line-color": [
					"match",
					["get", "surfaceBucket"],
					"smooth",
					"rgb(16, 185, 129)",
					"mixed",
					"rgb(245, 158, 11)",
					"coarse",
					"rgb(249, 115, 22)",
					"rgb(100, 116, 139)",
				],
				"line-width": [
					"interpolate",
					["linear"],
					["zoom"],
					6,
					3.5,
					12,
					5.5,
					16,
					7.5,
				],
				"line-opacity": 0.82,
			},
		});
		map.addLayer({
			id: getRouteClimbLayerId(overlay.id),
			type: "line",
			source: sourceId,
			filter: ["==", ["get", "kind"], "climb"],
			layout: { "line-cap": "round", "line-join": "round" },
			paint: {
				"line-color": [
					"match",
					["get", "category"],
					"HC",
					"rgb(127, 29, 29)",
					"Cat 1",
					"rgb(185, 28, 28)",
					"Cat 2",
					"rgb(217, 119, 6)",
					"Cat 3",
					"rgb(37, 99, 235)",
					"Cat 4",
					"rgb(22, 163, 74)",
					"rgb(100, 116, 139)",
				],
				"line-width": [
					"interpolate",
					["linear"],
					["zoom"],
					6,
					["case", ["get", "isKeyClimb"], 5, 3],
					12,
					["case", ["get", "isKeyClimb"], 8, 5],
					16,
					["case", ["get", "isKeyClimb"], 11, 7],
				],
				"line-opacity": ["case", ["get", "isKeyClimb"], 0.96, 0.68],
			},
		});
		if (hasGradientFeatures) {
			map.addLayer({
				id: getRouteGradientLayerId(overlay.id),
				type: "line",
				source: sourceId,
				filter: ["==", ["get", "kind"], "gradient"],
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": [
						"match",
						["get", "gradientBucket"],
						"steep_down",
						"rgb(29, 78, 216)",
						"down",
						"rgb(37, 99, 235)",
						"mild_down",
						"rgb(96, 165, 250)",
						"flat",
						"rgb(148, 163, 184)",
						"mild_up",
						"rgb(250, 204, 21)",
						"up",
						"rgb(249, 115, 22)",
						"steep_up",
						"rgb(220, 38, 38)",
						"rgb(100, 116, 139)",
					],
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						4,
						12,
						6,
						16,
						8,
					],
					"line-opacity": 0.9,
				},
			});
		}
	}

	if (!overlay.isSelected) {
		return;
	}

	map.addLayer({
		id: getRouteStartLayerId(overlay.id),
		type: "circle",
		source: sourceId,
		filter: ["==", ["get", "kind"], "start"],
		paint: {
			"circle-color": "rgb(15, 118, 110)",
			"circle-radius": 7,
			"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
			"circle-stroke-width": 3,
		},
	});
	map.addLayer({
		id: getRouteWaypointLayerId(overlay.id),
		type: "circle",
		source: sourceId,
		filter: ["==", ["get", "kind"], "waypoint"],
		paint: {
			"circle-color": "rgb(245, 158, 11)",
			"circle-radius": 6,
			"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
			"circle-stroke-width": 2.5,
		},
	});
	map.addLayer({
		id: getRouteDestinationLayerId(overlay.id),
		type: "circle",
		source: sourceId,
		filter: ["==", ["get", "kind"], "destination"],
		paint: {
			"circle-color": "rgb(37, 99, 235)",
			"circle-radius": 7,
			"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
			"circle-stroke-width": 3,
		},
	});
}

function shouldRecreateRouteOverlay(
	map: MapLibreMap,
	overlay: RouteMapOverlay,
	index: number,
	renderedRouteOverlayIds: string[],
) {
	const previousIndex = renderedRouteOverlayIds.indexOf(overlay.id);

	if (previousIndex < 0 || !map.getSource(getRouteSourceId(overlay.id))) {
		return true;
	}

	if (previousIndex !== index) {
		return true;
	}

	const renderedAsSelected = !!map.getLayer(getRouteStartLayerId(overlay.id));
	if (renderedAsSelected !== overlay.isSelected) {
		return true;
	}

	const renderedWithGradient = !!map.getLayer(
		getRouteGradientLayerId(overlay.id),
	);
	const shouldRenderGradient =
		overlay.isSelected &&
		overlay.geoJson.features.some(
			(feature) => feature.properties?.kind === "gradient",
		);
	return renderedWithGradient !== shouldRenderGradient;
}

export function syncRouteOverlays(
	map: MapLibreMap,
	routeOverlays: RouteMapOverlay[] | null,
	renderedRouteOverlayIds: string[],
) {
	if (!routeOverlays || routeOverlays.length === 0) {
		removeRouteOverlays(map, renderedRouteOverlayIds);
		return [];
	}

	const nextOverlayIds = routeOverlays.map((overlay) => overlay.id);
	const nextOverlayIdSet = new Set(nextOverlayIds);

	for (const overlayId of renderedRouteOverlayIds) {
		if (!nextOverlayIdSet.has(overlayId)) {
			removeRouteOverlayById(map, overlayId);
		}
	}

	for (const [index, overlay] of routeOverlays.entries()) {
		if (
			shouldRecreateRouteOverlay(map, overlay, index, renderedRouteOverlayIds)
		) {
			removeRouteOverlayById(map, overlay.id);
			addRouteOverlay(map, overlay, index);
			continue;
		}

		const existingSource = map.getSource(getRouteSourceId(overlay.id)) as
			| GeoJSONSource
			| undefined;
		existingSource?.setData(overlay.geoJson);
	}

	return nextOverlayIds;
}

export function removeConstraintOverlay(map: MapLibreMap) {
	for (const layerId of [constraintLineLayerId, constraintFillLayerId]) {
		if (map.getLayer(layerId)) map.removeLayer(layerId);
	}
	if (map.getSource(constraintSourceId)) map.removeSource(constraintSourceId);
}

export function syncConstraintOverlay(
	map: MapLibreMap,
	constraintOverlay: FeatureCollection | null,
) {
	if (!constraintOverlay) {
		removeConstraintOverlay(map);
		return;
	}

	const existingSource = map.getSource(constraintSourceId) as
		| GeoJSONSource
		| undefined;
	if (existingSource) existingSource.setData(constraintOverlay);
	else
		map.addSource(constraintSourceId, {
			type: "geojson",
			data: constraintOverlay,
		});

	if (!map.getLayer(constraintFillLayerId)) {
		map.addLayer({
			id: constraintFillLayerId,
			type: "fill",
			source: constraintSourceId,
			paint: {
				"fill-color": "rgba(14, 165, 233, 0.16)",
				"fill-outline-color": "rgba(14, 116, 144, 0.28)",
			},
		});
	}
	if (!map.getLayer(constraintLineLayerId)) {
		map.addLayer({
			id: constraintLineLayerId,
			type: "line",
			source: constraintSourceId,
			layout: { "line-cap": "round", "line-join": "round" },
			paint: {
				"line-color": "rgba(8, 145, 178, 0.72)",
				"line-width": [
					"interpolate",
					["linear"],
					["zoom"],
					6,
					1.2,
					12,
					2,
					16,
					3,
				],
				"line-dasharray": [2, 1.5],
			},
		});
	}
}

export function removeLockedSegmentOverlay(map: MapLibreMap) {
	for (const layerId of [
		lockedSegmentLineLayerId,
		lockedSegmentCasingLayerId,
	]) {
		if (map.getLayer(layerId)) map.removeLayer(layerId);
	}
	if (map.getSource(lockedSegmentSourceId))
		map.removeSource(lockedSegmentSourceId);
}

export function syncLockedSegmentOverlay(
	map: MapLibreMap,
	lockedSegmentOverlay: FeatureCollection | null,
) {
	if (!lockedSegmentOverlay || lockedSegmentOverlay.features.length === 0) {
		removeLockedSegmentOverlay(map);
		return;
	}

	const existingSource = map.getSource(lockedSegmentSourceId) as
		| GeoJSONSource
		| undefined;
	if (existingSource) existingSource.setData(lockedSegmentOverlay);
	else
		map.addSource(lockedSegmentSourceId, {
			type: "geojson",
			data: lockedSegmentOverlay,
		});

	if (!map.getLayer(lockedSegmentCasingLayerId)) {
		map.addLayer({
			id: lockedSegmentCasingLayerId,
			type: "line",
			source: lockedSegmentSourceId,
			layout: { "line-cap": "round", "line-join": "round" },
			paint: {
				"line-color": "rgba(255, 255, 255, 0.9)",
				"line-width": [
					"interpolate",
					["linear"],
					["zoom"],
					6,
					7,
					12,
					10,
					16,
					13,
				],
				"line-opacity": 0.82,
			},
		});
	}
	if (!map.getLayer(lockedSegmentLineLayerId)) {
		map.addLayer({
			id: lockedSegmentLineLayerId,
			type: "line",
			source: lockedSegmentSourceId,
			layout: { "line-cap": "round", "line-join": "round" },
			paint: {
				"line-color": "rgb(217, 119, 6)",
				"line-width": ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 5, 16, 7],
				"line-dasharray": [1.4, 1],
			},
		});
	}
}

export function removeHoveredRouteOverlay(map: MapLibreMap) {
	if (map.getLayer(hoveredRouteLayerId)) map.removeLayer(hoveredRouteLayerId);
	if (map.getSource(hoveredRouteSourceId))
		map.removeSource(hoveredRouteSourceId);
}

export function syncHoveredRouteOverlay(
	map: MapLibreMap,
	hoveredRouteCoordinate: RouteCoordinate | null,
) {
	if (!hoveredRouteCoordinate) {
		removeHoveredRouteOverlay(map);
		return;
	}

	const hoveredPointGeoJson: FeatureCollection = {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties: { kind: "hovered-route-point" },
				geometry: { type: "Point", coordinates: hoveredRouteCoordinate },
			},
		],
	};
	const existingSource = map.getSource(hoveredRouteSourceId) as
		| GeoJSONSource
		| undefined;
	if (existingSource) existingSource.setData(hoveredPointGeoJson);
	else
		map.addSource(hoveredRouteSourceId, {
			type: "geojson",
			data: hoveredPointGeoJson,
		});

	if (!map.getLayer(hoveredRouteLayerId)) {
		map.addLayer({
			id: hoveredRouteLayerId,
			type: "circle",
			source: hoveredRouteSourceId,
			paint: {
				"circle-color": "rgb(16, 185, 129)",
				"circle-radius": [
					"interpolate",
					["linear"],
					["zoom"],
					6,
					5,
					12,
					7,
					16,
					9,
				],
				"circle-stroke-color": "rgba(255, 255, 255, 0.96)",
				"circle-stroke-width": 3,
			},
		});
	}
}

export type CurrentLocation = {
	point: [number, number];
	accuracyMeters?: number;
};

function buildCurrentLocationGeoJson(
	currentLocation: CurrentLocation,
): FeatureCollection {
	const accuracyMeters =
		typeof currentLocation.accuracyMeters === "number" &&
		Number.isFinite(currentLocation.accuracyMeters) &&
		currentLocation.accuracyMeters > 0
			? currentLocation.accuracyMeters
			: null;

	return {
		type: "FeatureCollection",
		features: [
			...(accuracyMeters
				? [
						{
							type: "Feature" as const,
							properties: { kind: "accuracy", accuracyMeters },
							geometry: {
								type: "Point" as const,
								coordinates: currentLocation.point,
							},
						},
					]
				: []),
			{
				type: "Feature" as const,
				properties: { kind: "current-location" },
				geometry: {
					type: "Point" as const,
					coordinates: currentLocation.point,
				},
			},
		],
	};
}

export function removeCurrentLocationOverlay(map: MapLibreMap) {
	for (const layerId of [
		currentLocationPointLayerId,
		currentLocationAccuracyLayerId,
	]) {
		if (map.getLayer(layerId)) map.removeLayer(layerId);
	}
	if (map.getSource(currentLocationSourceId))
		map.removeSource(currentLocationSourceId);
}

export function syncCurrentLocationOverlay(
	map: MapLibreMap,
	currentLocation: CurrentLocation | null,
) {
	if (!currentLocation) {
		removeCurrentLocationOverlay(map);
		return;
	}

	const locationGeoJson = buildCurrentLocationGeoJson(currentLocation);
	const existingSource = map.getSource(currentLocationSourceId) as
		| GeoJSONSource
		| undefined;
	if (existingSource) existingSource.setData(locationGeoJson);
	else
		map.addSource(currentLocationSourceId, {
			type: "geojson",
			data: locationGeoJson,
		});

	if (!map.getLayer(currentLocationAccuracyLayerId)) {
		map.addLayer({
			id: currentLocationAccuracyLayerId,
			type: "circle",
			source: currentLocationSourceId,
			filter: ["==", ["get", "kind"], "accuracy"],
			paint: {
				"circle-color": "rgba(14, 165, 233, 0.16)",
				"circle-radius": [
					"interpolate",
					["linear"],
					["zoom"],
					8,
					["max", 10, ["/", ["get", "accuracyMeters"], 18]],
					14,
					["max", 18, ["/", ["get", "accuracyMeters"], 3]],
					17,
					["max", 28, ["/", ["get", "accuracyMeters"], 0.85]],
				],
				"circle-stroke-color": "rgba(14, 165, 233, 0.35)",
				"circle-stroke-width": 1.5,
			},
		});
	}
	if (!map.getLayer(currentLocationPointLayerId)) {
		map.addLayer({
			id: currentLocationPointLayerId,
			type: "circle",
			source: currentLocationSourceId,
			filter: ["==", ["get", "kind"], "current-location"],
			paint: {
				"circle-color": "rgb(14, 165, 233)",
				"circle-radius": [
					"interpolate",
					["linear"],
					["zoom"],
					6,
					6,
					12,
					8,
					16,
					10,
				],
				"circle-stroke-color": "rgba(255, 255, 255, 0.98)",
				"circle-stroke-width": 3,
			},
		});
	}
}
