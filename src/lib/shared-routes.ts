import { Data, Effect } from "effect";

const shareTokenByteLength = 16;

export class ShareTokenGenerationError extends Data.TaggedError(
	"ShareTokenGenerationError",
)<{
	readonly cause: unknown;
}> {}

export class ClipboardCopyError extends Data.TaggedError("ClipboardCopyError")<{
	readonly cause: unknown;
}> {}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	const base64 =
		typeof btoa === "function"
			? btoa(binary)
			: Buffer.from(bytes).toString("base64");

	return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function generateShareToken(): string {
	const cryptoApi = globalThis.crypto;

	if (cryptoApi?.getRandomValues) {
		const bytes = new Uint8Array(shareTokenByteLength);
		cryptoApi.getRandomValues(bytes);
		return bytesToBase64Url(bytes);
	}

	const uuid = cryptoApi?.randomUUID?.();
	if (uuid) {
		return uuid.replaceAll("-", "");
	}

	throw new Error("Secure random token generation is unavailable.");
}

export const generateShareTokenEffect = Effect.fn("generateShareTokenEffect")(
	function* () {
		return yield* Effect.try({
			try: generateShareToken,
			catch: (cause) => new ShareTokenGenerationError({ cause }),
		});
	},
);

export function buildShareUrl(origin: string, shareToken: string): string {
	return `${origin.replace(/\/+$/u, "")}/share/${shareToken}`;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

export const copyTextToClipboardEffect = Effect.fn("copyTextToClipboardEffect")(
	function* (text: string) {
		return yield* Effect.tryPromise({
			try: () => navigator.clipboard.writeText(text),
			catch: (cause) => new ClipboardCopyError({ cause }),
		}).pipe(
			Effect.as(true),
			Effect.catchTag("ClipboardCopyError", () => Effect.succeed(false)),
		);
	},
);
