import type trOnboarding from "../tr/onboarding";

const onboarding: typeof trOnboarding = {
  metaTitle: "Setup",
  title: "Let's set up your store",
  subtitle: "First create the organization that represents your business, then your first store.",
  steps: {
    label: "Setup steps",
    organization: "Organization",
    store: "Store",
  },
  organization: {
    title: "Organization",
    description: "Your team and your stores are grouped under this organization.",
    name: "Organization name",
    namePlaceholder: "e.g. Kaya Textiles",
    slug: "Short name",
    slugHint: "Generated from the name when left empty. Lowercase letters, digits and hyphens.",
    submit: "Create organization",
    created: "{name} created.",
  },
  store: {
    siteKind: "Site kind",
    siteKindHint: "Sets the starting modules and pages; you can change modules later under Site › Modules.",
    title: "Store",
    description: "Creating a store also prepares its storefront, default location, price list and tax class.",
    name: "Store name",
    namePlaceholder: "e.g. Kaya Boutique",
    slug: "Store address",
    slugHint: "Your store is published at {host}. At least 3 characters.",
    slugHintEmpty: "Generated from the name when left empty. At least 3 characters.",
    defaultLocale: "Default language",
    defaultLocaleHint: "The main language of your storefront content. You can add more languages later.",
    currency: "Currency",
    timezone: "Time zone",
    timezoneHint: "Order dates and scheduled publishing use this time zone.",
    country: "Country",
    contactEmail: "Contact email",
    contactEmailHint: "Used as the reply-to address on customer notifications.",
    submit: "Create store",
    created: "Store {name} created.",
  },
  noStoreAccess: {
    title: "You don't have access to any store in this organization",
    body: "Ask an administrator to give you access to a store.",
  },
};

export default onboarding;
