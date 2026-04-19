import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type {
    NotificationRecipient,
    SystemNotificationEvent,
    SystemNotificationRule,
} from "@/lib/notificationApi";

interface Props {
    value: SystemNotificationRule[];
    onChange: (value: SystemNotificationRule[]) => void;
    recipients: NotificationRecipient[];
    eventOptions: Array<{ value: SystemNotificationEvent; label: string }>;
}

export default function SystemNotificationRulesEditor({
    value,
    onChange,
    recipients,
    eventOptions,
}: Props) {
    const [pendingRecipientIds, setPendingRecipientIds] = useState<Record<string, string>>({});
    const availableRecipients = recipients.filter((item) => item.enabled);

    const groupedRecipients = (recipientIds: string[]) => {
        const groups: Record<string, NotificationRecipient[]> = {};
        recipientIds.forEach((recipientId) => {
            const recipient = availableRecipients.find((item) => item.id === recipientId);
            if (!recipient) return;
            if (!groups[recipient.type]) groups[recipient.type] = [];
            groups[recipient.type].push(recipient);
        });
        return groups;
    };

    const updateRule = (event: SystemNotificationEvent, updater: (rule: SystemNotificationRule) => SystemNotificationRule) => {
        onChange(
            value.map((item) => (item.event === event ? updater(item) : item))
        );
    };

    const toggleRecipient = (event: SystemNotificationEvent, recipientId: string, checked: boolean) => {
        updateRule(event, (rule) => ({
            ...rule,
            recipient_ids: checked
                ? Array.from(new Set([...(rule.recipient_ids || []), recipientId]))
                : (rule.recipient_ids || []).filter((id) => id !== recipientId),
        }));
    };

    const addRecipient = (event: SystemNotificationEvent, recipientId: string) => {
        if (!recipientId) return;
        updateRule(event, (rule) => ({
            ...rule,
            recipient_ids: Array.from(new Set([...(rule.recipient_ids || []), recipientId])),
        }));
        setPendingRecipientIds((prev) => ({ ...prev, [event]: "" }));
    };

    return (
        <div className="space-y-4 rounded-lg border border-border p-4 bg-background/40">
            <div>
                <p className="text-sm font-mono text-foreground">系统通知开关</p>
                <p className="text-xs font-mono text-muted-foreground mt-1">
                    为系统事件指定通知接收者。当前先支持登录事件，后续可继续扩展。
                </p>
            </div>

            {eventOptions.map((option) => {
                const rule = value.find((item) => item.event === option.value) || {
                    event: option.value,
                    label: option.label,
                    enabled: false,
                    recipient_ids: [],
                };
                const selectableRecipients = availableRecipients.filter(
                    (recipient) => !rule.recipient_ids.includes(recipient.id)
                );
                const pendingRecipientId = pendingRecipientIds[option.value] || "";
                const recipientGroups = groupedRecipients(rule.recipient_ids);

                return (
                    <div key={option.value} className="rounded-md border border-border bg-card px-3 py-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-mono text-foreground">{rule.label}</p>
                                <p className="text-xs font-mono text-muted-foreground">事件标识：{rule.event}</p>
                            </div>
                            <Switch
                                checked={rule.enabled}
                                onCheckedChange={(checked) =>
                                    updateRule(option.value, (current) => ({ ...current, enabled: checked }))
                                }
                            />
                        </div>

                        <div>
                            <p className="text-xs font-mono text-muted-foreground mb-2">接收者</p>
                            {availableRecipients.length === 0 ? (
                                <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs font-mono text-muted-foreground">
                                    暂无可用接收者，请先在下方添加并启用通知接收者。
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {selectableRecipients.length > 0 && (
                                        <div className="flex gap-2">
                                            <select
                                                value={pendingRecipientId}
                                                onChange={(e) =>
                                                    setPendingRecipientIds((prev) => ({
                                                        ...prev,
                                                        [option.value]: e.target.value,
                                                    }))
                                                }
                                                className="flex-1 px-3 py-2 rounded-md bg-background border border-border text-xs font-mono"
                                            >
                                                <option value="">选择接收者后添加</option>
                                                {selectableRecipients.map((recipient) => (
                                                    <option key={recipient.id} value={recipient.id}>
                                                        {recipient.name} · {recipient.type}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => addRecipient(option.value, pendingRecipientId)}
                                                disabled={!pendingRecipientId}
                                                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono disabled:opacity-50 disabled:cursor-not-allowed hover:bg-secondary/80"
                                            >
                                                <Plus size={14} />
                                                添加
                                            </button>
                                        </div>
                                    )}

                                    {rule.recipient_ids.length === 0 ? (
                                        <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs font-mono text-muted-foreground">
                                            暂未选择接收者。
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {Object.entries(recipientGroups).map(([channelType, recipientsInGroup]) => (
                                                <div key={channelType} className="space-y-2">
                                                    <p className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                                                        {channelType}
                                                    </p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {recipientsInGroup.map((recipient) => (
                                                            <div
                                                                key={recipient.id}
                                                                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono text-foreground"
                                                            >
                                                                <span className="max-w-[240px] truncate">
                                                                    {recipient.name}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleRecipient(option.value, recipient.id, false)}
                                                                    className="rounded-sm text-muted-foreground hover:text-destructive"
                                                                    title="移除接收者"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
