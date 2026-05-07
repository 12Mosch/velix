type GeocodeProvider = "default" | "nominatim";

export const missingGraphHopperApiKeyMessage = "Missing GRAPHHOPPER_API_KEY";

export class MissingGraphHopperApiKeyError extends Error {
	readonly _tag = "MissingGraphHopperApiKeyError";

	constructor() {
		super(missingGraphHopperApiKeyMessage);
	}
}

export class GraphHopperGeocodeFetchError extends Error {
	readonly _tag = "GraphHopperGeocodeFetchError";

	constructor(
		readonly operation: "geocoding" | "reverse geocoding",
		readonly provider: GeocodeProvider,
		readonly cause: unknown,
	) {
		super(
			cause instanceof Error
				? cause.message
				: `${operation[0]?.toUpperCase()}${operation.slice(1)} failed using ${provider}`,
		);
	}
}

export class GraphHopperGeocodeStatusError extends Error {
	readonly _tag = "GraphHopperGeocodeStatusError";

	constructor(
		readonly operation: "Geocoding" | "Reverse geocoding",
		readonly provider: GeocodeProvider,
		readonly status: number,
		readonly details: string,
	) {
		super(
			`${operation} failed with status ${status} using ${provider}${
				details ? `: ${details}` : ""
			}`,
		);
	}
}

export class GraphHopperGeocodePayloadError extends Error {
	readonly _tag = "GraphHopperGeocodePayloadError";

	constructor(readonly cause: unknown) {
		super("GraphHopper geocode response was not valid JSON");
	}
}

export type GraphHopperGeocodeError =
	| MissingGraphHopperApiKeyError
	| GraphHopperGeocodeFetchError
	| GraphHopperGeocodeStatusError
	| GraphHopperGeocodePayloadError;

export class GraphHopperRouteFetchError extends Error {
	readonly _tag = "GraphHopperRouteFetchError";

	constructor(readonly cause: unknown) {
		super(
			cause instanceof Error
				? cause.message
				: "GraphHopper route request failed",
		);
	}
}

export class GraphHopperRouteStatusError extends Error {
	readonly _tag = "GraphHopperRouteStatusError";

	constructor(
		readonly status: number,
		readonly details: string,
	) {
		super(
			`Routing failed with status ${status}${details ? `: ${details}` : ""}`,
		);
	}
}

export class GraphHopperRoutePayloadError extends Error {
	readonly _tag = "GraphHopperRoutePayloadError";

	constructor(readonly cause: unknown) {
		super("GraphHopper route response was not valid JSON");
	}
}

export class GraphHopperRouteIncompleteError extends Error {
	readonly _tag = "GraphHopperRouteIncompleteError";

	constructor() {
		super("GraphHopper route response was incomplete");
	}
}

export class GraphHopperRouteStrategyError extends Error {
	readonly _tag = "GraphHopperRouteStrategyError";

	constructor() {
		super("GraphHopper did not accept any routing strategy");
	}
}

export type GraphHopperRouteBoundaryError =
	| MissingGraphHopperApiKeyError
	| GraphHopperRouteFetchError
	| GraphHopperRouteStatusError
	| GraphHopperRoutePayloadError
	| GraphHopperRouteIncompleteError
	| GraphHopperRouteStrategyError;

export function isMissingGraphHopperApiKeyError(
	error: unknown,
): error is MissingGraphHopperApiKeyError {
	return (
		error instanceof MissingGraphHopperApiKeyError ||
		(error instanceof Error &&
			error.message === missingGraphHopperApiKeyMessage)
	);
}

export function isGraphHopperRoutePointLimitError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes("Too many points for Routing API")
	);
}
