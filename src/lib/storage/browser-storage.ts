import { browser } from "$app/environment";
import { Effect } from "effect";

export type BrowserStorage = {
	readonly length?: number;
	getItem: (key: string) => string | null;
	key?: (index: number) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
};

export const createBrowserStorage = Effect.fn("createBrowserStorage")(
	function* (): Effect.fn.Return<BrowserStorage | null, never> {
		if (!browser || typeof window === "undefined") {
			return null;
		}

		return yield* Effect.try({
			try: () => window.localStorage,
			catch: () => null,
		}).pipe(Effect.catch(() => Effect.succeed(null)));
	},
);
