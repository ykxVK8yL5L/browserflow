import { ArrowDown } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const ScrollNode: NodeTypeConfig = {
  type: "scroll",
  label: "Scroll",
  icon: ArrowDown,
  color: "node-scroll",
  description: "Scroll the page by distance, to coordinates, to top/bottom, or to an element",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "object",
  fields: [
    {
      key: "action",
      label: "Action",
      type: "select",
      options: [
        { label: "Scroll By", value: "by" },
        { label: "Scroll To Coordinates", value: "to" },
        { label: "Scroll To Top", value: "top" },
        { label: "Scroll To Bottom", value: "bottom" },
        { label: "Scroll To Element", value: "element" },
      ],
      defaultValue: "by",
      valueSource: "params",
    },
    ...selectorFields,
    {
      key: "x",
      label: "X",
      type: "number",
      defaultValue: 0,
      valueSource: "params",
    },
    {
      key: "y",
      label: "Y",
      type: "number",
      defaultValue: 500,
      valueSource: "params",
    },
    {
      key: "deltaX",
      label: "Delta X",
      type: "number",
      defaultValue: 0,
      valueSource: "params",
    },
    {
      key: "deltaY",
      label: "Delta Y",
      type: "number",
      defaultValue: 500,
      valueSource: "params",
    },
    {
      key: "behavior",
      label: "Behavior",
      type: "select",
      options: [
        { label: "Auto", value: "auto" },
        { label: "Smooth", value: "smooth" },
      ],
      defaultValue: "auto",
      valueSource: "params",
    },
  ],
  subtitle: "{action}",
};

export default ScrollNode;
