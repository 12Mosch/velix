import type { FeatureCollection } from "geojson";

import type { SidebarLayoutState } from "$lib/components/ui/sidebar/context.svelte.js";
import type {
	PlannedRoute,
	RouteBounds,
	RouteCoordinate,
	RouteMapOverlay,
	RouteMode,
} from "$lib/route-planning";
import type {
	RouteSegmentDetail,
	RouteStopDragEndDetail,
	SelectedRouteStop,
} from "$lib/map/route-edit-interactions";

export type MapViewProps = {
	initialCenter?: [number, number];
	initialZoom?: number;
	ariaLabel?: string;
	routeOverlays?: RouteMapOverlay[] | null;
	plannedRoute?: PlannedRoute | null;
	routeMode?: RouteMode | null;
	manualEditingEnabled?: boolean;
	lockedSegmentOverlay?: FeatureCollection | null;
	lockedSegmentIndexes?: number[];
	constraintOverlay?: FeatureCollection | null;
	avoidanceOverlay?: FeatureCollection | null;
	fitBounds?: RouteBounds | null;
	fitInitialBoundsWithRestoredCamera?: boolean;
	manualRecenterBounds?: RouteBounds | null;
	manualRecenterRequestKey?: number;
	hoveredRouteCoordinate?: RouteCoordinate | null;
	focusedRouteCoordinate?: RouteCoordinate | null;
	focusedRouteCoordinateKey?: number;
	currentLocation?: {
		point: [number, number];
		accuracyMeters?: number;
	} | null;
	currentLocationFocusKey?: number;
	layoutState?: SidebarLayoutState | null;
	onMapClick?:
		| ((detail: {
				point: [number, number];
				screenPoint: {
					x: number;
					y: number;
				};
				selectedStop?: SelectedRouteStop;
				selectedSegment?: {
					coordinateSegmentIndex: number;
					segmentIndex: number;
				};
		  }) => void)
		| null;
	onRouteStopDragEnd?: ((detail: RouteStopDragEndDetail) => void) | null;
	onRouteSegmentDragEnd?: ((detail: RouteSegmentDetail) => void) | null;
	onRouteSegmentSelection?: ((detail: RouteSegmentDetail) => void) | null;
};
