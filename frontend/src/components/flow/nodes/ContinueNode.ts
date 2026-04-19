import { SkipForward } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ContinueNode: NodeTypeConfig = {
  type: "continue",
  label: "Continue",
  icon: SkipForward,
  color: "node-logic",
  description: "跳过当前循环本轮剩余节点，直接进入下一轮（foreach / while / for）",
  fields: [],
  subtitle: "next iteration",
};

export default ContinueNode;
