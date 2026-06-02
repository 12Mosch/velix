import {
	resetMode,
	setMode,
	userPrefersMode,
	type UserPrefersMode,
} from "mode-watcher";
import { Effect } from "effect";

export type ThemeMode = UserPrefersMode["current"];

export const getThemeModePreference = Effect.fn("getThemeModePreference")(
	function* (): Effect.fn.Return<ThemeMode, never> {
		return yield* Effect.sync(() => userPrefersMode.current);
	},
);

export const setThemeModePreference = Effect.fn("setThemeModePreference")(
	function* (mode: ThemeMode): Effect.fn.Return<void, never> {
		yield* Effect.sync(() => {
			if (mode === "system") {
				resetMode();
				return;
			}

			setMode(mode);
		});
	},
);

export const applyRemoteThemeModePreference = Effect.fn(
	"applyRemoteThemeModePreference",
)(function* (mode: ThemeMode): Effect.fn.Return<void, never> {
	yield* setThemeModePreference(mode);
});
