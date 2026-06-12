export const layoutTransitionBufferMs = 260;

type BrowserWindow = Pick<
	Window,
	"cancelAnimationFrame" | "performance" | "requestAnimationFrame"
>;

function getBrowserWindow(): BrowserWindow | null {
	return typeof window === "undefined" ? null : window;
}

export function createSmoothMapResizer(syncMapFrame: () => void) {
	let resizeAnimationFrameId: number | null = null;
	let resizeLoopUntil = 0;

	function cancel() {
		resizeLoopUntil = 0;
		const browserWindow = getBrowserWindow();

		if (resizeAnimationFrameId === null || !browserWindow) {
			return;
		}

		browserWindow.cancelAnimationFrame(resizeAnimationFrameId);
		resizeAnimationFrameId = null;
	}

	function keepResized() {
		const browserWindow = getBrowserWindow();

		if (!browserWindow) {
			return;
		}

		syncMapFrame();

		if (resizeLoopUntil <= browserWindow.performance.now()) {
			resizeLoopUntil = 0;
			resizeAnimationFrameId = null;
			return;
		}

		resizeAnimationFrameId = browserWindow.requestAnimationFrame(() => {
			keepResized();
		});
	}

	function schedule(durationMs = layoutTransitionBufferMs) {
		const browserWindow = getBrowserWindow();

		if (!browserWindow) {
			return;
		}

		const nextDeadline = browserWindow.performance.now() + durationMs;

		if (nextDeadline <= resizeLoopUntil) {
			return;
		}

		resizeLoopUntil = nextDeadline;

		if (resizeAnimationFrameId !== null) {
			return;
		}

		keepResized();
	}

	return {
		cancel,
		schedule,
	};
}
