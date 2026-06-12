import {
	getRouteRequestTooLargeMessage,
	maxRouteRequestBodyBytes,
} from "$lib/server/route-endpoint/constants";
import { RouteValidationError } from "$lib/server/route-orchestration";
import { Effect } from "effect";

export function getContentLengthBytes(request: Request): number | null {
	const contentLength = request.headers.get("content-length");

	if (!contentLength) {
		return null;
	}

	const parsedContentLength = Number(contentLength);

	return Number.isFinite(parsedContentLength) && parsedContentLength >= 0
		? parsedContentLength
		: null;
}

export const parseRouteRequestJsonWithBodyLimit = Effect.fn(
	"parseRouteRequestJsonWithBodyLimit",
)(function* (
	request: Request,
	maxBodyBytes = maxRouteRequestBodyBytes,
): Effect.fn.Return<unknown, RouteValidationError> {
	if (!request.body) {
		return yield* Effect.fail(
			new RouteValidationError(400, "Invalid route request payload."),
		);
	}

	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let bodyText = "";
	let bytesRead = 0;

	try {
		while (true) {
			const { done, value } = yield* Effect.tryPromise({
				try: () => reader.read(),
				catch: () =>
					new RouteValidationError(400, "Invalid route request payload."),
			});

			if (done) {
				break;
			}

			bytesRead += value.byteLength;

			if (bytesRead > maxBodyBytes) {
				yield* Effect.tryPromise({
					try: () => reader.cancel(),
					catch: () => undefined,
				}).pipe(Effect.catch(() => Effect.void));
				return yield* Effect.fail(
					new RouteValidationError(413, getRouteRequestTooLargeMessage()),
				);
			}

			bodyText += decoder.decode(value, { stream: true });
		}

		bodyText += decoder.decode();

		return yield* Effect.try({
			try: () => JSON.parse(bodyText) as unknown,
			catch: () =>
				new RouteValidationError(400, "Invalid route request payload."),
		});
	} finally {
		reader.releaseLock();
	}
});
