import { env } from "$env/dynamic/public";
import { api } from "../../../convex/_generated/api";
import { Cause, Effect } from "effect";
import { getOptionalConvexClient } from "$lib/convex-client.svelte";
import { savedRoutesState, type SavedRoute } from "$lib/saved-routes.svelte";
import { serializeSavedRouteForRemote } from "$lib/saved-routes-core";
import {
	buildShareUrl,
	copyTextToClipboardEffect,
	generateShareTokenEffect,
} from "$lib/shared-routes";
import type { PlannedRoute } from "$lib/route-planning";
import {
	getRouteShareSignature,
	pruneRouteShareState,
} from "$lib/route-planner/page/planner-state";
import {
	PlannerShareError,
	type PlannerSavedRouteError,
} from "./planner-controller-errors";

type PlannerSharingControllerDependencies = {
	getActiveRoute: () => PlannedRoute | null;
	getRouteNeedsRecalculation: () => boolean;
	getPlannerDraftRouteId: () => string | null;
	getActiveSavedRouteId: () => string | null;
	getBrowserWindow: () => Window | null;
	saveActiveRouteDraft: (options: {
		force?: boolean;
		source?: "autosave" | "explicit" | "share";
	}) => Effect.Effect<SavedRoute | null, PlannerSavedRouteError>;
};

export function createPlannerSharingController(
	dependencies: PlannerSharingControllerDependencies,
) {
	const convexClient = Effect.runSync(getOptionalConvexClient());

	let routeShareErrors = $state<Record<string, string | null>>({});
	let routeShareUrls = $state<Record<string, string | null>>({});
	let isSharingRoute = $state(false);
	let activeRouteShareCopied = $state<Record<string, boolean>>({});

	const activeRoute = $derived(dependencies.getActiveRoute());
	const activeRouteShareKey = $derived(
		activeRoute
			? (dependencies.getPlannerDraftRouteId() ??
					dependencies.getActiveSavedRouteId() ??
					getRouteShareSignature(activeRoute))
			: null,
	);
	const activeRouteShareError = $derived(
		activeRouteShareKey
			? (routeShareErrors[activeRouteShareKey] ?? null)
			: null,
	);
	const activeRouteShareUrl = $derived(
		activeRouteShareKey ? (routeShareUrls[activeRouteShareKey] ?? null) : null,
	);
	const isActiveRouteShareCopied = $derived(
		activeRouteShareKey
			? Boolean(activeRouteShareCopied[activeRouteShareKey])
			: false,
	);

	$effect(() => {
		const keepKeys = new Set(
			savedRoutesState.savedRoutes.map((savedRoute) => savedRoute.id),
		);
		if (activeRouteShareKey) {
			keepKeys.add(activeRouteShareKey);
		}

		routeShareErrors = Effect.runSync(
			pruneRouteShareState(routeShareErrors, keepKeys),
		);
		routeShareUrls = Effect.runSync(
			pruneRouteShareState(routeShareUrls, keepKeys),
		);
		activeRouteShareCopied = Effect.runSync(
			pruneRouteShareState(activeRouteShareCopied, keepKeys),
		);
	});

	function setRouteShareError(routeKey: string, error: string | null) {
		routeShareErrors = {
			...routeShareErrors,
			[routeKey]: error,
		};
	}

	function setRouteShareUrl(routeKey: string, url: string | null) {
		routeShareUrls = {
			...routeShareUrls,
			[routeKey]: url,
		};
	}

	function setRouteShareCopied(routeKey: string, copied: boolean) {
		activeRouteShareCopied = {
			...activeRouteShareCopied,
			[routeKey]: copied,
		};
	}

	function clearRouteShareState(routeKey: string) {
		setRouteShareError(routeKey, null);
		setRouteShareUrl(routeKey, null);
		setRouteShareCopied(routeKey, false);
	}

	const createSharedRouteEffect = Effect.fn("createSharedRouteEffect")(
		function* (savedRoute: SavedRoute) {
			if (!convexClient) {
				return yield* new PlannerShareError({
					cause: new Error("Convex client is unavailable."),
				});
			}

			const shareToken = yield* generateShareTokenEffect().pipe(
				Effect.mapError((cause) => new PlannerShareError({ cause })),
			);
			return yield* Effect.tryPromise({
				try: () =>
					convexClient.mutation(api.sharedRoutes.create, {
						shareToken,
						sourceRouteId: savedRoute.id,
						savedRoute: serializeSavedRouteForRemote(savedRoute),
					}),
				catch: (cause) => new PlannerShareError({ cause }),
			});
		},
	);

	const handleShareActiveRouteEffect = Effect.fn(
		"handleShareActiveRouteEffect",
	)(function* () {
		if (!activeRoute || dependencies.getRouteNeedsRecalculation()) {
			return;
		}

		const routeKey = activeRouteShareKey;
		if (!routeKey) {
			return;
		}
		let shareErrorKey = routeKey;

		clearRouteShareState(routeKey);

		if (!convexClient || !env.PUBLIC_CONVEX_URL) {
			setRouteShareError(
				routeKey,
				"Route sharing needs Convex to be configured.",
			);
			return;
		}

		if (savedRoutesState.authStatus !== "signedIn") {
			setRouteShareError(routeKey, "Sign in to share routes.");
			return;
		}

		isSharingRoute = true;

		return yield* Effect.gen(function* () {
			const savedRoute = yield* dependencies.saveActiveRouteDraft({
				force: true,
				source: "share",
			});

			if (!savedRoute) {
				return;
			}

			const savedRouteKey = savedRoute.id;
			shareErrorKey = savedRouteKey;
			clearRouteShareState(savedRouteKey);

			const result = yield* createSharedRouteEffect(savedRoute);
			const shareUrl = buildShareUrl(
				dependencies.getBrowserWindow()?.location.origin ??
					globalThis.location.origin,
				result.shareToken,
			);
			const copied = yield* copyTextToClipboardEffect(shareUrl);

			if (!copied) {
				setRouteShareUrl(savedRouteKey, shareUrl);
				setRouteShareError(
					savedRouteKey,
					"Share link created, but copying failed.",
				);
				return;
			}

			setRouteShareUrl(savedRouteKey, null);
			setRouteShareCopied(savedRouteKey, true);
		}).pipe(
			Effect.catchTags({
				PlannerSavedRouteError: (error) =>
					Effect.sync(() => {
						const cause = Cause.squash(Cause.fail(error.cause));
						setRouteShareError(
							shareErrorKey,
							cause instanceof Error
								? `Could not share route: ${cause.message}`
								: "Could not share route.",
						);
					}),
				PlannerShareError: (error) =>
					Effect.sync(() => {
						const cause = Cause.squash(Cause.fail(error.cause));
						setRouteShareError(
							shareErrorKey,
							cause instanceof Error
								? `Could not share route: ${cause.message}`
								: "Could not share route.",
						);
					}),
			}),
			Effect.ensuring(
				Effect.sync(() => {
					isSharingRoute = false;
				}),
			),
		);
	});

	function handleShareActiveRoute() {
		return handleShareActiveRouteEffect();
	}

	return {
		get routeShareErrors() {
			return routeShareErrors;
		},
		get routeShareUrls() {
			return routeShareUrls;
		},
		get isSharingRoute() {
			return isSharingRoute;
		},
		get activeRouteShareCopied() {
			return activeRouteShareCopied;
		},
		get activeRouteShareKey() {
			return activeRouteShareKey;
		},
		get activeRouteShareError() {
			return activeRouteShareError;
		},
		get activeRouteShareUrl() {
			return activeRouteShareUrl;
		},
		get isActiveRouteShareCopied() {
			return isActiveRouteShareCopied;
		},
		handleShareActiveRoute,
		setRouteShareError,
		setRouteShareUrl,
		setRouteShareCopied,
		clearRouteShareState,
	};
}

export type PlannerSharingController = ReturnType<
	typeof createPlannerSharingController
>;
