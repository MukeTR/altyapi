import type trUi from "../tr/ui";

const ui: typeof trUi = {
  table: {
    newestFirst: "Newest first",
    selectAll: "Select all visible rows",
    selectRow: "Select {name}",
    selected: "{count} selected",
    clearSelection: "Clear selection",
    next: "Next",
    previous: "Previous",
    pagination: "Pagination",
    range: "{from}–{to} of {total}",
    loadMore: "Load more",
    sortBy: "Sort by {column}",
    loadingRows: "Loading rows",
  },
  field: {
    characterCount: "{count}/{max} characters",
    characterLimitNear: "{remaining} characters left",
    localeEmptyHint: "When empty, the {locale} text is shown.",
    localeCompletion: "{done}/{total} languages",
    invalidValue: "This value is invalid.",
    invalidEmail: "Enter a valid email address.",
    tooShort: "Enter at least {min} characters.",
    tooLong: "Enter at most {max} characters.",
    tooSmall: "The value must be at least {min}.",
    tooLarge: "The value can be at most {max}.",
    invalidOption: "Choose an option from the list.",
    requiredValue: "This field is required.",
  },
  money: {
    invalid: "Enter a valid amount (e.g. 1,234.56).",
    unknown: "Unknown",
  },
  datetime: {
    timezone: "{timezone} · {offset}",
    utc: "UTC: {value}",
  },
  secret: {
    saved: "Saved",
    notSet: "Not set",
    change: "Change",
    remove: "Remove",
    keep: "Keep current value",
    show: "Show value",
    hide: "Hide value",
    willRemove: "Will be removed when you save.",
  },
  upload: {
    dropzone: "Drag files here or click to choose",
    dropzoneLabel: "Choose files",
    accepted: "Allowed types: {types}",
    hashing: "Preparing…",
    uploading: "Uploading… {percent}%",
    processing: "Processing…",
    done: "Uploaded",
    failed: "Upload failed",
    retry: "Retry",
    remove: "Remove {name}",
    progress: "{name}: {percent}%",
  },
  combobox: {
    placeholder: "Select",
    search: "Search…",
    removeItem: "Remove {name}",
    loading: "Loading…",
    selected: "selected",
    loadFailed: "Couldn't load the list",
  },
  countdown: {
    remaining: "Time left: {time}",
    oneMinute: "One minute left.",
    expired: "Expired.",
  },
  stepper: {
    label: "Steps",
    step: "Step {current} of {total}",
    completed: "completed",
  },
  toast: {
    region: "Notifications ({hotkey})",
  },
  progress: {
    rows: "{done} / {total} rows",
  },
  percent: {
    unknown: "Unknown",
  },
};

export default ui;
