import { FileText } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const DocumentNode: NodeTypeConfig = {
  type: "document",
  label: "Document",
  icon: FileText,
  color: "node-document",
  description: "Get the page document/window object for property extraction",
  fields: [],
  subtitle: "Provides access to document and window",
};

export default DocumentNode;
