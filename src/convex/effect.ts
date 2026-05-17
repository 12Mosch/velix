import { Effect } from "effect";

export function toConvexError(cause: unknown, fallbackMessage: string): Error {
	return cause instanceof Error ? cause : new Error(fallbackMessage);
}

export function tryConvexPromise<A>(
	try_: () => Promise<A>,
	fallbackMessage = "Convex operation failed.",
): Effect.Effect<A, Error> {
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
