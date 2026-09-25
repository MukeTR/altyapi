import type trCategories from "../tr/categories";

const categories: typeof trCategories = {
  title: "Categories",
  description: "Categories organize products; they are used in automated collection rules and Google Shopping mapping.",
  add: "Add category",
  editTitle: "Edit category",
  edit: "Edit category {name}",
  saved: "Category saved.",
  level: "level {n}",
  empty: {
    title: "No categories yet",
    body: "Create top-level and sub categories to group your products.",
  },
  fields: {
    name: "Category name",
    parent: "Parent category",
    root: "None (top level)",
    handle: "Handle",
    handleHint: "Generated from the name when empty.",
    position: "Position",
    positionHint: "Order among siblings.",
    google: "Google product category",
    googleHint: "Google Merchant category ID (a number).",
  },
};

export default categories;
