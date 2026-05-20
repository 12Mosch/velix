import type {
	RouteSuggestion,
	RouteSuggestionsApiSuccess,
} from "$lib/route-planning";
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
		cancelBlur();
		cancelDebounce();
		cancelRequest();
		clearResults();
		viewState.activeTarget = null;
	}

	function select(target: CompletionTarget, suggestion: RouteSuggestion) {
		options.onSelect(target, suggestion);
		close();
	}

	function scheduleLookup(target: CompletionTarget, value: string) {
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

		debounceTimer = setTimeout(async () => {
			debounceTimer = null;
			const nextAbortController = new AbortController();
			abortController = nextAbortController;

			try {
				const response = await fetchFn(
					`/api/route/suggest?q=${encodeURIComponent(trimmedValue)}`,
					{
						signal: nextAbortController.signal,
					},
				);

				if (!response.ok) {
					throw new Error(`Suggestions failed with status ${response.status}`);
				}

				const payload =
					(await response.json()) as Partial<RouteSuggestionsApiSuccess>;
				const suggestions = Array.isArray(payload.suggestions)
					? payload.suggestions
					: [];

				if (
					!isSameCompletionTarget(viewState.activeTarget, target) ||
					nextRequestId !== requestId
				) {
					return;
				}

				viewState.suggestions = suggestions;
				viewState.highlightedIndex = suggestions.length > 0 ? 0 : -1;
				viewState.isEmpty = suggestions.length === 0;
			} catch (error) {
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
			} finally {
				if (
					isSameCompletionTarget(viewState.activeTarget, target) &&
					nextRequestId === requestId
				) {
					viewState.isLoading = false;

					if (abortController === nextAbortController) {
						abortController = null;
					}
				}
			}
		}, options.debounceMs);
	}

	function handleFocus(target: CompletionTarget) {
		cancelBlur();
		viewState.activeTarget = target;
		const value = options.getValue(target);

		if (value.trim().length >= options.minQueryLength) {
			scheduleLookup(target, value);
			return;
		}

		cancelDebounce();
		cancelRequest();
		clearResults();
	}

	function handleBlur(target: CompletionTarget) {
		if (!isSameCompletionTarget(viewState.activeTarget, target)) {
			return;
		}

		cancelBlur();
		blurTimer = setTimeout(() => {
			if (isSameCompletionTarget(viewState.activeTarget, target)) {
				close();
			}
		}, options.blurDelayMs ?? 120);
	}

	function handleKeydown(
		event: Pick<KeyboardEvent, "key" | "preventDefault">,
		target: CompletionTarget,
	) {
		if (!isSameCompletionTarget(viewState.activeTarget, target)) {
			return;
		}

		if (event.key === "Escape" && isMenuVisible(target)) {
			event.preventDefault();
			close();
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
				select(target, suggestion);
			}
		}
	}

	function handleSelectionPointerDown(
		event: Pick<PointerEvent, "preventDefault">,
		target: CompletionTarget,
		suggestion: RouteSuggestion,
	) {
		event.preventDefault();
		cancelBlur();
		select(target, suggestion);
	}

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
		if (
			viewState.activeTarget?.kind === "waypoint" &&
			viewState.activeTarget.index >= index
		) {
			viewState.activeTarget = getWaypointCompletionTarget(
				viewState.activeTarget.index + 1,
			);
		}
	}

	function handleWaypointRemoved(index: number) {
		if (viewState.activeTarget?.kind !== "waypoint") {
			return;
		}

		if (viewState.activeTarget.index === index) {
			close();
			return;
		}

		if (viewState.activeTarget.index > index) {
			viewState.activeTarget = getWaypointCompletionTarget(
				viewState.activeTarget.index - 1,
			);
		}
	}

	function handleWaypointSwap(left: number, right: number) {
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
	}

	function destroy() {
		close();
	}

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
