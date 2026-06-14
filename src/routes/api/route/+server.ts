import type { RequestHandler } from "./$types";
import { Effect } from "effect";

import { decodeRouteRequestPayload } from "$lib/route-api-schema";
import { runServerEffect } from "$lib/server/effect-runtime";
import { ServerLive } from "$lib/server/layers";
import {
	maxRouteRequestBodyBytes,
	getRouteRequestTooLargeMessage,
} from "$lib/server/route-endpoint/constants";
import { dispatchRouteModeEffect } from "$lib/server/route-endpoint/dispatch";
import { prepareRouteModeContext } from "$lib/server/route-endpoint/payload";
import {
	mapRouteEndpointError,
	validationFailure,
} from "$lib/server/route-endpoint/responses";
import {
	getContentLengthBytes,
	parseRouteRequestJsonWithBodyLimit,
} from "$lib/server/route-endpoint/request-body";
import {
	GraphHopperRouteCallSubject,
	getGraphHopperRouteCallSubjectEffect,
} from "$lib/server/route-rate-limits";
import { ServerFetch } from "$lib/server/resilience";

export const POST: RequestHandler = async (event) => {
	const { fetch, request } = event;

	const program = Effect.gen(function* () {
		const contentLength = getContentLengthBytes(request);

		if (contentLength !== null && contentLength > maxRouteRequestBodyBytes) {
			return yield* validationFailure(413, getRouteRequestTooLargeMessage());
		}

		const rawPayload = yield* parseRouteRequestJsonWithBodyLimit(
			request,
			maxRouteRequestBodyBytes,
		);
		const decodedPayload = decodeRouteRequestPayload(rawPayload);

		if (!decodedPayload.ok) {
			return yield* validationFailure(400, decodedPayload.error);
		}

		const graphHopperRouteCallSubject =
			yield* getGraphHopperRouteCallSubjectEffect(event);

		return yield* dispatchRouteModeEffect(
			prepareRouteModeContext(event, decodedPayload.payload),
		).pipe(
			Effect.provideService(GraphHopperRouteCallSubject, {
				subject: graphHopperRouteCallSubject,
			}),
		);
	});

	return runServerEffect(
		program.pipe(
			Effect.catch(mapRouteEndpointError),
			Effect.provide(ServerLive),
			Effect.provideService(ServerFetch, { fetch }),
		),
	);
};
