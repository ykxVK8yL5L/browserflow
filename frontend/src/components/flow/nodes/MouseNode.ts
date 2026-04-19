import { Mouse } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const MouseNode: NodeTypeConfig = {
  type: "mouse",
  label: "Mouse",
  icon: Mouse,
  color: "node-mouse",
  description: "Perform mouse actions like click, double click, move, down, and up",
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
        { label: "Click", value: "click" },
        { label: "Double Click", value: "dblclick" },
        { label: "Mouse Down", value: "down" },
        { label: "Mouse Move", value: "move" },
        { label: "Mouse Up", value: "up" },
      ],
      defaultValue: "click",
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
      defaultValue: 0,
      valueSource: "params",
    },
    {
      key: "button",
      label: "Button",
      type: "select",
      options: [
        { label: "Left", value: "left" },
        { label: "Middle", value: "middle" },
        { label: "Right", value: "right" },
      ],
      defaultValue: "left",
      valueSource: "params",
    },
    {
      key: "clickCount",
      label: "Click Count",
      type: "number",
      defaultValue: 1,
      valueSource: "params",
    },
    {
      key: "delay",
      label: "Delay",
      type: "number",
      defaultValue: 0,
      valueSource: "params",
    },
    {
      key: "steps",
      label: "Move Steps",
      type: "number",
      defaultValue: 1,
      valueSource: "params",
    },
    {
      key: "timeout",
      label: "Timeout",
      type: "number",
      defaultValue: 30000,
      valueSource: "params",
    },
  ],
  subtitle: "{action}",
};

export default MouseNode;