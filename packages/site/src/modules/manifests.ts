import { catalogModule } from "./catalog";
import { commerceModule } from "./commerce";
import { contentModule } from "./content";
import { coreModule } from "./core";

/**
 * Manifests of the modules the platform ships, as pure data (no registry, no server
 * dependencies), so layers in front of the API can read them too. A module without a manifest
 * cannot be turned on.
 */
export const SITE_MODULE_MANIFESTS = [coreModule, contentModule, catalogModule, commerceModule] as const;

export type ModuleKey = (typeof SITE_MODULE_MANIFESTS)[number]["key"];
