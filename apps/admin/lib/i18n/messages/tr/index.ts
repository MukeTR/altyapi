import auth from "./auth";
import common from "./common";
import nav from "./nav";
import onboarding from "./onboarding";
import overview from "./overview";
import roles from "./roles";
import shell from "./shell";
import states from "./states";
import statuses from "./statuses";
import ui from "./ui";
import commerce from "./commerce";
import orders from "./orders";
import products from "./products";
import collections from "./collections";
import inventory from "./inventory";
import imports from "./imports";
import pricelists from "./pricelists";
import categories from "./categories";
import dashboard from "./dashboard";
import storefront from "./storefront";
import editor from "./editor";
import sections from "./sections";
import domains from "./domains";
import media from "./media";
import richText from "./richtext";
import settings from "./settings";
import team from "./team";
import payments from "./payments";
import brand from "./brand";
import tracking from "./tracking";
import integrations from "./integrations";
import ekosistem from "./ekosistem";
import karmatik from "./karmatik";
import yanit from "./yanit";

/**
 * Turkish interface text: the source catalog. Every namespace lives in its own file; a feature
 * adds `<feature>.ts` here and in ../en (typed against this one) and registers it below.
 */
export const tr = { common, auth, onboarding, nav, shell, states, ui, statuses, roles, overview, commerce, orders, products, collections, inventory, imports, pricelists, categories, dashboard, storefront, editor, sections, domains, media, richText, settings, team, payments, brand, tracking, integrations, ekosistem, karmatik, yanit };

export type Messages = typeof tr;
