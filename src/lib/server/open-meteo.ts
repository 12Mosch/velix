import { Effect, Result, Schema } from "effect";

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

const OpenMeteoWindPayloadSchema = Schema.Struct({
	current: Schema.Struct({
		time: Schema.NonEmptyString,
		wind_speed_10m: Schema.Finite,
		wind_direction_10m: Schema.Finite,
	}),
});
const OpenMeteoBatchWindPayloadSchema = Schema.Union([
	OpenMeteoWindPayloadSchema,
	Schema.mutable(Schema.Array(OpenMeteoWindPayloadSchema)),
]);

type OpenMeteoWindPayload = typeof OpenMeteoWindPayloadSchema.Type;
type OpenMeteoBatchWindPayload = typeof OpenMeteoBatchWindPayloadSchema.Type;

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

function toOpenMeteoWindForecast(
	payload: OpenMeteoWindPayload,
): OpenMeteoWindForecast {
	return {
		speedKmh: payload.current.wind_speed_10m,
		directionDegrees: payload.current.wind_direction_10m,
		forecastTime: payload.current.time,
	};
}

function toOpenMeteoWindForecasts(
	payload: OpenMeteoBatchWindPayload,
): OpenMeteoWindForecast[] {
	const payloads = Array.isArray(payload) ? payload : [payload];
	return payloads.map(toOpenMeteoWindForecast);
}

function parseOpenMeteoWindPayload(
	payload: unknown,
): OpenMeteoWindForecast | null {
	const result = Schema.decodeUnknownResult(OpenMeteoWindPayloadSchema)(
		payload,
	);

	return Result.isSuccess(result)
		? toOpenMeteoWindForecast(result.success)
		: null;
}

function decodeOpenMeteoBatchWindPayload(
	payload: unknown,
): Effect.Effect<OpenMeteoWindForecast[], OpenMeteoWindError> {
	return Schema.decodeUnknownEffect(OpenMeteoBatchWindPayloadSchema)(
		payload,
	).pipe(
		Effect.map(toOpenMeteoWindForecasts),
		Effect.mapError(
			(cause) =>
				new OpenMeteoWindError(
					"Open-Meteo wind response was malformed.",
					cause,
				),
		),
	);
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
		const parsed = yield* decodeOpenMeteoBatchWindPayload(payload);

		if (parsed.length !== coordinates.length) {
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
