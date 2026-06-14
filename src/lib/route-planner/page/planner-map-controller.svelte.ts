import { Effect, Option } from "effect";
import { getBasemapById } from "$lib/map/basemaps";
import {
	basemapOptions,
	mapStylePreference,
	setMapStylePreference,
	type BasemapId,
} from "$lib/map-style-settings.svelte";
import {
	getRouteLegIndexForCoordinateSegment,
	getRouteSegmentCount,
	getWaypointInsertionIndex,
	sanitizeLockedSegmentIndexes,
	type PlannedRoute,
	type ResolvedRouteAvoidance,
} from "$lib/route-planning";
import { maxWaypoints } from "$lib/route-planner/constants";
import { formatCoordinateLabel } from "$lib/route-planner/formatters";
import {
	buildAvoidancePlaceholderPolygon,
	findAvoidanceNearSelection,
} from "$lib/route-planner/page/map-selection";
import { createPlannerStop } from "$lib/route-planner/page/planner-state";
import type {
	CurrentLocation,
	MapClickSelection,
	PlannerMode,
	PlannerStop,
	ReverseGeocodeApiSuccess,
	RouteField,
	RouteSegmentDragEnd,
	RouteStopDragEnd,
	SelectedMapStop,
} from "$lib/route-planner/types";
import {
	PlannerGeolocationError,
	PlannerReverseGeocodeError,
} from "./planner-controller-errors";

type AsyncRouteEditResult = "committed" | "noop" | "rollback";
type MapPointStopTarget =
	| { kind: "startQuery" }
	| { kind: "destinationQuery" }
	| { kind: "waypoint" };

type PlannerMapControllerDependencies = {
	getFetch: () => typeof window.fetch | null;
	getActiveRoute: () => PlannedRoute | null;
	getPlannerMode: () => PlannerMode;
	getWaypointStops: () => PlannerStop[];
	getStartStop: () => PlannerStop;
	getDestinationStop: () => PlannerStop;
	setFieldStop: (field: RouteField, stop: PlannerStop) => void;
	setWaypointStop: (index: number, stop: PlannerStop) => void;
	addWaypoint: (
		stop?: PlannerStop,
		index?: number,
		recordHistory?: boolean,
	) => boolean;
	removeWaypoint: (index: number, recordHistory?: boolean) => boolean;
	closeCompletionMenu: () => void;
	performRouteEdit: (editFn: () => boolean | undefined) => void;
	performAsyncRouteEdit: (
		editFn: () => Effect.Effect<AsyncRouteEditResult>,
		options?: { includeRoutesGeometry?: boolean },
	) => Effect.Effect<AsyncRouteEditResult | undefined>;
	rerouteAfterManualEdit: () => Effect.Effect<boolean>;
	isLockedStopIndex: (index: number) => boolean;
	getRouteNeedsRecalculation: () => boolean;
	getIsRouting: () => boolean;
	getLockedSegmentIndexes: () => number[];
	setLockedSegmentIndexes: (indexes: number[]) => void;
	syncActiveRouteManualEditing: (indexes: number[]) => void;
	getAvoidedRoads: () => ResolvedRouteAvoidance[];
	setAvoidedRoads: (avoidances: ResolvedRouteAvoidance[]) => void;
	markPlannerEdited: (options?: { requiresRecalculation?: boolean }) => void;
	scheduleActiveRouteAutosave: () => void;
	setRouteRequestError: (error: string | null) => void;
};

function getCurrentLocationUnavailableMessage() {
	return "Current location is unavailable. Check browser location permissions.";
}

function getCurrentLocationStop(
	point: [number, number],
	label: string,
): PlannerStop {
	return createPlannerStop(label, point, "currentLocation");
}

export function createPlannerMapController(
	dependencies: PlannerMapControllerDependencies,
) {
	let mapClickSelection = $state<MapClickSelection | null>(null);
	let isResolvingMapSelection = $state(false);
	let currentLocation = $state<CurrentLocation | null>(null);
	let currentLocationFocusKey = $state(0);
	let recenterRouteRequestKey = $state(0);
	let isLocating = $state(false);
	let currentLocationError = $state<string | null>(null);

	function getSelectedBasemap() {
		return mapStylePreference.selectedBasemapId
			? getBasemapById(mapStylePreference.selectedBasemapId)
			: null;
	}

	function getAvailableBasemapOptions() {
		return basemapOptions.filter((basemap) => basemap.available);
	}

	function getActiveRouteSegmentCount() {
		const activeRoute = dependencies.getActiveRoute();
		return activeRoute ? getRouteSegmentCount(activeRoute) : 0;
	}

	function getSanitizedLockedSegmentIndexes() {
		return sanitizeLockedSegmentIndexes(
			dependencies.getLockedSegmentIndexes(),
			getActiveRouteSegmentCount(),
		);
	}

	const getCurrentPositionEffect = Effect.fn("getCurrentPositionEffect")(
		function* () {
			if (typeof navigator === "undefined" || !navigator.geolocation) {
				return yield* new PlannerGeolocationError({
					cause: new Error("Geolocation is not supported."),
				});
			}

			return yield* Effect.callback<
				GeolocationPosition,
				PlannerGeolocationError
			>((resume) => {
				navigator.geolocation.getCurrentPosition(
					(position) => resume(Effect.succeed(position)),
					(cause) =>
						resume(Effect.fail(new PlannerGeolocationError({ cause }))),
					{
						enableHighAccuracy: true,
						timeout: 10000,
						maximumAge: 30000,
					},
				);
			});
		},
	);

	const reverseGeocodeLabelEffect = Effect.fn("reverseGeocodeLabelEffect")(
		function* (point: [number, number], fallbackLabel: string) {
			const clientFetch = dependencies.getFetch();
			if (!clientFetch) {
				return fallbackLabel;
			}

			const response = yield* Effect.tryPromise({
				try: () =>
					clientFetch(
						`/api/route/reverse?lat=${encodeURIComponent(String(point[1]))}&lng=${encodeURIComponent(String(point[0]))}`,
					),
				catch: (cause) => new PlannerReverseGeocodeError({ point, cause }),
			});

			if (!response.ok) {
				return yield* new PlannerReverseGeocodeError({
					point,
					cause: new Error(
						`Reverse geocoding failed with status ${response.status}`,
					),
				});
			}

			const payload = yield* Effect.tryPromise({
				try: () =>
					response.json() as Promise<Partial<ReverseGeocodeApiSuccess>>,
				catch: (cause) => new PlannerReverseGeocodeError({ point, cause }),
			});

			return typeof payload.label === "string" &&
				payload.label.trim().length > 0
				? payload.label
				: fallbackLabel;
		},
	);

	function resolveMapStopLabelEffect(point: [number, number]) {
		return reverseGeocodeLabelEffect(point, formatCoordinateLabel(point)).pipe(
			Effect.catchTag("PlannerReverseGeocodeError", (error) =>
				Effect.sync(() => {
					console.error(
						"Failed to reverse geocode clicked map point",
						error.cause,
					);
					return formatCoordinateLabel(point);
				}),
			),
		);
	}

	function resolveCurrentLocationLabelEffect(point: [number, number]) {
		return reverseGeocodeLabelEffect(point, "Current location").pipe(
			Effect.catchTag("PlannerReverseGeocodeError", (error) =>
				Effect.sync(() => {
					console.error(
						"Failed to reverse geocode current location",
						error.cause,
					);
					return "Current location";
				}),
			),
		);
	}

	const locateCurrentPositionEffect = Effect.fn("locateCurrentPositionEffect")(
		function* () {
			if (isLocating) {
				return null;
			}

			isLocating = true;
			currentLocationError = null;

			return yield* Effect.gen(function* () {
				const position = yield* getCurrentPositionEffect();
				const point: [number, number] = [
					position.coords.longitude,
					position.coords.latitude,
				];
				const nextLocation: CurrentLocation = {
					point,
					accuracyMeters:
						typeof position.coords.accuracy === "number" &&
						Number.isFinite(position.coords.accuracy)
							? position.coords.accuracy
							: undefined,
				};

				currentLocation = nextLocation;
				currentLocationFocusKey += 1;
				return nextLocation;
			}).pipe(
				Effect.catchTag("PlannerGeolocationError", (error) =>
					Effect.sync(() => {
						console.error("Failed to get current location", error.cause);
						currentLocationError = getCurrentLocationUnavailableMessage();
						return null;
					}),
				),
				Effect.ensuring(
					Effect.sync(() => {
						isLocating = false;
					}),
				),
			);
		},
	);

	const showCurrentLocationOnMap = Effect.fn("showCurrentLocationOnMap")(
		function* () {
			dependencies.closeCompletionMenu();
			closeMapClickMenu();
			yield* locateCurrentPositionEffect();
		},
	);

	function recenterActiveRoute() {
		if (
			!dependencies.getActiveRoute() ||
			dependencies.getRouteNeedsRecalculation()
		) {
			return;
		}

		dependencies.closeCompletionMenu();
		closeMapClickMenu();
		recenterRouteRequestKey += 1;
	}

	function closeMapClickMenu() {
		mapClickSelection = null;
		isResolvingMapSelection = false;
	}

	function handleMapClick(selection: MapClickSelection) {
		dependencies.closeCompletionMenu();
		mapClickSelection = selection;
	}

	function getMapClickMenuTitle(selection: MapClickSelection) {
		if (selection.selectedStop) {
			return "Selected point";
		}

		if (selection.selectedSegment) {
			return "Selected segment";
		}

		return "Use clicked point";
	}

	function getMapClickMenuSubtitle(selection: MapClickSelection) {
		if (selection.selectedSegment) {
			const segmentIndex = getSelectedSegmentIndex(selection);
			return typeof segmentIndex === "number"
				? `Segment ${segmentIndex + 1}`
				: "Route segment";
		}

		return (
			selection.selectedStop?.label || formatCoordinateLabel(selection.point)
		);
	}

	function getRemoveActionLabel(selectedStop: SelectedMapStop) {
		if (selectedStop.kind === "start") {
			return "Remove start";
		}

		if (selectedStop.kind === "destination") {
			return dependencies.getPlannerMode() === "out_and_back"
				? "Remove turnaround"
				: "Remove destination";
		}

		if (selectedStop.kind === "waypoint") {
			if (dependencies.getPlannerMode() === "out_and_back") {
				return "Remove turnaround";
			}

			return `Remove waypoint ${selectedStop.index + 1}`;
		}

		return "Remove stop";
	}

	function removeSelectedMapStop(
		selectedStop: SelectedMapStop,
		recordHistory = true,
	): boolean {
		const activeRoute = dependencies.getActiveRoute();
		if (recordHistory && activeRoute) {
			let changed = false;
			dependencies.performRouteEdit(() => {
				changed = removeSelectedMapStop(selectedStop, false);
				return changed;
			});
			return changed;
		}

		const waypointStops = dependencies.getWaypointStops();
		const selectedStopIndex = (() => {
			if (selectedStop.kind === "start") {
				return 0;
			}

			return selectedStop.kind === "waypoint"
				? selectedStop.index + 1
				: waypointStops.length + 1;
		})();

		if (dependencies.isLockedStopIndex(selectedStopIndex)) {
			return false;
		}

		if (selectedStop.kind === "start") {
			dependencies.setFieldStop("startQuery", createPlannerStop());
			closeMapClickMenu();
			return true;
		}

		if (selectedStop.kind === "destination") {
			dependencies.setFieldStop("destinationQuery", createPlannerStop());
			closeMapClickMenu();
			return true;
		}

		if (selectedStop.kind === "waypoint") {
			if (dependencies.getPlannerMode() === "out_and_back") {
				dependencies.setFieldStop("destinationQuery", createPlannerStop());
				closeMapClickMenu();
				return true;
			}

			const changed = dependencies.removeWaypoint(selectedStop.index, false);
			closeMapClickMenu();
			return changed;
		}

		return false;
	}

	function getSelectedSegmentIndex(selection: MapClickSelection) {
		const activeRoute = dependencies.getActiveRoute();
		const selectedSegment = selection.selectedSegment;
		if (!activeRoute || !selectedSegment) {
			return null;
		}

		return Option.getOrElse(
			getRouteLegIndexForCoordinateSegment(
				activeRoute,
				selectedSegment.coordinateSegmentIndex,
			),
			() => selectedSegment.segmentIndex,
		);
	}

	function isMapSelectionSegmentLocked(selection: MapClickSelection) {
		const segmentIndex = getSelectedSegmentIndex(selection);
		return segmentIndex === null
			? false
			: getSanitizedLockedSegmentIndexes().includes(segmentIndex);
	}

	function toggleMapSelectionSegmentLock(
		selection: MapClickSelection,
		recordHistory = true,
	): boolean {
		if (dependencies.getRouteNeedsRecalculation()) {
			return false;
		}

		if (recordHistory && dependencies.getActiveRoute()) {
			let changed = false;
			dependencies.performRouteEdit(() => {
				changed = toggleMapSelectionSegmentLock(selection, false);
				return changed;
			});
			return changed;
		}

		const activeRoute = dependencies.getActiveRoute();
		const segmentIndex = getSelectedSegmentIndex(selection);

		if (!activeRoute || segmentIndex === null) {
			return false;
		}

		const sanitizedLockedSegmentIndexes = getSanitizedLockedSegmentIndexes();
		const nextLockedSegmentIndexes = sanitizedLockedSegmentIndexes.includes(
			segmentIndex,
		)
			? sanitizedLockedSegmentIndexes.filter((index) => index !== segmentIndex)
			: sanitizeLockedSegmentIndexes(
					[...sanitizedLockedSegmentIndexes, segmentIndex],
					getRouteSegmentCount(activeRoute),
				);
		dependencies.setLockedSegmentIndexes(nextLockedSegmentIndexes);
		dependencies.syncActiveRouteManualEditing(nextLockedSegmentIndexes);
		dependencies.markPlannerEdited({ requiresRecalculation: false });
		closeMapClickMenu();
		dependencies.scheduleActiveRouteAutosave();
		return true;
	}

	function getAvoidanceForSelection(selection: MapClickSelection) {
		if (!selection.selectedSegment) {
			return null;
		}

		return findAvoidanceNearSelection(
			selection.point,
			dependencies.getAvoidedRoads(),
		);
	}

	function isMapSelectionRoadAvoided(selection: MapClickSelection) {
		return !!selection.selectedSegment && !!getAvoidanceForSelection(selection);
	}

	function getSelectedAvoidanceCenterline(selection: MapClickSelection) {
		const activeRoute = dependencies.getActiveRoute();
		if (!activeRoute || !selection.selectedSegment) {
			return null;
		}

		const selectedIndex = selection.selectedSegment.coordinateSegmentIndex;
		const startIndex = Math.max(0, selectedIndex - 3);
		const endIndex = Math.min(
			activeRoute.coordinates.length - 1,
			selectedIndex + 4,
		);
		const centerline = activeRoute.coordinates
			.slice(startIndex, endIndex + 1)
			.map((coordinate): [number, number] => [coordinate[0], coordinate[1]])
			.slice(0, 8);

		return centerline.length >= 2 ? centerline : null;
	}

	const toggleMapSelectionRoadAvoidance = Effect.fn(
		"toggleMapSelectionRoadAvoidance",
	)(function* (selection: MapClickSelection) {
		if (
			!dependencies.getActiveRoute() ||
			dependencies.getRouteNeedsRecalculation() ||
			!selection.selectedSegment ||
			dependencies.getIsRouting()
		) {
			return false;
		}

		dependencies.closeCompletionMenu();
		closeMapClickMenu();
		const outcome = yield* dependencies.performAsyncRouteEdit(
			() =>
				Effect.gen(function* () {
					const targetAvoidance = getAvoidanceForSelection(selection);

					if (targetAvoidance) {
						dependencies.setAvoidedRoads(
							dependencies
								.getAvoidedRoads()
								.filter((avoidance) => avoidance !== targetAvoidance),
						);
						return (yield* dependencies.rerouteAfterManualEdit())
							? "committed"
							: "rollback";
					}

					const centerline = getSelectedAvoidanceCenterline(selection);
					if (!centerline) {
						return "noop";
					}

					const bufferMeters = 35;
					const avoidedRoads = dependencies.getAvoidedRoads();
					dependencies.setAvoidedRoads([
						...avoidedRoads,
						{
							kind: "road_segment",
							label: `Avoided road ${avoidedRoads.length + 1}`,
							centerline,
							bufferMeters,
							polygon: buildAvoidancePlaceholderPolygon(
								centerline,
								bufferMeters,
							),
						},
					]);
					return (yield* dependencies.rerouteAfterManualEdit())
						? "committed"
						: "rollback";
				}),
			{ includeRoutesGeometry: true },
		);
		return outcome === "committed";
	});

	function getWaypointInsertionTarget(point: [number, number]) {
		const startStop = dependencies.getStartStop();
		const waypointStops = dependencies.getWaypointStops();
		const destinationStop = dependencies.getDestinationStop();
		const hasCompleteOrderedStops =
			dependencies.getPlannerMode() === "point_to_point" &&
			!!startStop.point &&
			startStop.label.trim().length > 0 &&
			!!destinationStop.point &&
			destinationStop.label.trim().length > 0 &&
			waypointStops.every(
				(waypoint) => waypoint.label.trim().length > 0 && !!waypoint.point,
			);

		if (hasCompleteOrderedStops) {
			return getWaypointInsertionIndex(
				[startStop, ...waypointStops, destinationStop],
				point,
				dependencies.getActiveRoute(),
			);
		}

		return waypointStops.length;
	}

	function getMapWaypointInsertionSegmentIndex(selection: MapClickSelection) {
		return (
			getSelectedSegmentIndex(selection) ??
			getWaypointInsertionTarget(selection.point)
		);
	}

	function isMapWaypointInsertionLocked(selection: MapClickSelection) {
		const segmentIndex = getMapWaypointInsertionSegmentIndex(selection);
		return getSanitizedLockedSegmentIndexes().includes(segmentIndex);
	}

	const applyMapPointAsStop = Effect.fn("applyMapPointAsStop")(function* (
		target: MapPointStopTarget,
		recordHistory = true,
	): Effect.fn.Return<boolean> {
		if (recordHistory && dependencies.getActiveRoute()) {
			let changed = false;
			yield* dependencies.performAsyncRouteEdit(() =>
				Effect.gen(function* (): Effect.fn.Return<AsyncRouteEditResult> {
					changed = yield* applyMapPointAsStop(target, false);
					return changed ? "committed" : "noop";
				}),
			);
			return changed;
		}

		const selection = mapClickSelection;

		if (!selection) {
			return false;
		}

		isResolvingMapSelection = true;
		dependencies.closeCompletionMenu();
		const fallbackStop = createPlannerStop(
			formatCoordinateLabel(selection.point),
			selection.point,
			"map",
		);

		if (target.kind === "startQuery") {
			dependencies.setFieldStop("startQuery", fallbackStop);
		} else if (target.kind === "destinationQuery") {
			dependencies.setFieldStop("destinationQuery", fallbackStop);
		} else {
			if (isMapWaypointInsertionLocked(selection)) {
				isResolvingMapSelection = false;
				return false;
			}

			const inserted = dependencies.addWaypoint(
				fallbackStop,
				getMapWaypointInsertionSegmentIndex(selection),
				false,
			);
			if (!inserted) {
				isResolvingMapSelection = false;
				return false;
			}
		}

		closeMapClickMenu();
		const resolvedLabel = yield* resolveMapStopLabelEffect(selection.point);

		if (target.kind === "startQuery") {
			const startStop = dependencies.getStartStop();
			if (
				startStop.source === "map" &&
				startStop.point?.[0] === selection.point[0] &&
				startStop.point?.[1] === selection.point[1]
			) {
				dependencies.setFieldStop("startQuery", {
					...startStop,
					label: resolvedLabel,
				});
			}
			return true;
		}

		if (target.kind === "destinationQuery") {
			const destinationStop = dependencies.getDestinationStop();
			if (
				destinationStop.source === "map" &&
				destinationStop.point?.[0] === selection.point[0] &&
				destinationStop.point?.[1] === selection.point[1]
			) {
				dependencies.setFieldStop("destinationQuery", {
					...destinationStop,
					label: resolvedLabel,
				});
			}
			return true;
		}

		dependencies.getWaypointStops().forEach((waypoint, index) => {
			if (
				waypoint.source === "map" &&
				waypoint.point?.[0] === selection.point[0] &&
				waypoint.point?.[1] === selection.point[1]
			) {
				dependencies.setWaypointStop(index, {
					...waypoint,
					label: resolvedLabel,
				});
			}
		});
		return true;
	});

	function updateDraggedStop(
		selectedStop: SelectedMapStop,
		point: [number, number],
		label: string,
	) {
		const stop = createPlannerStop(label, point, "map");

		if (selectedStop.kind === "start") {
			dependencies.setFieldStop("startQuery", stop);
			return;
		}

		if (selectedStop.kind === "destination") {
			dependencies.setFieldStop("destinationQuery", stop);
			return;
		}

		if (selectedStop.kind !== "waypoint") {
			return;
		}

		const waypointStops = dependencies.getWaypointStops();
		if (
			dependencies.getPlannerMode() === "out_and_back" &&
			selectedStop.index >= waypointStops.length
		) {
			dependencies.setFieldStop("destinationQuery", stop);
			return;
		}

		if (selectedStop.index >= 0 && selectedStop.index < waypointStops.length) {
			dependencies.setWaypointStop(selectedStop.index, stop);
		}
	}

	function plannerStopsMatch(
		left: PlannerStop | null,
		right: PlannerStop | null,
	) {
		if (!left || !right) {
			return left === right;
		}

		const leftPoint = left.point;
		const rightPoint = right.point;

		return (
			left.source === right.source &&
			left.label === right.label &&
			((!leftPoint && !rightPoint) ||
				(!!leftPoint &&
					!!rightPoint &&
					leftPoint[0] === rightPoint[0] &&
					leftPoint[1] === rightPoint[1]))
		);
	}

	function getFieldStop(field: RouteField) {
		switch (field) {
			case "startQuery":
				return dependencies.getStartStop();
			case "destinationQuery":
				return dependencies.getDestinationStop();
			default: {
				const exhaustive: never = field;
				return exhaustive;
			}
		}
	}

	function getSelectedMapStopCurrentStop(selectedStop: SelectedMapStop) {
		if (selectedStop.kind === "start") {
			return dependencies.getStartStop();
		}

		if (selectedStop.kind === "destination") {
			return dependencies.getDestinationStop();
		}

		if (selectedStop.kind !== "waypoint") {
			return null;
		}

		const waypointStops = dependencies.getWaypointStops();
		if (
			dependencies.getPlannerMode() === "out_and_back" &&
			selectedStop.index >= waypointStops.length
		) {
			return dependencies.getDestinationStop();
		}

		return waypointStops[selectedStop.index] ?? null;
	}

	function isActiveRouteFresh(activeRoute: PlannedRoute) {
		return (
			dependencies.getActiveRoute() === activeRoute &&
			!dependencies.getRouteNeedsRecalculation()
		);
	}

	const handleRouteStopDragEnd = Effect.fn("handleRouteStopDragEnd")(function* (
		detail: RouteStopDragEnd,
	) {
		const activeRoute = dependencies.getActiveRoute();
		if (!activeRoute || dependencies.getRouteNeedsRecalculation()) {
			return;
		}

		if (dependencies.isLockedStopIndex(detail.stopIndex)) {
			return;
		}

		const draggedStopSnapshot = getSelectedMapStopCurrentStop(
			detail.selectedStop,
		);

		dependencies.closeCompletionMenu();
		closeMapClickMenu();
		yield* dependencies.performAsyncRouteEdit(
			() =>
				Effect.gen(function* () {
					const label = yield* resolveMapStopLabelEffect(detail.point);
					if (
						!isActiveRouteFresh(activeRoute) ||
						dependencies.isLockedStopIndex(detail.stopIndex) ||
						!plannerStopsMatch(
							getSelectedMapStopCurrentStop(detail.selectedStop),
							draggedStopSnapshot,
						)
					) {
						return "noop";
					}

					updateDraggedStop(detail.selectedStop, detail.point, label);
					return (yield* dependencies.rerouteAfterManualEdit())
						? "committed"
						: "rollback";
				}),
			{ includeRoutesGeometry: true },
		);
	});

	function getManualSegmentWaypointIndex(segmentIndex: number): number | null {
		const waypointStops = dependencies.getWaypointStops();
		if (waypointStops.length === 0) {
			return null;
		}

		if (dependencies.getPlannerMode() === "round_course") {
			const index = segmentIndex === 0 ? 0 : segmentIndex - 1;
			return index >= 0 && index < waypointStops.length ? index : null;
		}

		const index = segmentIndex - 1;
		return index >= 0 && index < waypointStops.length ? index : null;
	}

	const handleRouteSegmentDragEnd = Effect.fn("handleRouteSegmentDragEnd")(
		function* (detail: RouteSegmentDragEnd) {
			const activeRoute = dependencies.getActiveRoute();
			if (!activeRoute || dependencies.getRouteNeedsRecalculation()) {
				return;
			}

			const routeLegIndex = Option.getOrElse(
				getRouteLegIndexForCoordinateSegment(
					activeRoute,
					detail.coordinateSegmentIndex,
				),
				() => detail.segmentIndex,
			);

			if (getSanitizedLockedSegmentIndexes().includes(routeLegIndex)) {
				return;
			}

			const existingWaypointIndex =
				getManualSegmentWaypointIndex(routeLegIndex);
			const waypointCount = dependencies.getWaypointStops().length;
			const existingWaypointSnapshot =
				existingWaypointIndex !== null
					? (dependencies.getWaypointStops()[existingWaypointIndex] ?? null)
					: null;

			dependencies.closeCompletionMenu();
			closeMapClickMenu();
			yield* dependencies.performAsyncRouteEdit(
				() =>
					Effect.gen(function* () {
						const label = yield* resolveMapStopLabelEffect(detail.point);

						if (
							!isActiveRouteFresh(activeRoute) ||
							getSanitizedLockedSegmentIndexes().includes(routeLegIndex) ||
							dependencies.getWaypointStops().length !== waypointCount ||
							getManualSegmentWaypointIndex(routeLegIndex) !==
								existingWaypointIndex ||
							(existingWaypointIndex !== null &&
								!plannerStopsMatch(
									dependencies.getWaypointStops()[existingWaypointIndex] ??
										null,
									existingWaypointSnapshot,
								))
						) {
							return "noop";
						}

						const stop = createPlannerStop(label, detail.point, "map");

						if (existingWaypointIndex !== null) {
							dependencies.setWaypointStop(existingWaypointIndex, stop);
						} else {
							const waypointStops = dependencies.getWaypointStops();
							if (waypointStops.length >= maxWaypoints) {
								dependencies.setRouteRequestError(
									`You can add up to ${maxWaypoints} waypoints per route.`,
								);
								return "noop";
							}

							dependencies.addWaypoint(
								stop,
								Math.max(0, Math.min(routeLegIndex, waypointStops.length)),
								false,
							);
						}

						return (yield* dependencies.rerouteAfterManualEdit())
							? "committed"
							: "rollback";
					}),
				{ includeRoutesGeometry: true },
			);
		},
	);

	const useCurrentLocationAsStopEffect = Effect.fn(
		"useCurrentLocationAsStopEffect",
	)(function* (field: RouteField) {
		dependencies.closeCompletionMenu();
		closeMapClickMenu();
		const targetStopSnapshot = getFieldStop(field);
		const location = yield* locateCurrentPositionEffect();

		if (!location) {
			return;
		}

		const label = yield* resolveCurrentLocationLabelEffect(location.point);
		if (!plannerStopsMatch(getFieldStop(field), targetStopSnapshot)) {
			return;
		}

		dependencies.setFieldStop(
			field,
			getCurrentLocationStop(location.point, label),
		);
	});

	function useCurrentLocationAsStop(field: RouteField) {
		return useCurrentLocationAsStopEffect(field);
	}

	function chooseBasemap(id: BasemapId) {
		const basemap = getAvailableBasemapOptions().find(
			(option) => option.id === id,
		);

		if (basemap) {
			Effect.runSync(setMapStylePreference(basemap.id));
		}
	}

	return {
		get mapClickSelection() {
			return mapClickSelection;
		},
		get isResolvingMapSelection() {
			return isResolvingMapSelection;
		},
		get currentLocation() {
			return currentLocation;
		},
		get currentLocationFocusKey() {
			return currentLocationFocusKey;
		},
		get recenterRouteRequestKey() {
			return recenterRouteRequestKey;
		},
		get isLocating() {
			return isLocating;
		},
		get currentLocationError() {
			return currentLocationError;
		},
		get selectedBasemap() {
			return getSelectedBasemap();
		},
		get availableBasemapOptions() {
			return getAvailableBasemapOptions();
		},
		showCurrentLocationOnMap,
		recenterActiveRoute,
		closeMapClickMenu,
		handleMapClick,
		getMapClickMenuTitle,
		getMapClickMenuSubtitle,
		getRemoveActionLabel,
		removeSelectedMapStop,
		getSelectedSegmentIndex,
		isMapSelectionSegmentLocked,
		toggleMapSelectionSegmentLock,
		getAvoidanceForSelection,
		isMapSelectionRoadAvoided,
		toggleMapSelectionRoadAvoidance,
		getMapWaypointInsertionSegmentIndex,
		isMapWaypointInsertionLocked,
		applyMapPointAsStop,
		handleRouteStopDragEnd,
		handleRouteSegmentDragEnd,
		useCurrentLocationAsStop,
		chooseBasemap,
	};
}

export type PlannerMapController = ReturnType<
	typeof createPlannerMapController
>;
