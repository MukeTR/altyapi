import type trPricelists from "../tr/pricelists";

const pricelists: typeof trPricelists = {
  title: "Price lists",
  description: "The list price is the base price in each currency; sale and scheduled lists replace it by priority.",
  add: "Create price list",
  created: "Price list created.",
  deleted: "Price list deleted.",
  empty: "No price lists.",
  always: "Always",
  openEnded: "open-ended",
  delete: "Delete list {name}",
  deleteTitle: "Delete “{name}”?",
  deleteBody: "Its prices stop applying at once and products fall back to other lists' prices. Price history is kept.",
  columns: {
    name: "Name",
    kind: "Type",
    currency: "Currency",
    priority: "Priority",
    schedule: "Validity",
    status: "Status",
  },
  fields: {
    name: "Name",
    namePlaceholder: "e.g. Summer sale",
    kind: "Type",
    currency: "Currency",
    priority: "Priority",
    priorityHint: "When several lists apply at once, the higher priority wins (−1000 to 1000).",
    startsAt: "Starts",
    endsAt: "Ends",
  },
  kindHints: {
    sale: "Applies from the moment it is created.",
    scheduled: "Applies only in the time window you set.",
  },
};

export default pricelists;
