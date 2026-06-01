<script lang="ts">
	import { Check } from "@lucide/svelte";
	import { Effect } from "effect";
	import type { Snippet } from "svelte";

	import { Input } from "$lib/components/ui/input/index.js";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import type { PlannerCompletionController } from "$lib/route-planner/page/planner-completion.svelte";
	import type { CompletionTarget } from "$lib/route-planner/types";

	type Props = {
		id: string;
		label: string;
		value: string;
		placeholder: string;
		target: CompletionTarget;
		controller: PlannerCompletionController;
		completionLabel: string;
		error?: string;
		inputClass?: string;
		onInput: (value: string) => void;
		leading?: Snippet;
		trailing?: Snippet;
	};

	let {
		id,
		label,
		value,
		placeholder,
		target,
		controller,
		completionLabel,
		error = "",
		inputClass = "",
		onInput,
		leading,
		trailing,
	}: Props = $props();
</script>

{#snippet completionSuggestionsSkeleton()}
	<div class="space-y-2 px-3 py-2.5">
		{#each Array.from({ length: 3 }) as _, index}
			<div class="flex items-center gap-2">
				<Skeleton class="h-4 w-4 rounded-full" />
				<Skeleton class={index === 0 ? "h-4 w-4/5" : "h-4 w-3/5"} />
			</div>
		{/each}
	</div>
{/snippet}

<div class="space-y-2">
	<label
		for={id}
		class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
	>
		{label}
	</label>
	<div class="relative">
		{#if leading}
			<div class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
				{@render leading()}
			</div>
		{/if}
		<Input
			{id}
			{value}
			{placeholder}
			class={inputClass}
			autocomplete="off"
			aria-autocomplete="list"
			aria-controls={controller.getCompletionListId(target)}
			aria-expanded={controller.isMenuVisible(target)}
			aria-activedescendant={controller.getActiveDescendant(target)}
			aria-invalid={error ? "true" : undefined}
			onfocus={() => Effect.runSync(controller.handleFocus(target))}
			onblur={() => Effect.runSync(controller.handleBlur(target))}
			onkeydown={(event) =>
				Effect.runSync(controller.handleKeydown(event, target))}
			oninput={(event) => onInput((event.currentTarget as HTMLInputElement).value)}
		/>
		{#if trailing}
			<div class="absolute right-1 top-1/2 -translate-y-1/2">
				{@render trailing()}
			</div>
		{/if}

		{#if controller.isMenuVisible(target)}
			<div
				class="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-lg"
			>
				<ul
					id={controller.getCompletionListId(target)}
					role="listbox"
					aria-label={completionLabel}
					aria-busy={controller.viewState.isLoading}
					class="max-h-60 overflow-y-auto py-1"
				>
					{#if controller.viewState.isLoading}
						{@render completionSuggestionsSkeleton()}
					{:else if controller.viewState.suggestions.length > 0}
						{#each controller.viewState.suggestions as suggestion, index (`${controller.getCompletionTargetKey(target)}-${suggestion.label}-${index}`)}
							<li
								id={controller.getCompletionOptionId(target, index)}
								role="option"
								class={[
									"flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors",
									controller.viewState.highlightedIndex === index
										? "bg-secondary text-foreground"
										: "hover:bg-secondary/80",
								]}
								aria-selected={controller.viewState.highlightedIndex === index}
								onmousedown={(event) =>
									Effect.runSync(
										controller.handleSelectionPointerDown(
											event,
											target,
											suggestion,
										),
									)}
							>
								<Check class="size-4 shrink-0 text-primary" />
								<span class="min-w-0 truncate">{suggestion.label}</span>
							</li>
						{/each}
					{:else if controller.viewState.isEmpty}
						<li class="px-3 py-2 text-sm text-muted-foreground">
							No matches found.
						</li>
					{/if}
				</ul>
			</div>
		{/if}
	</div>
	{#if error}
		<p class="text-xs text-destructive">{error}</p>
	{/if}
</div>
