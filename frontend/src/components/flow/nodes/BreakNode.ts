import { CircleSlash2 } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const BreakNode: NodeTypeConfig = {
  type: "break",
  label: "Break",
  icon: CircleSlash2,
  color: "node-stop",
  description: "结束当前循环（foreach / while / for），继续走 done 分支",
  fields: [],
  subtitle: "break loop",
};

export default BreakNode;
