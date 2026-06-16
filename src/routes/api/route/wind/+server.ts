import type { RequestHandler } from "./$types";
import { Effect } from "effect";

import { decodeRouteWindRequestPayload } from "$lib/route-api-schema";
import { runServerEffect } from "$lib/server/effect-runtime";
import { ServerLive } from "$lib/server/layers";
import {
	getRouteRequestTooLargeMessage,
	maxRouteRequestBodyBytes,
} from "$lib/server/route-endpoint/constants";
import {
	mapRouteEndpointError,
	validationFailure,
} from "$lib/server/route-endpoint/responses";
import {
	getContentLengthBytes,
	parseRouteRequestJsonWithBodyLimit,
} from "$lib/server/route-endpoint/request-body";
import { attachWindAnalysisEffect } from "$lib/server/route-orchestration";
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
		const decodedPayload = decodeRouteWindRequestPayload(rawPayload);

		if (!decodedPayload.ok) {
			return yield* validationFailure(400, decodedPayload.error);
		}

		const [route] = yield* attachWindAnalysisEffect([
			decodedPayload.payload.route,
		]);

		return new Response(JSON.stringify({ route }), {
			status: 200,
			headers: {
				"content-type": "application/json",
			},
		});
	});

	return runServerEffect(
		program.pipe(
			Effect.catch(mapRouteEndpointError),
			Effect.provide(ServerLive),
			Effect.provideService(ServerFetch, { fetch }),
		),
	);
};
