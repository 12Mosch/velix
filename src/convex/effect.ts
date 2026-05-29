import { Effect } from "effect";

export class ConvexOperationError extends Error {
	readonly _tag = "ConvexOperationError";

	constructor(cause: unknown, fallbackMessage: string) {
		super(cause instanceof Error ? cause.message : fallbackMessage, { cause });
	}
}

export function toConvexError(
	cause: unknown,
	fallbackMessage: string,
): ConvexOperationError {
	return new ConvexOperationError(cause, fallbackMessage);
}

export function tryConvexPromise<A>(
	try_: () => Promise<A>,
	fallbackMessage = "Convex operation failed.",
): Effect.Effect<A, ConvexOperationError> {
	return Effect.tryPromise({
		try: try_,
		catch: (cause) => toConvexError(cause, fallbackMessage),
	});
}

export function runConvexEffect<A, E extends Error>(
	effect: Effect.Effect<A, E>,
): Promise<A> {
	return Effect.runPromise(effect);
}
