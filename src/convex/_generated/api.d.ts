/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as effect from "../effect.js";
import type * as savedRouteHelpers from "../savedRouteHelpers.js";
import type * as savedRoutes from "../savedRoutes.js";
import type * as sharedRoutes from "../sharedRoutes.js";
import type * as userPreferenceValidators from "../userPreferenceValidators.js";
import type * as userPreferences from "../userPreferences.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  effect: typeof effect;
  savedRouteHelpers: typeof savedRouteHelpers;
  savedRoutes: typeof savedRoutes;
  sharedRoutes: typeof sharedRoutes;
  userPreferenceValidators: typeof userPreferenceValidators;
  userPreferences: typeof userPreferences;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
