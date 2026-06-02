import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
	PreferenceRepositoryError,
	createPreferenceRepository,
} from "$lib/preferences/preference-repository";
import type { BrowserStorage } from "$lib/storage/browser-storage";

describe("preference repository", () => {
	it("returns null and ignores writes when storage is unavailable", () => {
		const repository = createPreferenceRepository<"km" | "mi">(
			null,
			"velix.test",
		);

		expect(Effect.runSync(repository.read())).toBeNull();
		expect(Effect.runSync(repository.write("mi"))).toBeUndefined();
		expect(Effect.runSync(repository.clear())).toBeUndefined();
	});

	it("wraps unexpected storage operation exceptions", () => {
		const storage: BrowserStorage = {
			getItem: vi.fn(() => {
				throw new Error("storage unavailable");
			}),
			setItem: vi.fn(() => {
				throw new Error("storage unavailable");
			}),
			removeItem: vi.fn(() => {
				throw new Error("storage unavailable");
			}),
		};
		const repository = createPreferenceRepository<"km" | "mi">(
			storage,
			"velix.test",
		);

		const error = Effect.runSync(Effect.flip(repository.read()));

		expect(error).toBeInstanceOf(PreferenceRepositoryError);
		expect(error.operation).toBe("read");
		expect(error.storageKey).toBe("velix.test");

		const writeError = Effect.runSync(Effect.flip(repository.write("mi")));

		expect(writeError).toBeInstanceOf(PreferenceRepositoryError);
		expect(writeError.operation).toBe("write");
		expect(writeError.storageKey).toBe("velix.test");

		const clearError = Effect.runSync(Effect.flip(repository.clear()));

		expect(clearError).toBeInstanceOf(PreferenceRepositoryError);
		expect(clearError.operation).toBe("clear");
		expect(clearError.storageKey).toBe("velix.test");
	});

	it("persists values through Effect APIs", () => {
		let currentValue: string | null = null;
		const storage: BrowserStorage = {
			getItem: vi.fn(() => currentValue),
			setItem: vi.fn((_key: string, value: string) => {
				currentValue = value;
			}),
			removeItem: vi.fn(() => {
				currentValue = null;
			}),
		};
		const repository = createPreferenceRepository<"km" | "mi">(
			storage,
			"velix.test",
		);

		Effect.runSync(repository.write("mi"));
		expect(Effect.runSync(repository.read())).toBe("mi");
		Effect.runSync(repository.clear());
		expect(Effect.runSync(repository.read())).toBeNull();
	});
});
