import { Effect } from "effect";

import { TimeoutFetch } from "$lib/server/resilience";

export type OpenMeteoWindForecast = {
	speedKmh: number;
	directionDegrees: number;
	forecastTime: string;
};

export class OpenMeteoWindError extends Error {
	readonly _tag = "OpenMeteoWindError";

	constructor(
		message: string,
		readonly cause?: unknown,
	) {
		super(message);
	}
}

const openMeteoForecastUrl = "https://api.open-meteo.com/v1/forecast";
const openMeteoTimeoutMs = 4500;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && !Array.isArray(value) && typeof value === "object";
}

function getFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildOpenMeteoWindUrl(coordinates: [number, number][]): string {
	const url = new URL(openMeteoForecastUrl);
	url.searchParams.set(
		"latitude",
		coordinates.map((coordinate) => String(coordinate[1])).join(","),
	);
	url.searchParams.set(
		"longitude",
		coordinates.map((coordinate) => String(coordinate[0])).join(","),
	);
	url.searchParams.set("current", "wind_speed_10m,wind_direction_10m");
	url.searchParams.set("wind_speed_unit", "kmh");
	url.searchParams.set("timezone", "UTC");
	return url.toString();
}

function parseOpenMeteoWindPayload(
	payload: unknown,
): OpenMeteoWindForecast | null {
	if (!isRecord(payload) || !isRecord(payload.current)) {
		return null;
	}

	const speedKmh = getFiniteNumber(payload.current.wind_speed_10m);
	const directionDegrees = getFiniteNumber(payload.current.wind_direction_10m);
	const forecastTime =
		typeof payload.current.time === "string" ? payload.current.time : null;

	if (speedKmh === null || directionDegrees === null || !forecastTime) {
		return null;
	}

	return {
		speedKmh,
		directionDegrees,
		forecastTime,
	};
}

function parseOpenMeteoBatchWindPayload(
	payload: unknown,
): OpenMeteoWindForecast[] | null {
	if (Array.isArray(payload)) {
		const forecasts = payload.map(parseOpenMeteoWindPayload);
		return forecasts.every(
			(forecast): forecast is OpenMeteoWindForecast => forecast !== null,
		)
			? forecasts
			: null;
	}

	const forecast = parseOpenMeteoWindPayload(payload);
	return forecast ? [forecast] : null;
}

export function fetchOpenMeteoBatchWindEffect(
	coordinates: [number, number][],
): Effect.Effect<OpenMeteoWindForecast[], OpenMeteoWindError, TimeoutFetch> {
	return Effect.gen(function* () {
		if (coordinates.length === 0) {
			return [];
		}

		const timeoutFetch = yield* TimeoutFetch;
		const url = buildOpenMeteoWindUrl(coordinates);
		const response = yield* Effect.mapError(
			timeoutFetch.fetch(url, { method: "GET" }, openMeteoTimeoutMs),
			(cause) =>
				new OpenMeteoWindError("Open-Meteo wind request failed.", cause),
		);

		if (!(response instanceof Response)) {
			return yield* Effect.fail(
				new OpenMeteoWindError("Open-Meteo wind request returned no response."),
			);
		}

		if (!response.ok) {
			return yield* Effect.fail(
				new OpenMeteoWindError(
					`Open-Meteo wind request failed with status ${response.status}.`,
				),
			);
		}

		const payload = yield* Effect.tryPromise({
			try: () => response.json() as Promise<unknown>,
			catch: (cause) =>
				new OpenMeteoWindError("Open-Meteo wind response was not JSON.", cause),
		});
		const parsed = parseOpenMeteoBatchWindPayload(payload);

		if (!parsed || parsed.length !== coordinates.length) {
			return yield* Effect.fail(
				new OpenMeteoWindError("Open-Meteo wind response was malformed."),
			);
		}

		return parsed;
	});
}

export function fetchOpenMeteoWindEffect(
	coordinate: [number, number],
): Effect.Effect<OpenMeteoWindForecast, OpenMeteoWindError, TimeoutFetch> {
	return fetchOpenMeteoBatchWindEffect([coordinate]).pipe(
		Effect.map((forecasts) => forecasts[0] as OpenMeteoWindForecast),
	);
}

export const openMeteoTestExports = {
	buildOpenMeteoWindUrl,
	openMeteoTimeoutMs,
	parseOpenMeteoWindPayload,
};
