import { Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type {
    FlowNotificationLevel,
    FlowNotificationRule,
    NotificationEvent,
    NotificationRecipient,
} from "@/lib/notificationApi";

const LEVEL_OPTIONS: Array<{ value: FlowNotificationLevel; label: string; description: string }> = [
    {
        value: "flow_result",
        label: "仅 Flow 执行结果",
        description: "只通知成功、失败、开始或取消等整体状态。",
    },
    {
        value: "node_results",
        label: "每个节点执行结果",
        description: "包含每个节点的状态、耗时、消息与错误。",
    },
    {
        value: "node_results_with_data",
        label: "节点结果和返回数据",
        description: "在节点执行结果基础上附带节点返回数据。",
    },
    {
        value: "raw_data",
        label: "仅发送执行 JSON 数据",
        description: "不发送格式化文本，直接发送完整的执行 JSON 数据，适用于自动化处理。",
    },
];

interface Props {
    value: FlowNotificationRule[];
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
    onChange: (value: FlowNotificationRule[]) => void;
    recipients: NotificationRecipient[];
    eventOptions: Array<{ value: NotificationEvent; label: string }>;
}

export default function FlowNotificationsEditor({
    value,
    enabled,
    onEnabledChange,
    onChange,
    recipients,
    eventOptions,
}: Props) {
    const availableRecipients = recipients.filter((item) => item.enabled);

    const addRecipientRule = (recipientId: string) => {
        if (!recipientId || value.some((item) => item.recipient_id === recipientId)) return;
        const recipient = availableRecipients.find((item) => item.id === recipientId);
        if (!recipient) return;

        onChange([
            ...value,
            {
                id: crypto.randomUUID(),
                recipient_id: recipient.id,
                name: recipient.name,
                type: recipient.type,
                target: recipient.target,
                enabled: true,
                events: ["execution_failed"],
                level: "flow_result",
                headers: recipient.headers,
                secret: recipient.secret,
            },
        ]);
    };

    const removeRule = (id: string) => {
        onChange(value.filter((item) => item.id !== id));
    };

    const toggleRule = (id: string, enabled: boolean) => {
        onChange(value.map((item) => (item.id === id ? { ...item, enabled } : item)));
    };

    const toggleEvent = (ruleId: string, event: NotificationEvent, checked: boolean) => {
        onChange(
            value.map((item) => {
                if (item.id !== ruleId) return item;
                const nextEvents = checked
                    ? Array.from(new Set([...(item.events || []), event]))
                    : (item.events || []).filter((current) => current !== event);
                return { ...item, events: nextEvents };
            })
        );
    };

    const changeLevel = (ruleId: string, level: FlowNotificationLevel) => {
        onChange(value.map((item) => (item.id === ruleId ? { ...item, level } : item)));
    };

    return (
        <div className="space-y-4 rounded-lg border border-border p-4 bg-background/60">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-mono text-foreground">通知接收者</p>
                    <p className="text-xs font-mono text-muted-foreground mt-1">
                        这里只选择系统中已维护好的接收者，并设置发送时机。
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono text-muted-foreground">总开关</span>
                    <Switch checked={enabled} onCheckedChange={onEnabledChange} />
                </div>
            </div>

            {!enabled ? (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs font-mono text-muted-foreground">
                    当前 Flow 通知已关闭，执行时不会发送任何 Flow 通知。
                </div>
            ) : availableRecipients.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs font-mono text-muted-foreground">
                    暂无可用接收者，请先到系统设置里添加并启用接收者。
                </div>
            ) : (
                <div>
                    <label className="text-xs font-mono text-muted-foreground block mb-2">添加接收者</label>
                    <select
                        defaultValue=""
                        onChange={(e) => {
                            addRecipientRule(e.target.value);
                            e.currentTarget.value = "";
                        }}
                        className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                    >
                        <option value="">请选择系统接收者</option>
                        {availableRecipients
                            .filter((recipient) => !value.some((rule) => rule.recipient_id === recipient.id))
                            .map((recipient) => (
                                <option key={recipient.id} value={recipient.id}>
                                    {recipient.name}
                                </option>
                            ))}
                    </select>
                </div>
            )}

            {value.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs font-mono text-muted-foreground">
                    暂未配置通知接收者。
                </div>
            ) : (
                <div className="space-y-3">
                    {value.map((rule) => (
                        <div key={rule.id} className="rounded-md border border-border bg-card px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-mono text-foreground truncate">{rule.name}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <Switch checked={rule.enabled} onCheckedChange={(checked) => toggleRule(rule.id, checked)} />
                                    <button
                                        onClick={() => removeRule(rule.id)}
                                        className="p-2 rounded-md hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
                                        title="删除接收者"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            <div className="mt-3">
                                <label className="text-xs font-mono text-muted-foreground block mb-2">通知级别</label>
                                <select
                                    value={rule.level || "flow_result"}
                                    onChange={(e) => changeLevel(rule.id, e.target.value as FlowNotificationLevel)}
                                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                                >
                                    {LEVEL_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-2 text-[11px] font-mono text-muted-foreground leading-5">
                                    {LEVEL_OPTIONS.find((option) => option.value === (rule.level || "flow_result"))?.description}
                                </p>
                            </div>

                            <div className="mt-3">
                                <label className="text-xs font-mono text-muted-foreground block mb-2">发送时机</label>
                                <div className="grid gap-2 md:grid-cols-2">
                                    {eventOptions.map((item) => (
                                        <label key={item.value} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-mono text-foreground">
                                            <input
                                                type="checkbox"
                                                checked={rule.events.includes(item.value)}
                                                onChange={(e) => toggleEvent(rule.id, item.value, e.target.checked)}
                                            />
                                            <span>{item.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
