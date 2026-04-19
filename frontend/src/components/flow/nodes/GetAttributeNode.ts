import { Tag } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const GetAttributeNode: NodeTypeConfig = {
  type: "getAttribute",
  label: "Get Attribute",
  icon: Tag,
  color: "node-default",
  description: "Read an attribute from a target element",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "string",
  fields: [
    ...selectorFields,
    { key: "attribute", label: "Attribute", type: "text", placeholder: "href", defaultValue: "href" },
  ],
  subtitle: "attr {attribute}",
};

export default GetAttributeNode;
