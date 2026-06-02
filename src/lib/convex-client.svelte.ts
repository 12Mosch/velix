import { env } from "$env/dynamic/public";
import { useConvexClient } from "convex-svelte";
import { Effect } from "effect";

export const getOptionalConvexClient = Effect.fn("getOptionalConvexClient")(
	function* () {
		if (!env.PUBLIC_CONVEX_URL) {
			return null;
		}

		return yield* Effect.try({
			try: () => useConvexClient(),
			catch: () => null,
		}).pipe(Effect.orElseSucceed(() => null));
	},
);
