import type {
	RouteSuggestion,
	RouteSuggestionsApiSuccess,
} from "$lib/route-planning";
import { Data, Effect } from "effect";
import type { CompletionTarget } from "../types";

export type CompletionViewState = {
	activeTarget: CompletionTarget | null;
	suggestions: RouteSuggestion[];
	isLoading: boolean;
	isEmpty: boolean;
	highlightedIndex: number;
};

export type PlannerCompletionController = ReturnType<
	typeof createPlannerCompletionController
>;

type CompletionFetch = typeof fetch;

type PlannerCompletionControllerOptions = {
	debounceMs: number;
	minQueryLength: number;
	blurDelayMs?: number;
	getValue: (target: CompletionTarget) => string;
	onSelect: (target: CompletionTarget, suggestion: RouteSuggestion) => void;
	onError?: (error: unknown) => void;
};

declare const plannerCompletionEmptyErrorPayload: unique symbol;
type PlannerCompletionEmptyErrorPayload = {
	readonly [plannerCompletionEmptyErrorPayload]?: never;
};

class PlannerCompletionFetchUnavailableError extends Data.TaggedError(
	"PlannerCompletionFetchUnavailableError",
)<PlannerCompletionEmptyErrorPayload> {}

class PlannerCompletionRequestError extends Data.TaggedError(
	"PlannerCompletionRequestError",
)<{
	readonly cause: unknown;
}> {}

class PlannerCompletionResponseError extends Data.TaggedError(
	"PlannerCompletionResponseError",
)<{
	readonly status: number;
}> {}

class PlannerCompletionDecodeError extends Data.TaggedError(
	"PlannerCompletionDecodeError",
)<{
	readonly cause: unknown;
}> {}

export type PlannerCompletionLookupError =
	| PlannerCompletionFetchUnavailableError
	| PlannerCompletionRequestError
	| PlannerCompletionResponseError
	| PlannerCompletionDecodeError;

export function getCompletionTargetKey(target: CompletionTarget): string {
	return target.kind === "waypoint" ? `waypoint-${target.index}` : target.kind;
}

export function getCompletionListId(target: CompletionTarget): string {
	return `route-completions-${getCompletionTargetKey(target)}`;
}

export function getCompletionOptionId(
	target: CompletionTarget,
	index: number,
): string {
	return `${getCompletionListId(target)}-option-${index}`;
}

export function getWaypointCompletionTarget(index: number): CompletionTarget {
	return {
		kind: "waypoint",
		index,
	};
}

export function isSameCompletionTarget(
	left: CompletionTarget | null,
	right: CompletionTarget | null,
): boolean {
	if (!left || !right || left.kind !== right.kind) {
		return false;
	}

	if (left.kind !== "waypoint" || right.kind !== "waypoint") {
		return true;
	}

	return left.index === right.index;
}

export function createPlannerCompletionController(
	getFetch: () => CompletionFetch | null,
	options: PlannerCompletionControllerOptions,
) {
	let abortController: AbortController | null = null;
	let blurTimer: ReturnType<typeof setTimeout> | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let requestId = 0;
	let viewState = $state<CompletionViewState>({
		activeTarget: null,
		suggestions: [],
		isLoading: false,
		isEmpty: false,
		highlightedIndex: -1,
	});

	const lookupSuggestions = Effect.fn("lookupSuggestions")(function* (
		query: string,
		signal: AbortSignal,
	): Effect.fn.Return<RouteSuggestion[], PlannerCompletionLookupError> {
		const fetchFn = getFetch();

		if (!fetchFn) {
			return yield* new PlannerCompletionFetchUnavailableError({});
		}

		const response = yield* Effect.tryPromise({
			try: () =>
				fetchFn(`/api/route/suggest?q=${encodeURIComponent(query)}`, {
					signal,
				}),
			catch: (cause) => new PlannerCompletionRequestError({ cause }),
		});

		if (!response.ok) {
			return yield* new PlannerCompletionResponseError({
				status: response.status,
			});
		}

		const payload = yield* Effect.tryPromise({
			try: () =>
				response.json() as Promise<Partial<RouteSuggestionsApiSuccess>>,
			catch: (cause) => new PlannerCompletionDecodeError({ cause }),
		});

		return Array.isArray(payload.suggestions) ? payload.suggestions : [];
	});

	function clearResults() {
		viewState.suggestions = [];
		viewState.highlightedIndex = -1;
		viewState.isLoading = false;
		viewState.isEmpty = false;
	}

	function cancelDebounce() {
		if (debounceTimer === null) {
			return;
		}

		clearTimeout(debounceTimer);
		debounceTimer = null;
	}

	function cancelBlur() {
		if (blurTimer === null) {
			return;
		}

		clearTimeout(blurTimer);
		blurTimer = null;
	}

	function cancelRequest() {
		abortController?.abort();
		abortController = null;
	}

	function close() {
		return Effect.sync(() => {
			cancelBlur();
			cancelDebounce();
			cancelRequest();
			clearResults();
			viewState.activeTarget = null;
		});
	}

	const select = Effect.fn("select")(function* (
		target: CompletionTarget,
		suggestion: RouteSuggestion,
	) {
		options.onSelect(target, suggestion);
		yield* close();
	});

	function runScheduledLookup(
		target: CompletionTarget,
		query: string,
		nextAbortController: AbortController,
		nextRequestId: number,
	) {
		void Effect.runPromise(
			Effect.gen(function* () {
				const suggestions = yield* lookupSuggestions(
					query,
					nextAbortController.signal,
				);

				if (
					!isSameCompletionTarget(viewState.activeTarget, target) ||
					nextRequestId !== requestId
				) {
					return;
				}

				viewState.suggestions = suggestions;
				viewState.highlightedIndex = suggestions.length > 0 ? 0 : -1;
				viewState.isEmpty = suggestions.length === 0;
			}).pipe(
				Effect.catch((error) =>
					Effect.sync(() => {
						if (nextAbortController.signal.aborted) {
							return;
						}

						options.onError?.(error);

						if (
							!isSameCompletionTarget(viewState.activeTarget, target) ||
							nextRequestId !== requestId
						) {
							return;
						}

						viewState.suggestions = [];
						viewState.highlightedIndex = -1;
						viewState.isEmpty = false;
					}),
				),
				Effect.ensuring(
					Effect.sync(() => {
						if (
							isSameCompletionTarget(viewState.activeTarget, target) &&
							nextRequestId === requestId
						) {
							viewState.isLoading = false;

							if (abortController === nextAbortController) {
								abortController = null;
							}
						}
					}),
				),
			),
		);
	}

	function closeIfTargetActive(target: CompletionTarget) {
		if (isSameCompletionTarget(viewState.activeTarget, target)) {
			Effect.runSync(close());
		}
	}

	const scheduleLookup = Effect.fn("scheduleLookup")(function* (
		target: CompletionTarget,
		value: string,
	) {
		viewState.activeTarget = target;
		cancelDebounce();
		cancelRequest();
		viewState.suggestions = [];
		viewState.highlightedIndex = -1;
		viewState.isEmpty = false;

		const trimmedValue = value.trim();
		const fetchFn = getFetch();

		if (!fetchFn || trimmedValue.length < options.minQueryLength) {
			viewState.isLoading = false;
			return;
		}

		viewState.isLoading = true;
		const nextRequestId = ++requestId;

		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			const nextAbortController = new AbortController();
			abortController = nextAbortController;

			runScheduledLookup(
				target,
				trimmedValue,
				nextAbortController,
				nextRequestId,
			);
		}, options.debounceMs);
	});

	const handleFocus = Effect.fn("handleFocus")(function* (
		target: CompletionTarget,
	) {
		cancelBlur();
		viewState.activeTarget = target;
		const value = options.getValue(target);

		if (value.trim().length >= options.minQueryLength) {
			yield* scheduleLookup(target, value);
			return;
		}

		cancelDebounce();
		cancelRequest();
		clearResults();
	});

	const handleBlur = Effect.fn("handleBlur")(function* (
		target: CompletionTarget,
	) {
		if (!isSameCompletionTarget(viewState.activeTarget, target)) {
			return;
		}

		cancelBlur();
		blurTimer = setTimeout(() => {
			closeIfTargetActive(target);
		}, options.blurDelayMs ?? 120);
	});

	const handleKeydown = Effect.fn("handleKeydown")(function* (
		event: Pick<KeyboardEvent, "key" | "preventDefault">,
		target: CompletionTarget,
	) {
		if (!isSameCompletionTarget(viewState.activeTarget, target)) {
			return;
		}

		if (event.key === "Escape" && isMenuVisible(target)) {
			event.preventDefault();
			yield* close();
			return;
		}

		if (viewState.suggestions.length === 0) {
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			viewState.highlightedIndex =
				(viewState.highlightedIndex + 1) % viewState.suggestions.length;
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			viewState.highlightedIndex =
				(viewState.highlightedIndex - 1 + viewState.suggestions.length) %
				viewState.suggestions.length;
			return;
		}

		if (event.key === "Enter" && viewState.highlightedIndex >= 0) {
			event.preventDefault();
			const suggestion = viewState.suggestions[viewState.highlightedIndex];

			if (suggestion) {
				yield* select(target, suggestion);
			}
		}
	});

	const handleSelectionPointerDown = Effect.fn("handleSelectionPointerDown")(
		function* (
			event: Pick<PointerEvent, "preventDefault">,
			target: CompletionTarget,
			suggestion: RouteSuggestion,
		) {
			event.preventDefault();
			cancelBlur();
			yield* select(target, suggestion);
		},
	);

	function isMenuVisible(target: CompletionTarget): boolean {
		return (
			isSameCompletionTarget(viewState.activeTarget, target) &&
			(viewState.isLoading ||
				viewState.isEmpty ||
				viewState.suggestions.length > 0)
		);
	}

	function getActiveDescendant(target: CompletionTarget): string | undefined {
		if (
			!isSameCompletionTarget(viewState.activeTarget, target) ||
			viewState.highlightedIndex < 0 ||
			viewState.highlightedIndex >= viewState.suggestions.length
		) {
			return undefined;
		}

		return getCompletionOptionId(target, viewState.highlightedIndex);
	}

	function handleWaypointInserted(index: number) {
		return Effect.sync(() => {
			if (
				viewState.activeTarget?.kind === "waypoint" &&
				viewState.activeTarget.index >= index
			) {
				viewState.activeTarget = getWaypointCompletionTarget(
					viewState.activeTarget.index + 1,
				);
			}
		});
	}

	const handleWaypointRemoved = Effect.fn("handleWaypointRemoved")(function* (
		index: number,
	) {
		if (viewState.activeTarget?.kind !== "waypoint") {
			return;
		}

		if (viewState.activeTarget.index === index) {
			yield* close();
			return;
		}

		if (viewState.activeTarget.index > index) {
			viewState.activeTarget = getWaypointCompletionTarget(
				viewState.activeTarget.index - 1,
			);
		}
	});

	function handleWaypointSwap(left: number, right: number) {
		return Effect.sync(() => {
			if (viewState.activeTarget?.kind !== "waypoint") {
				return;
			}

			if (viewState.activeTarget.index === left) {
				viewState.activeTarget = getWaypointCompletionTarget(right);
				return;
			}

			if (viewState.activeTarget.index === right) {
				viewState.activeTarget = getWaypointCompletionTarget(left);
			}
		});
	}

	const destroy = Effect.fn("destroy")(function* () {
		yield* close();
	});

	return {
		viewState,
		close,
		destroy,
		getCompletionListId,
		getCompletionOptionId,
		getCompletionTargetKey,
		getWaypointCompletionTarget,
		getActiveDescendant,
		handleBlur,
		handleFocus,
		handleKeydown,
		handleSelectionPointerDown,
		handleWaypointInserted,
		handleWaypointRemoved,
		handleWaypointSwap,
		isMenuVisible,
		isSameCompletionTarget,
		scheduleLookup,
		select,
	};
}
