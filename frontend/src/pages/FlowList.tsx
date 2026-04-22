import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchFlows,
  createFlowAsync,
  deleteFlowAsync,
  updateFlowAsync,
  type Flow,
} from "@/lib/flowStore";
import { fetchIdentities, type Identity } from "@/lib/identityStore";
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  ArrowRight,
  Clock3,
  LogOut,
  Settings,
  Shield,
  X,
  KeyRound,
  Loader2,
  UserCircle,
  Bell,
  Download,
  Upload,
} from "lucide-react";
import CredentialsManager from "@/components/flow/CredentialsManager";
import FlowNotificationsEditor from "@/components/flow/FlowNotificationsEditor";
import IdentityManager from "@/components/flow/IdentityManager";
import PlatformSettings from "@/components/flow/PlatformSettings";
import ScheduleDialog from "@/components/flow/ScheduleDialog";
import SecuritySettings from "@/components/security/SecuritySettings";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import {
  getAuthSettings,
  setAuthSettings,
} from "@/lib/authStore";
import {
  getNotificationSettings,
  sendNotificationTest,
  updateNotificationChannel,
  type FlowNotificationRule,
  type NotificationChannelConfig,
  type NotificationChannelDefinition,
  type NotificationEvent,
  type NotificationRecipient,
  type NotificationTestSendResponse,
  type SystemNotificationEvent,
  type SystemNotificationRule,
  updateNotificationRecipients,
  updateSystemNotificationRules,
} from "@/lib/notificationApi";
import { getSchedules, toggleSchedule, type Schedule } from "@/lib/scheduleApi";
import { downloadSystemBackup, restoreSystemBackup } from "@/lib/systemApi";
import { getTemplateSettings, updateTemplateSettings } from "@/lib/templateApi";
import { toast } from "sonner";

const FlowList = () => {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowPage, setFlowPage] = useState(1);
  const [flowPageSize, setFlowPageSize] = useState(12);
  const [flowTotal, setFlowTotal] = useState(0);
  const [flowTotalPages, setFlowTotalPages] = useState(1);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingFlow, setEditingFlow] = useState<Flow | null>(null);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string>("");
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [identitiesOpen, setIdentitiesOpen] = useState(false);
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const [securityOpen, setSecurityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uaOpen, setUaOpen] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(true); // 默认值，后续从 API 加载
  const [passkeyLoginEnabled, setPasskeyLoginEnabled] = useState(false); // Passkey 登录开关
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [scheduleFlow, setScheduleFlow] = useState<Flow | null>(null);
  const [notificationRules, setNotificationRules] = useState<FlowNotificationRule[]>([]);
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [scheduleMap, setScheduleMap] = useState<Record<string, Schedule[]>>({});
  const [notificationChannels, setNotificationChannels] = useState<NotificationChannelConfig[]>([]);
  const [notificationDefinitions, setNotificationDefinitions] = useState<NotificationChannelDefinition[]>([]);
  const [notificationEvents, setNotificationEvents] = useState<Array<{ value: NotificationEvent; label: string }>>([]);
  const [notificationRecipients, setNotificationRecipients] = useState<NotificationRecipient[]>([]);
  const [systemNotificationEvents, setSystemNotificationEvents] = useState<Array<{ value: SystemNotificationEvent; label: string }>>([]);
  const [systemNotificationRules, setSystemNotificationRules] = useState<SystemNotificationRule[]>([]);
  const [testMessageTitle, setTestMessageTitle] = useState("测试通知");
  const [testMessageContent, setTestMessageContent] = useState("这是一条来自 BrowserFlow 的测试通知。");
  const [testSendToAll, setTestSendToAll] = useState(true);
  const [testRecipientIds, setTestRecipientIds] = useState<string[]>([]);
  const [pendingTestRecipientId, setPendingTestRecipientId] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResultMessage, setTestResultMessage] = useState("");
  const [testResult, setTestResult] = useState<NotificationTestSendResponse | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [templateFeatureEnabled, setTemplateFeatureEnabled] = useState(true);
  const [templateIndexUrl, setTemplateIndexUrl] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    // 从 API 加载 Flow 列表
    fetchFlows({ page: flowPage, pageSize: flowPageSize })
      .then(async (data) => {
        setFlows(data.items);
        setFlowTotal(data.total);
        setFlowPage(data.page);
        setFlowTotalPages(data.totalPages);
        try {
          const schedules = await getSchedules();
          const grouped = schedules.reduce<Record<string, Schedule[]>>((acc, item) => {
            if (!acc[item.flow_id]) acc[item.flow_id] = [];
            acc[item.flow_id].push(item);
            return acc;
          }, {});
          setScheduleMap(grouped);
        } catch (error) {
          console.error("Failed to fetch schedules:", error);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    // 加载 Identity 列表
    fetchIdentities()
      .then(setIdentities)
      .catch(console.error);
  }, [flowPage, flowPageSize]);

  useEffect(() => {
    // 加载认证设置
    getAuthSettings().then((settings) => {
      setRegistrationEnabled(settings.registrationEnabled);
      setPasskeyLoginEnabled(settings.passkeyLoginEnabled);
    });

    if (isAdmin) {
      getNotificationSettings()
        .then((settings) => {
          setNotificationChannels(settings.channels);
          setNotificationDefinitions(settings.channel_definitions);
          setNotificationEvents(settings.event_options);
          setNotificationRecipients(settings.recipients);
          setSystemNotificationEvents(settings.system_event_options);
          setSystemNotificationRules(settings.system_rules);
        })
        .catch((error) => {
          console.error("Failed to load notification settings:", error);
        });

      getTemplateSettings()
        .then((settings) => {
          setTemplateFeatureEnabled(settings.feature_enabled);
          setTemplateIndexUrl(settings.index_url || "");
        })
        .catch((error) => {
          console.error("Failed to load template settings:", error);
        });
    }
  }, [isAdmin]);

  const handleCreate = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const newFlow = await createFlowAsync(
        name.trim(),
        description.trim(),
        selectedIdentityId,
        notificationEnabled,
        notificationRules,
      );
      if (flowPage === 1) {
        setFlows((prev) => [newFlow, ...prev].slice(0, flowPageSize));
      }
      setFlowTotal((prev) => prev + 1);
      setFlowTotalPages((prev) => Math.max(prev, Math.ceil((flowTotal + 1) / flowPageSize)));
      setName("");
      setDescription("");
      setSelectedIdentityId("");
      setNotificationEnabled(true);
      setNotificationRules([]);
      setShowCreate(false);
    } catch (error) {
      console.error("Failed to create flow:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleBackupDownload = async () => {
    if (backupLoading) return;
    setBackupLoading(true);
    try {
      await downloadSystemBackup({ scope: "current_user" });
      toast.success("用户备份已开始下载");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "用户备份失败");
    } finally {
      setBackupLoading(false);
    }
  };

  const handleSystemBackupDownload = async () => {
    if (backupLoading) return;
    setBackupLoading(true);
    try {
      await downloadSystemBackup({ scope: "system" });
      toast.success("系统备份已开始下载");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "系统备份失败");
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestoreUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || restoreLoading) return;

    const confirmed = window.confirm(
      "还原会覆盖当前账号的 Flow、执行记录、Identity、计划任务及相关文件，是否继续？"
    );
    if (!confirmed) {
      return;
    }

    setRestoreLoading(true);
    try {
      const result = await restoreSystemBackup(file);
      toast.success(result.message || "系统还原成功");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "系统还原失败");
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await deleteFlowAsync(id);
      setFlows(flows.filter((f) => f.id !== id));
      setFlowTotal((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error("Failed to delete flow:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async () => {
    if (!editingFlow || !name.trim() || saving) return;
    setSaving(true);
    try {
      const updatedFlow = await updateFlowAsync(editingFlow.id, {
        name: name.trim(),
        description: description.trim(),
        identityId: selectedIdentityId,
        notificationEnabled,
        notificationRules,
      });
      setFlows(flows.map((f) => (f.id === updatedFlow.id ? updatedFlow : f)));
      setEditingFlow(null);
      setName("");
      setDescription("");
      setSelectedIdentityId("");
      setNotificationEnabled(true);
      setNotificationRules([]);
    } catch (error) {
      console.error("Failed to update flow:", error);
    } finally {
      setSaving(false);
    }
  };

  const closeDialog = () => {
    setShowCreate(false);
    setEditingFlow(null);
    setName("");
    setDescription("");
    setSelectedIdentityId("");
    setNotificationEnabled(true);
    setNotificationRules([]);
  };

  const openEdit = (flow: Flow) => {
    setEditingFlow(flow);
    setName(flow.name);
    setDescription(flow.description || "");
    setSelectedIdentityId(flow.identityId || "");
    setNotificationEnabled(flow.notificationEnabled ?? true);
    setNotificationRules(flow.notificationRules || []);
  };

  const showDialog = showCreate || editingFlow !== null;

  const enabledNotificationChannels = notificationChannels
    .filter((item) => item.enabled)
    .map((item) => item.channel_type);

  const availableNotificationRecipients = notificationRecipients.filter(
    (item) => item.enabled && enabledNotificationChannels.includes(item.type)
  );

  const handleSchedulesChanged = (flowId: string, schedules: Schedule[]) => {
    setScheduleMap((prev) => ({ ...prev, [flowId]: schedules }));
  };

  const getFlowScheduleSummary = (flowId: string) => {
    const items = scheduleMap[flowId] || [];
    const enabled = items.filter((item) => item.enabled);
    const lastRunAt = items
      .map((item) => item.last_run_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    const nextRunAt = enabled
      .map((item) => item.next_run_at)
      .filter(Boolean)
      .sort()
      .at(0);
    return {
      total: items.length,
      enabledCount: enabled.length,
      lastRunAt,
      nextRunAt,
    };
  };

  const formatScheduleTime = (value?: string) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  };

  const getFlowScheduleStatusText = (flowId: string) => {
    const summary = getFlowScheduleSummary(flowId);
    if (summary.total === 0) return "未配置";
    if (summary.enabledCount === 0) return "已关闭";
    if (summary.enabledCount === summary.total) return `已启用（${summary.total} 个）`;
    return `部分启用（${summary.enabledCount}/${summary.total}）`;
  };


  const getFlowScheduleStatus = (flowId: string) => {
    const summary = getFlowScheduleSummary(flowId);
    if (summary.total === 0) return false;
    if (summary.enabledCount === 0) return false;
    return true;
  };


  const getFlowNotificationStatusText = (flow: Flow) => {
    if (!flow.notificationEnabled) return "通知: 已关闭";
    const rules = flow.notificationRules || [];
    const enabledRules = rules.filter((item) => item.enabled);
    if (rules.length === 0) return "通知: 未配置";
    return `通知: ${enabledRules.length}/${rules.length} 已启用`;
  };

  const saveNotificationRecipients = async (recipients: NotificationRecipient[]) => {
    try {
      const updated = await updateNotificationRecipients(recipients);
      setNotificationRecipients(updated);
    } catch (error) {
      console.error("Failed to save notification recipients:", error);
    }
  };

  const saveSystemNotificationRules = async (rules: SystemNotificationRule[]) => {
    try {
      const updated = await updateSystemNotificationRules(rules);
      setSystemNotificationRules(updated);
    } catch (error) {
      console.error("Failed to save system notification rules:", error);
    }
  };

  const handleNotificationChannelToggle = async (
    channelType: NotificationChannelConfig["channel_type"],
    enabled: boolean
  ) => {
    try {
      const updated = await updateNotificationChannel(channelType, { enabled });
      setNotificationChannels((prev) =>
        prev.map((item) => (item.channel_type === updated.channel_type ? updated : item))
      );
    } catch (error) {
      console.error("Failed to update notification channel:", error);
    }
  };

  const updateNotificationChannelDraft = (
    channelType: NotificationChannelConfig["channel_type"],
    config: Record<string, unknown>
  ) => {
    setNotificationChannels((prev) =>
      prev.map((item) =>
        item.channel_type === channelType ? { ...item, config } : item
      )
    );
  };

  const saveNotificationChannelDraft = async (
    channelType: NotificationChannelConfig["channel_type"],
    config: Record<string, unknown>
  ) => {
    try {
      const updated = await updateNotificationChannel(channelType, { config });
      setNotificationChannels((prev) =>
        prev.map((item) => (item.channel_type === updated.channel_type ? updated : item))
      );
    } catch (error) {
      console.error("Failed to save notification channel config:", error);
    }
  };

  const handleToggleTestRecipient = (recipientId: string, checked: boolean) => {
    setTestRecipientIds((prev) =>
      checked ? Array.from(new Set([...prev, recipientId])) : prev.filter((id) => id !== recipientId)
    );
  };

  const addTestRecipient = () => {
    if (!pendingTestRecipientId) return;
    setTestRecipientIds((prev) => Array.from(new Set([...prev, pendingTestRecipientId])));
    setPendingTestRecipientId("");
  };

  const handleSendNotificationTest = async () => {
    if (testSending) return;
    if (!testMessageTitle.trim() || !testMessageContent.trim()) {
      setTestResult(null);
      setTestResultMessage("请填写测试标题和内容");
      return;
    }
    if (!testSendToAll && testRecipientIds.length === 0) {
      setTestResult(null);
      setTestResultMessage("请至少选择一个接收者");
      return;
    }

    setTestSending(true);
    setTestResultMessage("");
    try {
      const result = await sendNotificationTest({
        title: testMessageTitle.trim(),
        content: testMessageContent.trim(),
        recipient_ids: testRecipientIds,
        send_to_all: testSendToAll,
      });
      setTestResult(result);
      setTestResultMessage(
        `发送完成：成功 ${result.success_count}，失败 ${result.failed_count}，跳过 ${result.skipped_count}`
      );
    } catch (error) {
      setTestResult(null);
      setTestResultMessage(error instanceof Error ? error.message : "测试发送失败");
    } finally {
      setTestSending(false);
    }
  };

  const handleTemplateSettingsSave = async () => {
    try {
      const updated = await updateTemplateSettings({
        feature_enabled: templateFeatureEnabled,
        index_url: templateIndexUrl,
      });
      setTemplateFeatureEnabled(updated.feature_enabled);
      setTemplateIndexUrl(updated.index_url || "");
      toast.success("模板设置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模板设置保存失败");
    }
  };

  return (
    <>
      <div className="min-h-dvh bg-background">
        <header className="h-12 border-b border-border bg-card flex items-center px-4 gap-3 shrink-0">
          <Workflow size={18} className="text-primary" />
          <h1 className="font-mono font-bold text-sm text-foreground tracking-wide">
            BrowserFlow
          </h1>
          <span className="text-xs text-muted-foreground font-mono ml-1 hidden sm:inline">
            — visual browser automation
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setIdentitiesOpen(true)}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Manage Identities"
            >
              <UserCircle size={18} />
            </button>
            {/* <button
              onClick={() => setCredentialsOpen(true)}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Manage Credentials"
            >
              <KeyRound size={18} />
            </button> */}

            <button
              onClick={() => setSecurityOpen(true)}
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Security"
            >
              <Shield size={16} />
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title={isAdmin ? "Settings" : "Backup & Tools"}
            >
              <Settings size={16} />
            </button>
            <span className="text-xs text-muted-foreground font-mono ml-1 hidden sm:inline">
              {user?.username}
            </span>
            <button
              onClick={logout}
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Sign Out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-mono font-bold text-foreground">
              My Flows
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCredentialsOpen(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-card border border-border text-muted-foreground hover:text-foreground text-sm font-mono font-medium hover:bg-secondary transition-colors"
              >
                <KeyRound size={16} />
                Credentials
              </button>
              <button
                onClick={() => {
                  setShowCreate(true);
                  setEditingFlow(null);
                  setName("");
                  setDescription("");
                  setSelectedIdentityId("");
                  setNotificationRules([]);
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity"
              >
                <Plus size={16} />
                New Flow
              </button>
            </div>
          </div>

          {flows.length === 0 ? (
            <div className="text-center py-20">
              <Workflow
                size={48}
                className="mx-auto text-muted-foreground mb-4"
              />
              <p className="text-muted-foreground font-mono text-sm">
                No flows yet. Create your first one!
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {flows.map((flow) => (
                <div
                  key={flow.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors gap-4"
                >
                  {(() => {
                    const summary = getFlowScheduleSummary(flow.id);
                    return (
                      <div className="flex-1 min-w-0 mr-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-mono font-semibold text-sm text-foreground truncate">
                            {flow.name}
                          </h3>
                          <p className="hidden lg:block shrink-0 text-xs text-muted-foreground/60 font-mono">
                            Updated {new Date(flow.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        {flow.description && (
                          <p className="text-xs text-muted-foreground font-mono mt-1 truncate">
                            {flow.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground/60 font-mono mt-1 lg:hidden">
                          Updated{" "}
                          {new Date(flow.updatedAt).toLocaleDateString()}
                        </p>

                        {getFlowScheduleStatus(flow.id) && (
                          <div className="mt-2 grid gap-1 text-[11px] font-mono text-muted-foreground">
                            <p className="truncate">计划任务: {getFlowScheduleStatusText(flow.id)}</p>
                            <div className="flex items-center justify-between gap-4">
                              <p className="truncate">上次执行: {formatScheduleTime(summary.lastRunAt)}</p>
                              <p className="truncate text-right">下次执行: {formatScheduleTime(summary.nextRunAt)}</p>
                            </div>
                            <p className="truncate">{getFlowNotificationStatusText(flow)}</p>
                          </div>
                        )}

                      </div>
                    );
                  })()}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setScheduleFlow(flow)}
                      className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="计划任务"
                    >
                      <Clock3 size={14} />
                    </button>
                    <button
                      onClick={() => openEdit(flow)}
                      className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(flow.id)}
                      className="p-2 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      onClick={() => navigate(`/flow/${flow.id}`)}
                      className="p-2 rounded-md hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
                      title="Open"
                    >
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs font-mono text-muted-foreground">
              共 {flowTotal} 个 Flow · 第 {flowPage}/{flowTotalPages} 页
            </p>
            <div className="flex items-center gap-2">
              <select
                value={String(flowPageSize)}
                onChange={(e) => {
                  setFlowPageSize(Number(e.target.value) || 12);
                  setFlowPage(1);
                }}
                className="px-3 py-2 rounded-md bg-background border border-border text-xs font-mono"
              >
                {[12, 24, 48].map((size) => (
                  <option key={size} value={size}>
                    每页 {size} 条
                  </option>
                ))}
              </select>
              <button
                onClick={() => setFlowPage((prev) => Math.max(1, prev - 1))}
                disabled={flowPage <= 1}
                className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono hover:bg-secondary/80 disabled:opacity-50"
              >
                上一页
              </button>
              <button
                onClick={() => setFlowPage((prev) => Math.min(flowTotalPages, prev + 1))}
                disabled={flowPage >= flowTotalPages}
                className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono hover:bg-secondary/80 disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        </main>

        {/* Create / Edit Dialog */}
        {showDialog && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={closeDialog}
          >
            <div
              className="bg-card border border-border rounded-lg p-6 w-full max-w-3xl max-h-[85vh] min-h-[70vh] overflow-auto flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-mono font-bold text-sm text-foreground">
                  {editingFlow ? "Edit Flow" : "New Flow"}
                </h3>
                <button
                  onClick={closeDialog}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-mono text-muted-foreground block mb-1">
                    Name
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Automation"
                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    autoFocus
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      (editingFlow ? handleEditSave() : handleCreate())
                    }
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground block mb-1">
                    Description
                  </label>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      (editingFlow ? handleEditSave() : handleCreate())
                    }
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground block mb-1">
                    Identity (Browser Environment)
                  </label>
                  <select
                    value={selectedIdentityId}
                    onChange={(e) => setSelectedIdentityId(e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">None (Pure Environment)</option>
                    {identities.map((id) => (
                      <option key={id.id} value={id.id}>
                        {id.name} ({id.type})
                      </option>
                    ))}
                  </select>
                </div>
                <FlowNotificationsEditor
                  value={notificationRules}
                  enabled={notificationEnabled}
                  onEnabledChange={setNotificationEnabled}
                  onChange={setNotificationRules}
                  recipients={availableNotificationRecipients}
                  eventOptions={notificationEvents}
                />
                <button
                  onClick={editingFlow ? handleEditSave : handleCreate}
                  className="w-full mt-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity"
                >
                  {editingFlow ? "Save Changes" : "Create Flow"}
                </button>
              </div>
            </div>
          </div>
        )}
        <CredentialsManager
          open={credentialsOpen}
          onClose={() => setCredentialsOpen(false)}
        />
        <IdentityManager
          open={identitiesOpen}
          onClose={() => setIdentitiesOpen(false)}
        />
        <SecuritySettings
          open={securityOpen}
          onClose={() => setSecurityOpen(false)}
        />
        <ScheduleDialog
          open={scheduleFlow !== null}
          flow={scheduleFlow}
          identities={identities}
          onClose={() => setScheduleFlow(null)}
          onChanged={handleSchedulesChanged}
        />

        <PlatformSettings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          isAdmin={isAdmin}
          registrationEnabled={registrationEnabled}
          passkeyLoginEnabled={passkeyLoginEnabled}
          onRegistrationEnabledChange={(checked) => {
            setRegistrationEnabled(checked);
            void setAuthSettings({ registrationEnabled: checked });
          }}
          onPasskeyLoginEnabledChange={(checked) => {
            setPasskeyLoginEnabled(checked);
            void setAuthSettings({ passkeyLoginEnabled: checked });
          }}
          notificationChannels={notificationChannels}
          notificationDefinitions={notificationDefinitions}
          notificationRecipients={notificationRecipients}
          notificationEvents={notificationEvents}
          systemNotificationEvents={systemNotificationEvents}
          systemNotificationRules={systemNotificationRules}
          availableNotificationRecipients={availableNotificationRecipients}
          enabledChannelTypes={enabledNotificationChannels}
          testMessageTitle={testMessageTitle}
          testMessageContent={testMessageContent}
          testSendToAll={testSendToAll}
          testRecipientIds={testRecipientIds}
          pendingTestRecipientId={pendingTestRecipientId}
          testSending={testSending}
          testResultMessage={testResultMessage}
          testResult={testResult}
          backupLoading={backupLoading}
          restoreLoading={restoreLoading}
          templateFeatureEnabled={templateFeatureEnabled}
          templateIndexUrl={templateIndexUrl}
          uaOpen={uaOpen}
          onUaOpenChange={setUaOpen}
          onTemplateFeatureEnabledChange={setTemplateFeatureEnabled}
          onTemplateIndexUrlChange={setTemplateIndexUrl}
          onTemplateSettingsSave={() => void handleTemplateSettingsSave()}
          onNotificationChannelToggle={handleNotificationChannelToggle}
          onNotificationChannelDraftChange={updateNotificationChannelDraft}
          onNotificationChannelDraftSave={saveNotificationChannelDraft}
          onNotificationRecipientsChange={(next) => {
            setNotificationRecipients(next);
            void saveNotificationRecipients(next);
          }}
          onSystemNotificationRulesChange={(next) => {
            setSystemNotificationRules(next);
            void saveSystemNotificationRules(next);
          }}
          onTestMessageTitleChange={setTestMessageTitle}
          onTestMessageContentChange={setTestMessageContent}
          onTestSendToAllChange={setTestSendToAll}
          onPendingTestRecipientChange={setPendingTestRecipientId}
          onAddTestRecipient={addTestRecipient}
          onToggleTestRecipient={handleToggleTestRecipient}
          onSendNotificationTest={() => void handleSendNotificationTest()}
          onUserBackupDownload={() => void handleBackupDownload()}
          onSystemBackupDownload={() => void handleSystemBackupDownload()}
          onRestoreUpload={handleRestoreUpload}
        />
      </div>
    </>
  );
};

export default FlowList;
