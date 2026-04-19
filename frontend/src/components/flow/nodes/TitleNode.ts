import { Heading1 } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const TitleNode: NodeTypeConfig = {
  type: "title",
  label: "Title",
  icon: Heading1,
  color: "node-title",
  description: "Read the current page title",
  outputType: "string",
  fields: [],
  subtitle: "page.title",
};

export default TitleNode;
