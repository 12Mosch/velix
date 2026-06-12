import type { RequestEvent } from "@sveltejs/kit";

import type {
	LegacyRouteRequestPayloadInput,
	RouteRequestPayloadInput,
} from "$lib/route-api-schema";
import type {
	ManualRouteEditingState,
	RouteAvoidanceInput,
	RouteFieldErrors,
	RouteMode,
	RouteSpatialConstraintInput,
	RouteStopInput,
} from "$lib/route-planning";

export type RouteRequestEvent = Pick<RequestEvent, "getClientAddress">;

export type RouteModeContext = {
	event: RouteRequestEvent;
	payloadRecord: Record<string, unknown>;
	startInput: RouteStopInput;
	spatialConstraintInput?: RouteSpatialConstraintInput;
	avoidanceInputs?: RouteAvoidanceInput[];
	manualEditing?: ManualRouteEditingState;
	fieldErrors: RouteFieldErrors;
	structuredPointToPointPayload: RouteRequestPayloadInput | null;
	structuredOutAndBackPayload: RouteRequestPayloadInput | null;
	legacyPayload: LegacyRouteRequestPayloadInput | null;
};

export type PreparedRouteModeContext = {
	requestedMode: RouteMode;
	context: RouteModeContext;
};
