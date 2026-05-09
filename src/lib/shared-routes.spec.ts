import { describe, expect, it, vi } from "vitest";

import {
	buildShareUrl,
	copyTextToClipboard,
	generateShareToken,
} from "./shared-routes";

describe("shared route helpers", () => {
	it("generates a non-empty URL-safe token", () => {
		const originalCrypto = globalThis.crypto;
		const getRandomValues = vi.fn((bytes: Uint8Array) => {
			bytes.set(Array.from({ length: bytes.length }, (_, index) => index + 1));
			return bytes;
		});

		Object.defineProperty(globalThis, "crypto", {
			configurable: true,
			value: { getRandomValues },
		});

		try {
			const token = generateShareToken();

			expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
			expect(token.length).toBeGreaterThan(0);
			expect(token).not.toContain("=");
		} finally {
			Object.defineProperty(globalThis, "crypto", {
				configurable: true,
				value: originalCrypto,
			});
		}
	});

	it("builds an absolute share URL", () => {
		expect(buildShareUrl("https://velix.example/", "abc_123")).toBe(
			"https://velix.example/share/abc_123",
		);
	});

	it("reports clipboard failures", async () => {
		const originalClipboard = navigator.clipboard;

		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: vi.fn().mockRejectedValue(new Error("blocked")),
			},
		});

		try {
			await expect(
				copyTextToClipboard("https://velix.example/share/t"),
			).resolves.toBe(false);
		} finally {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: originalClipboard,
			});
		}
	});
});
