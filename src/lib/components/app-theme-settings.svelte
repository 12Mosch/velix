<script lang="ts">
	import { Laptop, Moon, Sun } from "lucide-svelte";
	import { resetMode, setMode, userPrefersMode, type UserPrefersMode } from "mode-watcher";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";

	type ThemeMode = UserPrefersMode["current"];

	const themeOptions: Array<{
		mode: ThemeMode;
		label: string;
		description: string;
		icon: typeof Sun;
	}> = [
		{
			mode: "system",
			label: "System",
			description: "Use the light or dark theme from your desktop settings.",
			icon: Laptop,
		},
		{
			mode: "light",
			label: "Light",
			description: "Use the light theme regardless of your desktop settings.",
			icon: Sun,
		},
		{
			mode: "dark",
			label: "Dark",
			description: "Use the dark theme regardless of your desktop settings.",
			icon: Moon,
		},
	];

	function selectThemeMode(mode: ThemeMode) {
		if (mode === "system") {
			resetMode();
			return;
		}

		setMode(mode);
	}
</script>

<div class="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="App theme">
	{#each themeOptions as option}
		<Button
			variant="outline"
			class={`h-auto w-full items-start justify-start whitespace-normal rounded-lg px-3.5 py-3 text-left transition-colors ${
				userPrefersMode.current === option.mode
					? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
					: "hover:bg-secondary/60"
			}`}
			role="radio"
			aria-checked={userPrefersMode.current === option.mode}
			aria-label={option.label}
			onclick={() => selectThemeMode(option.mode)}
		>
			<div class="flex min-w-0 flex-col gap-1.5">
				<div class="flex flex-wrap items-center gap-2">
					<option.icon class="size-4 shrink-0 text-muted-foreground" />
					<span class="font-heading text-sm font-semibold tracking-tight text-foreground">
						{option.label}
					</span>
					{#if userPrefersMode.current === option.mode}
						<Badge
							variant="outline"
							class="h-5 border-primary/30 bg-primary/10 px-2 text-[10px] font-semibold text-primary"
						>
							Selected
						</Badge>
					{/if}
				</div>
				<p class="text-xs leading-5 text-muted-foreground">
					{option.description}
				</p>
			</div>
		</Button>
	{/each}
</div>
