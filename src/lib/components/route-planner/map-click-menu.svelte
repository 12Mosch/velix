<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import type { MapClickSelection, PlannerMode, SelectedMapStop } from "$lib/route-planner/types";
	import { Lock, Unlock } from "@lucide/svelte";

	let {
		selection,
		plannerMode,
		isOutAndBackMode,
		waypointCount,
		maxWaypoints,
		isResolving,
		title,
		subtitle,
		removeActionLabel,
		isWaypointInsertionLocked,
		isSegmentLocked,
		onApplyAsStart,
		onApplyAsWaypoint,
		onApplyAsDestination,
		onToggleSegmentLock,
		onRemoveStop,
		onClose,
	}: {
		selection: MapClickSelection;
		plannerMode: PlannerMode;
		isOutAndBackMode: boolean;
		waypointCount: number;
		maxWaypoints: number;
		isResolving: boolean;
		title: string;
		subtitle: string;
		removeActionLabel: (selectedStop: SelectedMapStop) => string;
		isWaypointInsertionLocked: (selection: MapClickSelection) => boolean;
		isSegmentLocked: (selection: MapClickSelection) => boolean;
		onApplyAsStart: () => unknown;
		onApplyAsWaypoint: () => unknown;
		onApplyAsDestination: () => unknown;
		onToggleSegmentLock: () => void;
		onRemoveStop: (selectedStop: SelectedMapStop) => void;
		onClose: () => void;
	} = $props();
</script>

<div
	class="pointer-events-auto absolute z-30 w-52 -translate-x-1/2 -translate-y-[calc(100%+0.85rem)] rounded-xl border border-border/70 bg-background/95 p-2 shadow-xl backdrop-blur-sm"
	style={`left: ${selection.screenPoint.x}px; top: ${selection.screenPoint.y}px;`}
	role="menu"
	aria-label="Set clicked map point"
>
	<div class="px-2 pb-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
		{title}
	</div>
	<div class="px-2 pb-2 text-xs text-muted-foreground">
		{subtitle}
	</div>
	<div class="flex flex-col gap-1">
		<Button
			variant="ghost"
			size="sm"
			class="justify-start"
			type="button"
			disabled={isResolving}
			onclick={onApplyAsStart}
		>
			Set as start
		</Button>
		{#if plannerMode === "point_to_point"}
			<Button
				variant="ghost"
				size="sm"
				class="justify-start"
				type="button"
				disabled={isResolving || waypointCount >= maxWaypoints || isWaypointInsertionLocked(selection)}
				onclick={onApplyAsWaypoint}
			>
				Add waypoint here
			</Button>
			<Button
				variant="ghost"
				size="sm"
				class="justify-start"
				type="button"
				disabled={isResolving}
				onclick={onApplyAsDestination}
			>
				Set as destination
			</Button>
		{:else if isOutAndBackMode}
			<Button
				variant="ghost"
				size="sm"
				class="justify-start"
				type="button"
				disabled={isResolving}
				onclick={onApplyAsDestination}
			>
				Set as turnaround
			</Button>
		{/if}
		{#if selection.selectedSegment}
			<Button
				variant="ghost"
				size="sm"
				class="justify-start gap-2"
				type="button"
				onclick={onToggleSegmentLock}
			>
				{#if isSegmentLocked(selection)}
					<Unlock class="size-3.5" />
					Unlock segment
				{:else}
					<Lock class="size-3.5" />
					Lock segment
				{/if}
			</Button>
		{/if}
		{#if selection.selectedStop}
			<Button
				variant="ghost"
				size="sm"
				class="justify-start text-destructive hover:text-destructive"
				type="button"
				disabled={isResolving}
				onclick={() => selection.selectedStop && onRemoveStop(selection.selectedStop)}
			>
				{removeActionLabel(selection.selectedStop)}
			</Button>
		{/if}
		<Button
			variant="ghost"
			size="sm"
			class="justify-start text-muted-foreground"
			type="button"
			disabled={isResolving}
			onclick={onClose}
		>
			Cancel
		</Button>
	</div>
</div>
