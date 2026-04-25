import { type NodeProps } from "@xyflow/react";
import GroupProxyHandles, { type GroupProxyConfig } from "./GroupProxyHandles";

const GroupProxyNode = ({ data }: NodeProps) => {
    const proxy = (data?.proxy || {}) as GroupProxyConfig;

    return <GroupProxyHandles proxy={proxy} />;
};

export default GroupProxyNode;
