import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { generateId } from "@/lib/utils";
import type {
    NotificationChannelDefinition,
    NotificationChannelType,
    NotificationRecipient,
} from "@/lib/notificationApi";

interface Props {
    value: NotificationRecipient[];
    onChange: (value: NotificationRecipient[]) => void;
    definitions: NotificationChannelDefinition[];
    enabledChannelTypes: NotificationChannelType[];
}

const createEmptyRecipient = (type: NotificationChannelType): NotificationRecipient => ({
    id: generateId(),
    name: "",
    type,
    target: "",
    enabled: true,
    headers: {},
    secret: "",
    method: "POST",
    body_template: "",
});

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

const defaultType = (enabledChannelTypes: NotificationChannelType[]): NotificationChannelType =>
    enabledChannelTypes.includes("email") ? "email" : enabledChannelTypes[0] || "email";

const normalizeRecipientTarget = (
    type: NotificationChannelType,
    target: string,
): string => {
    const normalized = target.trim();
    if (type !== "webhook") return normalized;
    return normalized.replace(/["'“”‘’]/g, "").trim();
};

export default function SystemNotificationRecipientsEditor({
    value,
    onChange,
    definitions,
    enabledChannelTypes,
}: Props) {
    const channelDisabled = enabledChannelTypes.length === 0;
    const [editingRecipientId, setEditingRecipientId] = useState<string | null>(null);
    const [draft, setDraft] = useState<NotificationRecipient>(
        createEmptyRecipient(defaultType(enabledChannelTypes))
    );
    const [headersText, setHeadersText] = useState("{}\n");

    const typeOptions = useMemo(
        () => definitions.filter((item) => enabledChannelTypes.includes(item.type)),
        [definitions, enabledChannelTypes]
    );

    const currentDefinition =
        definitions.find((item) => item.type === draft.type) || definitions[0];

    const saveRecipient = () => {
        const normalizedTarget = normalizeRecipientTarget(draft.type, draft.target);
        if (!draft.name.trim() || !normalizedTarget) return;
        const nextRecipient: NotificationRecipient = {
            ...draft,
            id: draft.id || generateId(),
            name: draft.name.trim(),
            target: normalizedTarget,
            secret: draft.type === "webhook" ? draft.secret?.trim() || "" : undefined,
            method: draft.type === "webhook" ? draft.method || "POST" : undefined,
            headers: draft.type === "webhook" ? draft.headers || {} : undefined,
            body_template:
                draft.type === "webhook" ? draft.body_template?.trim() || "" : undefined,
        };
        if (editingRecipientId) {
            onChange(
                value.map((item) => (item.id === editingRecipientId ? nextRecipient : item))
            );
        } else {
            onChange([...value, nextRecipient]);
        }
        const nextType = defaultType(enabledChannelTypes);
        setDraft(createEmptyRecipient(nextType));
        setHeadersText("{}\n");
        setEditingRecipientId(null);
    };

    const editRecipient = (recipient: NotificationRecipient) => {
        setEditingRecipientId(recipient.id);
        setDraft({
            ...recipient,
            headers: recipient.headers || {},
            secret: recipient.secret || "",
            method: recipient.method || "POST",
            body_template: recipient.body_template || "",
        });
        setHeadersText(JSON.stringify(recipient.headers || {}, null, 2));
    };

    const cancelEditing = () => {
        const nextType = defaultType(enabledChannelTypes);
        setDraft(createEmptyRecipient(nextType));
        setHeadersText("{}\n");
        setEditingRecipientId(null);
    };

    const removeRecipient = (id: string) => {
        onChange(value.filter((item) => item.id !== id));
    };

    const toggleRecipient = (id: string, enabled: boolean) => {
        onChange(value.map((item) => (item.id === id ? { ...item, enabled } : item)));
    };

    return (
        <div className="space-y-4 rounded-lg border border-border p-4 bg-background/40">
            <div>
                <p className="text-sm font-mono text-foreground">通知接收者</p>
                <p className="text-xs font-mono text-muted-foreground mt-1">
                    统一维护所有接收者。可选择通道类型，后续可扩展更多通知通道。
                </p>
            </div>

            {channelDisabled && (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs font-mono text-muted-foreground bg-muted/20">
                    当前没有启用的通知通道，请先在上方启用至少一个通道，再添加接收者。
                </div>
            )}

            {value.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs font-mono text-muted-foreground">
                    暂无接收者。
                </div>
            ) : (
                <div className="space-y-2">
                    {value.map((item) => (
                        <div key={item.id} className="rounded-md border border-border bg-card px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-mono text-foreground truncate">{item.name}</p>
                                    <p className="text-xs font-mono text-muted-foreground mt-1 break-all">
                                        {item.type}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => editRecipient(item)}
                                        className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                                        title="修改接收者"
                                    >
                                        <Pencil size={14} />
                                    </button>
                                    <Switch
                                        checked={item.enabled}
                                        onCheckedChange={(checked) => toggleRecipient(item.id, checked)}
                                    />
                                    <button
                                        onClick={() => removeRecipient(item.id)}
                                        className="p-2 rounded-md hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
                                        title="删除接收者"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="space-y-3 border-t border-border pt-4">
                <div className="grid gap-3 md:grid-cols-2">
                    <div>
                        <label className="text-xs font-mono text-muted-foreground block mb-1">名称</label>
                        <input
                            value={draft.name}
                            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                            placeholder="例如：运维群 Webhook"
                            disabled={channelDisabled}
                            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-mono text-muted-foreground block mb-1">通道类型</label>
                        <select
                            value={draft.type}
                            onChange={(e) => {
                                const nextType = e.target.value as NotificationChannelType;
                                setDraft((prev) => ({
                                    ...createEmptyRecipient(nextType),
                                    id: prev.id,
                                    name: prev.name,
                                    enabled: prev.enabled,
                                }));
                                setHeadersText("{}\n");
                            }}
                            disabled={channelDisabled || typeOptions.length === 0}
                            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                        >
                            {typeOptions.map((item) => (
                                <option key={item.type} value={item.type}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-mono text-muted-foreground block mb-1">
                        {currentDefinition?.fields[0]?.label || "目标"}
                    </label>
                    <input
                        value={draft.target}
                        onChange={(e) => setDraft((prev) => ({ ...prev, target: e.target.value }))}
                        placeholder={draft.type === "email" ? "name@example.com" : "https://example.com/webhook?title={{title}}"}
                        disabled={channelDisabled}
                        className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                    />
                </div>

                {draft.type === "webhook" && (
                    <>
                        <div>
                            <label className="text-xs font-mono text-muted-foreground block mb-1">HTTP Method</label>
                            <select
                                value={draft.method || "POST"}
                                onChange={(e) =>
                                    setDraft((prev) => ({ ...prev, method: e.target.value }))
                                }
                                disabled={channelDisabled}
                                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                            >
                                {HTTP_METHODS.map((method) => (
                                    <option key={method} value={method}>
                                        {method}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-mono text-muted-foreground block mb-1">签名/密钥</label>
                            <input
                                value={draft.secret || ""}
                                onChange={(e) => setDraft((prev) => ({ ...prev, secret: e.target.value }))}
                                placeholder="可选"
                                disabled={channelDisabled}
                                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-mono text-muted-foreground block mb-1">
                                请求头(JSON，支持 <code>{"{{title}}"}</code> / <code>{"{{content}}"}</code>)
                            </label>
                            <Textarea
                                value={headersText}
                                onChange={(e) => {
                                    const text = e.target.value;
                                    setHeadersText(text);
                                    try {
                                        setDraft((prev) => ({ ...prev, headers: JSON.parse(text || "{}") }));
                                    } catch {
                                        // 保留原值
                                    }
                                }}
                                disabled={channelDisabled}
                                className="font-mono text-xs min-h-24"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-mono text-muted-foreground block mb-1">
                                请求体模板（支持 <code>{"{{title}}"}</code> / <code>{"{{content}}"}</code>）
                            </label>
                            <Textarea
                                value={draft.body_template || ""}
                                onChange={(e) =>
                                    setDraft((prev) => ({ ...prev, body_template: e.target.value }))
                                }
                                placeholder={'{"title":"{{title}}","content":"{{content}}"}'}
                                disabled={channelDisabled}
                                className="font-mono text-xs min-h-28"
                            />
                            <p className="mt-1 text-[11px] font-mono text-muted-foreground">
                                如果上面选择的是 `GET` / `HEAD`，通常不建议填写请求体。
                            </p>
                        </div>
                    </>
                )}

                <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                    <div>
                        <p className="text-sm font-mono text-foreground">启用此接收者</p>
                        <p className="text-[11px] font-mono text-muted-foreground">停用后不会出现在 Flow 和系统事件选择中</p>
                    </div>
                    <Switch
                        checked={draft.enabled}
                        onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, enabled: checked }))}
                        disabled={channelDisabled}
                    />
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={saveRecipient}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono hover:opacity-90 disabled:opacity-50"
                        disabled={channelDisabled || !draft.name.trim() || !draft.target.trim() || typeOptions.length === 0}
                    >
                        <Plus size={14} />
                        {editingRecipientId ? "保存修改" : "添加接收者"}
                    </button>
                    {editingRecipientId && (
                        <button
                            onClick={cancelEditing}
                            className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-mono hover:bg-secondary/80"
                        >
                            取消
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
