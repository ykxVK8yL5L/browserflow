import { type NodeField } from "../../nodeTypes";

/**
 * Shared selector fields — reusable across any node that targets an element.
 * Supports CSS selectors, XPath, Playwright locators, and JS expressions.
 */
export const selectorFields: NodeField[] = [
  {
    key: "selectorType",
    label: "Locator Strategy",
    type: "select",
    options: [
      { label: "Playwright Native", value: "native" },
      { label: "CSS Selector", value: "css" },
      { label: "Text", value: "text" },
      { label: "Role", value: "role" },
      { label: "Test ID", value: "testid" },
      { label: "Label", value: "label" },
      { label: "Placeholder", value: "placeholder" },
      { label: "XPath", value: "xpath" },
      { label: "JS Expression", value: "js" },
    ],
    defaultValue: "native",
  },
  {
    key: "selector",
    label: "Selector",
    type: "text",
    placeholder: "div.item / css=div.item / xpath=//div / text=Submit",
    defaultValue: "",
  },
];
