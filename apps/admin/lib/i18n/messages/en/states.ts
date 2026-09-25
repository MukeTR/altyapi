import type trStates from "../tr/states";

const states: typeof trStates = {
  errorTitle: "This content couldn't be loaded",
  unexpected: "Something unexpected went wrong. If it keeps happening, contact us with the support code.",
  networkTitle: "Couldn't reach the server",
  networkBody: "Check your connection and try again.",
  forbiddenTitle: "You don't have permission to view this section",
  forbiddenBody: "Contact your organization administrator for access.",
  forbiddenPermission: "Required permission: {permission}",
  notFoundTitle: "Page not found",
  notFoundBody: "The page you're looking for may have moved, been deleted or never existed.",
  recordNotFoundTitle: "Record not found",
  recordNotFoundBody: "It may have been deleted, or you don't have access to it.",
  emptyFilteredTitle: "No records match these filters",
  emptyFilteredBody: "Change or clear the filters.",
  clearFilters: "Clear filters",
  errorSummary: "{count} fields need attention.",
  errorSummaryOne: "One field needs attention.",
  conflictTitle: "This record changed while you were editing",
  conflictBody: "Someone else (or another tab) saved a newer version.",
  conflictReload: "Load latest",
  conflictOverwrite: "Save anyway",
  unsavedChanges: "You have unsaved changes. Leave this page?",
};

export default states;
