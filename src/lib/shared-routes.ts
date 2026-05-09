const shareTokenByteLength = 16;

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
