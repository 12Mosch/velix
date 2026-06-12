<script lang="ts">
	import {
		ArrowLeft,
		ArrowRight,
		ArrowUp,
		CircleDot,
		CornerDownLeft,
		CornerDownRight,
		Flag,
		Navigation,
		Shuffle,
	} from "@lucide/svelte";

	import { formatDistance } from "$lib/unit-settings.svelte";
	import { formatExactDistance } from "$lib/route-planner/formatters";
	import type { PlannerAnalysisController } from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import type { RouteResultDockChromeView } from "$lib/components/route-planner/route-result-dock-parts/types";

	type Props = {
		dock: RouteResultDockChromeView;
		analysis: PlannerAnalysisController;
	};

	let { dock, analysis }: Props = $props();
</script>

<div
	id="route-directions-panel"
	class="mt-3 max-h-[min(38vh,22rem)] overflow-y-auto rounded-lg border border-border/40 bg-secondary/5 p-2"
>
	<div class="flex items-center justify-between gap-2 px-1 pb-2">
		<div class="flex min-w-0 items-center gap-2">
			<Navigation class="size-3.5 shrink-0 text-primary" />
			<span class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
				Directions
			</span>
		</div>
		<span class="text-xs text-muted-foreground">
			{dock.activeDirections.length} cue{dock.activeDirections.length === 1 ? "" : "s"}
		</span>
	</div>

	{#if dock.activeDirections.length > 0}
		<div class="space-y-1">
			{#each dock.activeDirections as cue, index (`cue-${index}-${cue.coordinateIndex}-${cue.sign}`)}
				<button
					type="button"
					class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
						dock.selectedCueIndex === index
							? "border-primary/35 bg-primary/10 text-foreground"
							: "border-transparent bg-background/60 text-foreground hover:border-border/70 hover:bg-background"
					}`}
					aria-pressed={dock.selectedCueIndex === index}
					onclick={() => analysis.selectCue(index)}
				>
					<span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
						{#if cue.type === "left" || cue.type === "slight_left" || cue.type === "sharp_left" || cue.type === "keep_left"}
							<CornerDownLeft class="size-4" />
						{:else if cue.type === "right" || cue.type === "slight_right" || cue.type === "sharp_right" || cue.type === "keep_right"}
							<CornerDownRight class="size-4" />
						{:else if cue.type === "u_turn"}
							<Shuffle class="size-4" />
						{:else if cue.type === "roundabout" || cue.type === "leave_roundabout"}
							<CircleDot class="size-4" />
						{:else if cue.type === "finish"}
							<Flag class="size-4" />
						{:else if cue.sign < 0}
							<ArrowLeft class="size-4" />
						{:else if cue.sign > 0}
							<ArrowRight class="size-4" />
						{:else}
							<ArrowUp class="size-4" />
						{/if}
					</span>
					<span class="min-w-0">
						<span class="block text-xs font-semibold text-muted-foreground">
							{formatExactDistance(cue.distanceFromStartMeters)}
						</span>
						<span class="block truncate text-sm font-semibold">
							{cue.text}
						</span>
					</span>
					<span class="text-right text-xs tabular-nums text-muted-foreground">
						<span class="block">{formatDistance(cue.segmentDistanceMeters)}</span>
						<span class="block">{analysis.formatCueSegmentTime(cue.segmentTimeMs)}</span>
					</span>
				</button>
			{/each}
		</div>
	{:else}
		<div class="flex min-h-20 items-center justify-center rounded-md border border-dashed border-border/60 bg-background/50 px-3 text-center text-sm text-muted-foreground">
			No directions available for this route
		</div>
	{/if}
</div>
