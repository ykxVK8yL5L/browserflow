import {
    Bell,
    Download,
    Loader2,
    Upload,
    X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import SystemNotificationRecipientsEditor from "@/components/flow/SystemNotificationRecipientsEditor";
import SystemNotificationRulesEditor from "@/components/flow/SystemNotificationRulesEditor";
import UserAgentManager from "@/components/flow/UserAgentManager";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type {
    NotificationChannelConfig,
    NotificationChannelDefinition,
    NotificationEvent,
    NotificationRecipient,
    NotificationTestSendResponse,
    SystemNotificationEvent,
    SystemNotificationRule,
} from "@/lib/notificationApi";

interface PlatformSettingsProps {
    open: boolean;
    onClose: () => void;
    isAdmin: boolean;
    registrationEnabled: boolean;
    passkeyLoginEnabled: boolean;
    onRegistrationEnabledChange: (checked: boolean) => void;
    onPasskeyLoginEnabledChange: (checked: boolean) => void;
    notificationChannels: NotificationChannelConfig[];
    notificationDefinitions: NotificationChannelDefinition[];
    notificationRecipients: NotificationRecipient[];
    notificationEvents: Array<{ value: NotificationEvent; label: string }>;
    systemNotificationEvents: Array<{ value: SystemNotificationEvent; label: string }>;
    systemNotificationRules: SystemNotificationRule[];
    availableNotificationRecipients: NotificationRecipient[];
    enabledChannelTypes: NotificationChannelConfig["channel_type"][];
    testMessageTitle: string;
    testMessageContent: string;
    testSendToAll: boolean;
    testRecipientIds: string[];
    pendingTestRecipientId: string;
    testSending: boolean;
    testResultMessage: string;
    testResult: NotificationTestSendResponse | null;
    backupLoading: boolean;
    restoreLoading: boolean;
    uaOpen: boolean;
    onUaOpenChange: (open: boolean) => void;
    onNotificationChannelToggle: (
        channelType: NotificationChannelConfig["channel_type"],
        enabled: boolean
    ) => void;
    onNotificationChannelDraftChange: (
        channelType: NotificationChannelConfig["channel_type"],
        config: Record<string, unknown>
    ) => void;
    onNotificationChannelDraftSave: (
        channelType: NotificationChannelConfig["channel_type"],
        config: Record<string, unknown>
    ) => void;
    onNotificationRecipientsChange: (next: NotificationRecipient[]) => void;
    onSystemNotificationRulesChange: (next: SystemNotificationRule[]) => void;
    onTestMessageTitleChange: (value: string) => void;
    onTestMessageContentChange: (value: string) => void;
    onTestSendToAllChange: (checked: boolean) => void;
    onPendingTestRecipientChange: (value: string) => void;
    onAddTestRecipient: () => void;
    onToggleTestRecipient: (recipientId: string, checked: boolean) => void;
    onSendNotificationTest: () => void;
    onUserBackupDownload: () => void;
    onSystemBackupDownload: () => void;
    onRestoreUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

type PlatformTab = "auth" | "notifications" | "tools";

const PlatformSettings = ({
    open,
    onClose,
    isAdmin,
    registrationEnabled,
    passkeyLoginEnabled,
    onRegistrationEnabledChange,
    onPasskeyLoginEnabledChange,
    notificationChannels,
    notificationDefinitions,
    notificationRecipients,
    notificationEvents,
    systemNotificationEvents,
    systemNotificationRules,
    availableNotificationRecipients,
    enabledChannelTypes,
    testMessageTitle,
    testMessageContent,
    testSendToAll,
    testRecipientIds,
    pendingTestRecipientId,
    testSending,
    testResultMessage,
    testResult,
    backupLoading,
    restoreLoading,
    uaOpen,
    onUaOpenChange,
    onNotificationChannelToggle,
    onNotificationChannelDraftChange,
    onNotificationChannelDraftSave,
    onNotificationRecipientsChange,
    onSystemNotificationRulesChange,
    onTestMessageTitleChange,
    onTestMessageContentChange,
    onTestSendToAllChange,
    onPendingTestRecipientChange,
    onAddTestRecipient,
    onToggleTestRecipient,
    onSendNotificationTest,
    onUserBackupDownload,
    onSystemBackupDownload,
    onRestoreUpload,
}: PlatformSettingsProps) => {
    const [activeTab, setActiveTab] = useState<PlatformTab>("auth");

    useEffect(() => {
        if (open) {
            setActiveTab(isAdmin ? "auth" : "tools");
        }
    }, [open, isAdmin]);

    if (!open) return null;

    const selectedTestRecipients = availableNotificationRecipients.filter((recipient) =>
        testRecipientIds.includes(recipient.id)
    );

    const selectableTestRecipients = availableNotificationRecipients.filter(
        (recipient) => !testRecipientIds.includes(recipient.id)
    );

    const groupedSelectedTestRecipients = selectedTestRecipients.reduce<Record<string, NotificationRecipient[]>>(
        (acc, recipient) => {
            if (!acc[recipient.type]) acc[recipient.type] = [];
            acc[recipient.type].push(recipient);
            return acc;
        },
        {}
    );

    return (
        <>
            <div
                className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <div
                    className="bg-card border border-border rounded-lg w-full max-w-4xl h-[min(85vh,760px)] flex flex-col overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
                        <h3 className="font-mono font-bold text-sm text-foreground">
                            Platform Settings
                        </h3>
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-secondary text-muted-foreground"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
                        <div className={`grid w-full rounded-md bg-muted p-1 font-mono shrink-0 ${isAdmin ? "grid-cols-3" : "grid-cols-1"}`}>
                            {[
                                ...(isAdmin
                                    ? [
                                        { id: "auth", label: "认证" },
                                        { id: "notifications", label: "通知" },
                                    ]
                                    : []),
                                { id: "tools", label: "工具" },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id as PlatformTab)}
                                    className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${activeTab === tab.id
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground"
                                        }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {activeTab === "auth" && (
                            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
                                <div className="rounded-lg border border-border p-4 space-y-4">
                                    <div>
                                        <p className="text-sm font-mono text-foreground">平台认证设置</p>
                                        <p className="text-xs font-mono text-muted-foreground mt-1">
                                            这里控制整个系统的注册与登录能力。个人账号安全设置请使用右上角的安全入口。
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <p className="text-sm font-mono text-foreground">Registration</p>
                                            <p className="text-xs font-mono text-muted-foreground">
                                                Allow new users to register
                                            </p>
                                        </div>
                                        <Switch
                                            checked={registrationEnabled}
                                            onCheckedChange={onRegistrationEnabledChange}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                                        <div>
                                            <p className="text-sm font-mono text-foreground">Passkey Login</p>
                                            <p className="text-xs font-mono text-muted-foreground">
                                                Allow users to login with Passkey
                                            </p>
                                        </div>
                                        <Switch
                                            checked={passkeyLoginEnabled}
                                            onCheckedChange={onPasskeyLoginEnabledChange}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === "notifications" && (
                            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
                                <div className="rounded-lg border border-border p-4 space-y-4">
                                    <div className="flex items-center gap-2">
                                        <Bell size={14} className="text-muted-foreground" />
                                        <div>
                                            <p className="text-sm font-mono text-foreground">通知设置</p>
                                            <p className="text-xs font-mono text-muted-foreground">
                                                先启用通知通道，再统一维护接收者与系统事件通知规则。
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid gap-3 lg:grid-cols-2">
                                        {notificationChannels.map((channel) => (
                                            <div key={channel.channel_type} className="rounded-md border border-border p-3 space-y-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-mono text-foreground">{channel.display_name}</p>
                                                        <p className="text-xs font-mono text-muted-foreground">类型：{channel.channel_type}</p>
                                                    </div>
                                                    <Switch
                                                        checked={channel.enabled}
                                                        onCheckedChange={(checked) =>
                                                            onNotificationChannelToggle(channel.channel_type, checked)
                                                        }
                                                    />
                                                </div>
                                                {channel.channel_type === "email" && (
                                                    <>
                                                        <input
                                                            value={String(channel.config.smtp_from || "")}
                                                            onChange={(e) =>
                                                                onNotificationChannelDraftChange(channel.channel_type, {
                                                                    ...channel.config,
                                                                    smtp_from: e.target.value,
                                                                })
                                                            }
                                                            placeholder="默认发件人显示名，可选"
                                                            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                                                        />
                                                        <button
                                                            onClick={() =>
                                                                onNotificationChannelDraftSave(channel.channel_type, channel.config)
                                                            }
                                                            className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono hover:bg-secondary/80"
                                                        >
                                                            保存邮件配置
                                                        </button>
                                                    </>
                                                )}
                                                {channel.channel_type === "webhook" && (
                                                    <>
                                                        <div className="space-y-1">
                                                            <label className="text-xs font-mono text-muted-foreground block">
                                                                请求超时秒数
                                                            </label>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                value={String(channel.config.timeout_seconds || 10)}
                                                                onChange={(e) =>
                                                                    onNotificationChannelDraftChange(channel.channel_type, {
                                                                        ...channel.config,
                                                                        timeout_seconds: Number(e.target.value) || 10,
                                                                    })
                                                                }
                                                                placeholder="请求超时秒数"
                                                                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                                                            />
                                                            <p className="text-[11px] font-mono text-muted-foreground">
                                                                webhook 请求最多等待多少秒，超时后会判定发送失败。
                                                            </p>
                                                        </div>
                                                        <button
                                                            onClick={() =>
                                                                onNotificationChannelDraftSave(channel.channel_type, channel.config)
                                                            }
                                                            className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono hover:bg-secondary/80"
                                                        >
                                                            保存 Webhook 配置
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    <SystemNotificationRulesEditor
                                        value={systemNotificationRules}
                                        onChange={onSystemNotificationRulesChange}
                                        recipients={availableNotificationRecipients}
                                        eventOptions={systemNotificationEvents}
                                    />

                                    <SystemNotificationRecipientsEditor
                                        value={notificationRecipients}
                                        onChange={onNotificationRecipientsChange}
                                        definitions={notificationDefinitions}
                                        enabledChannelTypes={enabledChannelTypes}
                                    />

                                    <div className="space-y-4 rounded-lg border border-border p-4 bg-background/40">
                                        <div>
                                            <p className="text-sm font-mono text-foreground">测试发送</p>
                                            <p className="text-xs font-mono text-muted-foreground mt-1">
                                                可向指定接收者或全部可用接收者发送一条测试消息，用于验证通知链路。
                                            </p>
                                        </div>

                                        <div className="grid gap-3 md:grid-cols-2">
                                            <div>
                                                <label className="text-xs font-mono text-muted-foreground block mb-1">标题</label>
                                                <input
                                                    value={testMessageTitle}
                                                    onChange={(e) => onTestMessageTitleChange(e.target.value)}
                                                    placeholder="测试通知标题"
                                                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                                                />
                                            </div>
                                            <div className="rounded-md border border-border bg-background px-3 py-2 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-mono text-foreground">发送给全部可用接收者</p>
                                                    <p className="text-[11px] font-mono text-muted-foreground">关闭后可在下方手动选择指定接收者</p>
                                                </div>
                                                <Switch checked={testSendToAll} onCheckedChange={onTestSendToAllChange} />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-xs font-mono text-muted-foreground block mb-1">内容</label>
                                            <textarea
                                                value={testMessageContent}
                                                onChange={(e) => onTestMessageContentChange(e.target.value)}
                                                placeholder="输入测试消息内容"
                                                className="w-full min-h-28 px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
                                            />
                                        </div>

                                        {!testSendToAll && (
                                            <div>
                                                <p className="text-xs font-mono text-muted-foreground mb-2">指定接收者</p>
                                                {availableNotificationRecipients.length === 0 ? (
                                                    <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs font-mono text-muted-foreground">
                                                        暂无可用接收者，请先启用通道并添加接收者。
                                                    </div>
                                                ) : (
                                                    <div className="space-y-3">
                                                        {selectableTestRecipients.length > 0 && (
                                                            <div className="flex gap-2">
                                                                <select
                                                                    value={pendingTestRecipientId}
                                                                    onChange={(e) => onPendingTestRecipientChange(e.target.value)}
                                                                    className="flex-1 px-3 py-2 rounded-md bg-background border border-border text-xs font-mono"
                                                                >
                                                                    <option value="">选择接收者后添加</option>
                                                                    {selectableTestRecipients.map((recipient) => (
                                                                        <option key={recipient.id} value={recipient.id}>
                                                                            {recipient.name} · {recipient.type}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                                <button
                                                                    type="button"
                                                                    onClick={onAddTestRecipient}
                                                                    disabled={!pendingTestRecipientId}
                                                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono disabled:opacity-50 disabled:cursor-not-allowed hover:bg-secondary/80"
                                                                >
                                                                    添加
                                                                </button>
                                                            </div>
                                                        )}

                                                        {testRecipientIds.length === 0 ? (
                                                            <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs font-mono text-muted-foreground">
                                                                暂未选择接收者。
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-3">
                                                                {Object.entries(groupedSelectedTestRecipients).map(([channelType, recipients]) => (
                                                                    <div key={channelType} className="space-y-2">
                                                                        <p className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                                                                            {channelType}
                                                                        </p>
                                                                        <div className="flex flex-wrap gap-2">
                                                                            {recipients.map((recipient) => (
                                                                                <div
                                                                                    key={recipient.id}
                                                                                    className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono text-foreground"
                                                                                >
                                                                                    <span className="max-w-[240px] truncate">{recipient.name}</span>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => onToggleTestRecipient(recipient.id, false)}
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
                                        )}

                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={onSendNotificationTest}
                                                disabled={
                                                    testSending ||
                                                    !testMessageTitle.trim() ||
                                                    !testMessageContent.trim() ||
                                                    (!testSendToAll && testRecipientIds.length === 0)
                                                }
                                                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-mono hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
                                            >
                                                {testSending && <Loader2 size={14} className="animate-spin" />}
                                                发送测试消息
                                            </button>
                                            {testResultMessage && (
                                                <p className="text-xs font-mono text-muted-foreground">{testResultMessage}</p>
                                            )}
                                        </div>

                                        {testResult && (
                                            <div className="rounded-md border border-border bg-card px-3 py-3 space-y-2">
                                                <p className="text-xs font-mono text-muted-foreground">
                                                    目标 {testResult.target_count} · 成功 {testResult.success_count} · 失败 {testResult.failed_count} · 跳过 {testResult.skipped_count}
                                                </p>
                                                {testResult.details.length > 0 && (
                                                    <div className="space-y-2">
                                                        {testResult.details.map((item, index) => (
                                                            <div
                                                                key={`${item.recipient_id || item.name || "detail"}-${index}`}
                                                                className="rounded border border-border px-3 py-2 text-xs font-mono"
                                                            >
                                                                <span className="text-foreground">{item.name || item.recipient_id || "未知接收者"}</span>
                                                                <span className="text-muted-foreground"> · {item.status}</span>
                                                                {item.reason ? (
                                                                    <p className="mt-1 text-muted-foreground break-all">{item.reason}</p>
                                                                ) : null}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === "tools" && (
                            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
                                <div className="rounded-lg border border-border p-4 space-y-3">
                                    <div>
                                        <p className="text-sm font-mono text-foreground">System Backup & Restore</p>
                                        <p className="text-xs font-mono text-muted-foreground">
                                            {isAdmin
                                                ? "管理员可导出用户备份或系统备份；系统备份会打包整个 data 目录用于全站备份"
                                                : "导出当前账号的个人数据 JSON，不暴露后台数据表结构"}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <button
                                            onClick={onUserBackupDownload}
                                            disabled={backupLoading || restoreLoading}
                                            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-mono hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
                                        >
                                            {backupLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                            下载用户备份
                                        </button>
                                        {isAdmin && (
                                            <button
                                                onClick={onSystemBackupDownload}
                                                disabled={backupLoading || restoreLoading}
                                                className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono hover:bg-secondary/80 disabled:opacity-50 inline-flex items-center gap-2"
                                            >
                                                {backupLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                                下载系统备份
                                            </button>
                                        )}
                                        <label className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono hover:bg-secondary/80 disabled:opacity-50 inline-flex items-center gap-2 cursor-pointer">
                                            {restoreLoading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                            选择备份并还原
                                            <input
                                                type="file"
                                                accept="application/zip,.zip,application/json,.json"
                                                className="hidden"
                                                onChange={onRestoreUpload}
                                                disabled={backupLoading || restoreLoading}
                                            />
                                        </label>
                                    </div>
                                    <p className="text-xs font-mono text-amber-500">
                                        {isAdmin
                                            ? "注意：用户备份只导出当前管理员自己的数据；系统备份会导出整个 data 目录。还原会按备份类型覆盖对应数据。"
                                            : "注意：普通会员下载的是个人 JSON 备份；还原仅支持同类个人备份，并会覆盖当前账号现有数据。"}
                                    </p>
                                </div>

                                <div className="rounded-lg border border-border p-4 flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-mono text-foreground">User-Agent Management</p>
                                        <p className="text-xs font-mono text-muted-foreground">
                                            Manage available User-Agent strings
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => onUaOpenChange(true)}
                                        className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono hover:bg-secondary/80 transition-colors"
                                    >
                                        Manage
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <Dialog open={uaOpen} onOpenChange={onUaOpenChange}>
                <DialogContent className="sm:max-w-[425px] bg-card border-border">
                    <DialogHeader>
                        <DialogTitle className="font-mono text-sm">User-Agent Manager</DialogTitle>
                    </DialogHeader>
                    <UserAgentManager />
                </DialogContent>
            </Dialog>
        </>
    );
};

export default PlatformSettings;
