import { Effect } from "effect";

export function runServerEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	return Effect.runPromise(effect);
}

export function readResponseTextEffect(
	response: Response,
): Effect.Effect<string> {
	return Effect.catch(
		Effect.tryPromise(() => response.text()),
		() => Effect.succeed("<failed to read body>"),
	);
}
