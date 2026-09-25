import type trSettings from "../tr/settings";

const settings: typeof trSettings = {
  readOnlyTitle: "View only",
  readOnlyBody: "Changing these settings requires the {permission} permission.",
  general: {
    title: "General settings",
    meta: "Store name, content languages, currencies, time zone and status.",
    saved: "Settings saved",
    identity: {
      title: "Store",
      description: "The name shown in the admin and in notifications. The store address (slug) cannot change after creation.",
      name: "Store name",
      slug: "Store address",
      slugHelp: "Part of your platform subdomain; it is permanent.",
    },
    languages: {
      title: "Content languages",
      description: "Choose the languages you publish product, page and menu text in. The default language is used where a translation is missing.",
      supported: "Publishing languages",
      supportedHelp: "Each language you select gets its own text box in content fields.",
      default: "Default language",
      defaultHelp: "Must be one of the publishing languages.",
      defaultLocked: "The default language cannot be removed; choose another default first.",
      rtl: "Right to left",
      rtlNote: "Right-to-left languages (Arabic, Persian) are mirrored on the storefront, and their text fields open right to left.",
    },
    currencies: {
      title: "Currencies",
      description: "Currencies available to price lists and shipping rates.",
      default: "Default currency",
      defaultHelp: "Chosen when the store was created and cannot change; the base price list uses it.",
      supported: "Accepted currencies",
      supportedHelp: "The default currency is always included.",
      search: "Search currencies…",
    },
    region: {
      title: "Region and time",
      description: "Orders, reports and scheduled publishing are shown in this time zone.",
      timezone: "Time zone",
      timezoneHelp: "For example Europe/Istanbul.",
      searchTimezone: "Search time zones…",
      country: "Country",
      countryHelp: "Chosen when the store was created; it sets tax and shipping defaults.",
    },
    status: {
      title: "Store status",
      description: "Whether the storefront is open to visitors and orders.",
      closed: "This store is closed. The status of a closed store cannot be changed here.",
      help: {
        setup: "Setup in progress; even with a published storefront the store is not considered open yet.",
        active: "The store is open and visitors can buy.",
        paused: "The store is temporarily closed; no new orders are taken.",
      },
    },
  },
};

export default settings;
