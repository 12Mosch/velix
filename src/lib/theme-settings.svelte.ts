import {
	resetMode,
	setMode,
	userPrefersMode,
	type UserPrefersMode,
} from "mode-watcher";

export type ThemeMode = UserPrefersMode["current"];

export function getThemeModePreference(): ThemeMode {
	return userPrefersMode.current;
}

export function setThemeModePreference(mode: ThemeMode) {
	if (mode === "system") {
		resetMode();
		return;
	}

	setMode(mode);
}

export function applyRemoteThemeModePreference(mode: ThemeMode) {
	setThemeModePreference(mode);
}
