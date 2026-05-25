<script lang="ts">
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";
	import { mergeProps } from "bits-ui";
	import type { Snippet } from "svelte";

	let {
		content,
		side = "top",
		align = "center",
		sideOffset = 8,
		class: className = "inline-flex",
		children,
	}: {
		content: string | null;
		side?: "top" | "right" | "bottom" | "left";
		align?: "start" | "center" | "end";
		sideOffset?: number;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

{#if content}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props: _tooltipProps })}
				<span {...mergeProps(_tooltipProps, { class: className })}>
					{@render children?.()}
				</span>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content {side} {align} {sideOffset}>
			{content}
		</Tooltip.Content>
	</Tooltip.Root>
{:else}
	<span class={className}>
		{@render children?.()}
	</span>
{/if}
