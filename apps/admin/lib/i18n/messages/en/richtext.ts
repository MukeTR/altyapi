import type trRichText from "../tr/richtext";

const richText: typeof trRichText = {
  toolbar: "Text formatting",
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strike: "Strikethrough",
  heading2: "Heading 2",
  heading3: "Heading 3",
  bulletList: "Bulleted list",
  orderedList: "Numbered list",
  quote: "Quote",
  link: "Add or edit link",
  unlink: "Remove link",
  undo: "Undo",
  redo: "Redo",
  linkUrl: "Link address",
  linkHint: "A store path (/pages/contact) or an address starting with https://, mailto: or tel:.",
  linkNewTab: "Open in a new tab",
  linkApply: "Apply",
  linkInvalid: "The address must start with “/”, https://, mailto: or tel:.",
  readOnlyTitle: "This text can't be edited here",
  readOnlyBody: "It contains elements this editor doesn't support (such as tables, embeds or links to pages or products). It is kept unchanged.",
};

export default richText;
