<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Map as MapIcon, Zap, Settings, Bookmark, Compass, Smartphone } from 'lucide-svelte';

	const groupClass =
		'mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground/60';

	const navGroups = [
		{
			label: 'Planning',
			items: [
				{ title: 'Route planner', url: '/', icon: MapIcon },
				{ title: 'My routes', url: '/routes', icon: Bookmark },
				{ title: 'Explore', url: '#', icon: Compass }
			]
		},
		{
			label: 'Account',
			items: [
				{ title: 'Connected devices', url: '#', icon: Smartphone },
				{ title: 'Settings', url: '/settings', icon: Settings }
			]
		}
	];
</script>

<Sidebar.Root collapsible="icon" class="border-e border-sidebar-border">
	<Sidebar.Header
		class="flex flex-row items-center gap-2 border-b border-sidebar-border/50 p-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:border-b-0 group-data-[collapsible=icon]:p-2"
	>
		<Sidebar.Trigger
			class="size-9 shrink-0 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-0"
		/>
		<div
			class="rounded-lg bg-primary p-1.5 text-primary-foreground shadow-sm group-data-[collapsible=icon]:hidden"
		>
			<Zap class="size-4" />
		</div>
		<span
			class="text-base font-bold uppercase italic tracking-tight group-data-[collapsible=icon]:hidden"
			>Velix</span
		>
	</Sidebar.Header>
	<Sidebar.Content class="gap-0 px-1 py-2">
		{#each navGroups as group}
			<Sidebar.Group class="gap-0.5">
				{#if group.label}
					<Sidebar.GroupLabel class={groupClass}>{group.label}</Sidebar.GroupLabel>
				{/if}
				<Sidebar.GroupContent>
					<Sidebar.Menu class="gap-0.5">
						{#each group.items as item}
							<Sidebar.MenuItem class="px-0">
								<Sidebar.MenuButton
									tooltipContent={item.title}
									class="px-2 transition-colors hover:bg-sidebar-accent"
								>
									{#snippet child({ props })}
										<a href={item.url} {...props} class="flex items-center gap-2 font-medium">
											<item.icon class="size-4 shrink-0 text-sidebar-foreground/70" />
											<span class="truncate">{item.title}</span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/each}
	</Sidebar.Content>
</Sidebar.Root>
