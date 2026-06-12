import type {
	ControlPosition,
	IControl,
	Map as MapLibreMap,
	ScaleControlOptions,
} from "maplibre-gl";

export const scaleControlPosition: ControlPosition = "bottom-left";

export type MapScaleControlState = {
	control: IControl | null;
	unit: "metric" | "imperial" | null;
};

export const emptyMapScaleControlState: MapScaleControlState = {
	control: null,
	unit: null,
};

export function removeMapScaleControl(
	map: MapLibreMap | null,
	state: MapScaleControlState,
): MapScaleControlState {
	if (map && state.control) {
		map.removeControl(state.control);
	}

	return emptyMapScaleControlState;
}

export function syncMapScaleControl({
	map,
	maplibreglModule,
	state,
	unit,
}: {
	map: MapLibreMap | null;
	maplibreglModule: typeof import("maplibre-gl") | null;
	state: MapScaleControlState;
	unit: "metric" | "imperial";
}): MapScaleControlState {
	if (!map || !maplibreglModule) {
		return state;
	}

	if (state.control && state.unit === unit) {
		return state;
	}

	const nextState = removeMapScaleControl(map, state);
	const control = new maplibreglModule.ScaleControl({
		maxWidth: 96,
		unit,
	} satisfies ScaleControlOptions);

	map.addControl(control, scaleControlPosition);

	return {
		...nextState,
		control,
		unit,
	};
}
