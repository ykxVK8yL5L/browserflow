import { FileCode2 } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ContentNode: NodeTypeConfig = {
  type: "content",
  label: "Content",
  icon: FileCode2,
  color: "node-default",
  description: "Read the current page HTML content",
  outputType: "string",
  fields: [],
  subtitle: "page.content",
};

export default ContentNode;
