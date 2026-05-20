import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlannerCompletionController } from "./planner-completion.svelte.ts";

const startTarget = { kind: "startQuery" } as const;

function createController(options: {
	fetchImpl?: typeof fetch;
	getValue?: () => string;
	onSelect?: (label: string) => void;
}) {
	const fetchImpl = options.fetchImpl ?? vi.fn<typeof fetch>();
	const onSelect = vi.fn((_target, suggestion) => {
		options.onSelect?.(suggestion.label);
	});

	const controller = createPlannerCompletionController(() => fetchImpl, {
		debounceMs: 250,
		minQueryLength: 3,
		getValue: () => options.getValue?.() ?? "",
		onSelect,
	});

	return { controller, fetchImpl, onSelect };
}

function createDeferredJsonResponse() {
	let resolve!: (response: Response) => void;
	const promise = new Promise<Response>((nextResolve) => {
		resolve = nextResolve;
	});

	return {
		promise,
		resolveWith: (payload: unknown) =>
			resolve(
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
	};
}

async function flushAsyncWork() {
	await Promise.resolve();
	await Promise.resolve();
}

describe("planner completion controller", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("debounces suggestion lookups", async () => {
		const fetchImpl = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						suggestions: [{ label: "Munich", point: [11.57, 48.13] }],
					}),
				),
			),
		);
		const { controller } = createController({ fetchImpl });

		controller.scheduleLookup(startTarget, "Mu");
		await vi.advanceTimersByTimeAsync(300);
		expect(fetchImpl).not.toHaveBeenCalled();

		controller.scheduleLookup(startTarget, "Mun");
		await vi.advanceTimersByTimeAsync(249);
		expect(fetchImpl).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(controller.viewState.suggestions).toEqual([
			{ label: "Munich", point: [11.57, 48.13] },
		]);
	});

	it("ignores stale responses from earlier requests", async () => {
		const first = createDeferredJsonResponse();
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							suggestions: [{ label: "Munich 2", point: [11.58, 48.14] }],
						}),
					),
				),
			);
		const { controller } = createController({ fetchImpl });

		controller.scheduleLookup(startTarget, "Mun");
		await vi.advanceTimersByTimeAsync(250);
		controller.scheduleLookup(startTarget, "Muni");
		await vi.advanceTimersByTimeAsync(250);
		await flushAsyncWork();
		expect(controller.viewState.suggestions[0]?.label).toBe("Munich 2");

		first.resolveWith({
			suggestions: [{ label: "Old Munich", point: [11.57, 48.13] }],
		});
		await flushAsyncWork();
		expect(controller.viewState.suggestions[0]?.label).toBe("Munich 2");
	});

	it("closes after the blur delay", async () => {
		const { controller } = createController({ getValue: () => "Mun" });

		controller.handleFocus(startTarget);
		controller.handleBlur(startTarget);
		await vi.advanceTimersByTimeAsync(119);
		expect(controller.viewState.activeTarget).toEqual(startTarget);

		await vi.advanceTimersByTimeAsync(1);
		expect(controller.viewState.activeTarget).toBeNull();
	});

	it("supports keyboard navigation and selection", async () => {
		const selectedLabels: string[] = [];
		const fetchImpl = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						suggestions: [
							{ label: "Munich", point: [11.57, 48.13] },
							{ label: "Munster", point: [7.62, 51.96] },
						],
					}),
				),
			),
		);
		const { controller } = createController({
			fetchImpl,
			onSelect: (label) => selectedLabels.push(label),
		});

		controller.scheduleLookup(startTarget, "Mun");
		await vi.advanceTimersByTimeAsync(250);

		const preventDefault = vi.fn();
		controller.handleKeydown(
			{ key: "ArrowDown", preventDefault } as KeyboardEvent,
			startTarget,
		);
		expect(controller.viewState.highlightedIndex).toBe(1);

		controller.handleKeydown(
			{ key: "Enter", preventDefault } as KeyboardEvent,
			startTarget,
		);
		expect(selectedLabels).toEqual(["Munster"]);
		expect(controller.viewState.activeTarget).toBeNull();
	});
});
