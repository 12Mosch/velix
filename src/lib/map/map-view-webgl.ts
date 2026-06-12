export const webglUnavailableMessage =
	"Map cannot be shown because this browser or device could not create a WebGL context.";

export const mapCanvasContextAttributes: WebGLContextAttributes = {
	antialias: false,
	depth: true,
	failIfMajorPerformanceCaveat: false,
	powerPreference: "high-performance",
	preserveDrawingBuffer: false,
	stencil: true,
};

export function canCreateMapWebGLContext() {
	if (typeof document === "undefined") {
		return false;
	}

	const canvas = document.createElement("canvas");

	try {
		const gl =
			canvas.getContext("webgl2", mapCanvasContextAttributes) ??
			canvas.getContext("webgl", mapCanvasContextAttributes);
		gl?.getExtension("WEBGL_lose_context")?.loseContext();

		return gl !== null;
	} catch {
		return false;
	}
}

function parseErrorMessageJson(error: unknown): Record<string, unknown> | null {
	if (!(error instanceof Error)) {
		return null;
	}

	try {
		const parsed = JSON.parse(error.message) as unknown;

		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

export function isWebGLContextCreationError(error: unknown) {
	const parsedError = parseErrorMessageJson(error);

	if (parsedError?.type === "webglcontextcreationerror") {
		return true;
	}

	const messageParts = [
		error instanceof Error ? error.message : null,
		typeof parsedError?.message === "string" ? parsedError.message : null,
		typeof parsedError?.statusMessage === "string"
			? parsedError.statusMessage
			: null,
	].filter((message): message is string => typeof message === "string");

	return messageParts.some((message) => /webgl/i.test(message));
}
