import type trCommerce from "../tr/commerce";

const commerce: typeof trCommerce = {
  tags: {
    placeholder: "Type a tag and press Enter",
    hint: "Enter or a comma adds the tag; Backspace in an empty field removes the last tag.",
    list: "Tags",
    remove: "Remove tag {tag}",
  },
  quantity: {
    decrease: "{name}: decrease",
    increase: "{name}: increase",
  },
  filters: {
    all: "All",
    clear: "Clear filters",
    from: "From",
    to: "To",
    dateRange: "Date range",
    anyPayment: "All payment statuses",
  },
  noPermission: "You don't have permission for this action ({permission}).",
  unsaved: "Unsaved changes",
  savedToast: "Changes saved.",
  loadMoreFailed: "The list couldn't be loaded.",
};

export default commerce;
