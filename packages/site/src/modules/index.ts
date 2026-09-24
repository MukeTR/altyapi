import { ModuleRegistry } from "../registry";
import { SITE_MODULE_MANIFESTS, type ModuleKey } from "./manifests";

export { coreModule } from "./core";
export { contentModule } from "./content";
export { catalogModule, catalogModuleSettingsSchema, type CatalogModuleSettings } from "./catalog";
export { commerceModule } from "./commerce";
export { SITE_MODULE_MANIFESTS, type ModuleKey } from "./manifests";

/**
 * The platform module registry. Built when the package is first imported, i.e. at API and
 * worker boot (tenancy imports it for its gates): an invalid manifest set throws
 * ModuleRegistryError and the process does not start.
 */
export const SITE_MODULES = new ModuleRegistry<ModuleKey>(SITE_MODULE_MANIFESTS);
