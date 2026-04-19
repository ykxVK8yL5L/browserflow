import { useEffect, useMemo, useState } from "react";
import { Loader2, Play, Plus, Trash2 } from "lucide-react";
import type { Flow } from "@/lib/flowStore";
import type { Identity } from "@/lib/identityStore";
import { Switch } from "@/components/ui/switch";
import {
    createSchedule,
    deleteSchedule,
    getSchedules,
    runScheduleNow,
    toggleSchedule,
    updateSchedule,
    type Schedule,
    type ScheduleTriggerType,
} from "@/lib/scheduleApi";

interface Props {
    open: boolean;
    flow: Flow | null;
    identities: Identity[];
    onClose: () => void;
    onChanged?: (flowId: string, schedules: Schedule[]) => void;
}

const typeOptions: { label: string; value: ScheduleTriggerType }[] = [
    { label: "Cron", value: "cron" },
    { label: "Interval", value: "interval" },
    { label: "Once", value: "once" },
];

function formatDateTime(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
}

const emptyForm = {
    name: "",
    trigger_type: "cron" as ScheduleTriggerType,
    cron_expression: "0 9 * * *",
    interval_seconds: 3600,
    run_at: "",
    identity_id: "",
    enabled: false,
};

export default function ScheduleDialog({ open, flow, identities, onClose, onChanged }: Props) {
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [runningId, setRunningId] = useState<string | null>(null);
    const [togglingAll, setTogglingAll] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState<string | null>(null);
    const title = useMemo(() => (flow ? `计划任务 · ${flow.name}` : "计划任务"), [flow]);
    const enabledCount = schedules.filter((item) => item.enabled).length;
    const hasSchedules = schedules.length > 0;
    const allEnabled = hasSchedules && enabledCount === schedules.length;

    const loadSchedules = async () => {
        if (!flow) return;
        setLoading(true);
        try {
            const data = await getSchedules(flow.id);
            setSchedules(data);
            onChanged?.(flow.id, data);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open && flow) {
            loadSchedules();
        }
    }, [open, flow?.id]);

    if (!open || !flow) return null;

    const resetForm = () => {
        setForm({ ...emptyForm, identity_id: flow.identityId || "" });
        setEditingId(null);
    };

    const handleSave = async () => {
        if (!form.name.trim() || saving) return;
        setSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                flow_id: flow.id,
                identity_id: form.identity_id || undefined,
                enabled: form.enabled,
                trigger_type: form.trigger_type,
                cron_expression: form.trigger_type === "cron" ? form.cron_expression.trim() : undefined,
                interval_seconds: form.trigger_type === "interval" ? Number(form.interval_seconds) : undefined,
                run_at: form.trigger_type === "once" && form.run_at ? new Date(form.run_at).toISOString() : undefined,
            };

            if (editingId) {
                await updateSchedule(editingId, payload);
            } else {
                await createSchedule(payload);
            }
            resetForm();
            await loadSchedules();
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (schedule: Schedule) => {
        setEditingId(schedule.id);
        setForm({
            name: schedule.name,
            trigger_type: schedule.trigger_type,
            cron_expression: schedule.cron_expression || "0 9 * * *",
            interval_seconds: schedule.interval_seconds || 3600,
            run_at: schedule.run_at ? new Date(schedule.run_at).toISOString().slice(0, 16) : "",
            identity_id: schedule.identity_id || "",
            enabled: schedule.enabled,
        });
    };

    const handleToggle = async (schedule: Schedule) => {
        const updated = await toggleSchedule(schedule.id, !schedule.enabled);
        const next = schedules.map((item) => (item.id === updated.id ? updated : item));
        setSchedules(next);
        onChanged?.(flow.id, next);
    };

    const handleRunNow = async (scheduleId: string) => {
        setRunningId(scheduleId);
        try {
            await runScheduleNow(scheduleId);
            await loadSchedules();
        } finally {
            setRunningId(null);
        }
    };

    const handleDelete = async (scheduleId: string) => {
        await deleteSchedule(scheduleId);
        await loadSchedules();
    };

    const handleToggleAll = async (enabled: boolean) => {
        if (!hasSchedules || togglingAll) return;
        setTogglingAll(true);
        try {
            const updated = await Promise.all(
                schedules.map((schedule) =>
                    schedule.enabled === enabled
                        ? Promise.resolve(schedule)
                        : toggleSchedule(schedule.id, enabled)
                )
            );
            setSchedules(updated);
            onChanged?.(flow.id, updated);
        } finally {
            setTogglingAll(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-lg p-6 w-full max-w-4xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-mono font-bold text-sm text-foreground">{title}</h3>
                    <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground">×</button>
                </div>

                <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
                    <div className="space-y-3 rounded-lg border border-border p-4 bg-background/60">
                        <div>
                            <label className="text-xs font-mono text-muted-foreground block mb-1">任务名称</label>
                            <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono" placeholder="例如：每日巡检" />
                        </div>
                        <div>
                            <label className="text-xs font-mono text-muted-foreground block mb-1">类型</label>
                            <select value={form.trigger_type} onChange={(e) => setForm((prev) => ({ ...prev, trigger_type: e.target.value as ScheduleTriggerType }))} className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono">
                                {typeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>

                        {form.trigger_type === "cron" && (
                            <div>
                                <label className="text-xs font-mono text-muted-foreground block mb-1">Cron 表达式</label>
                                <input value={form.cron_expression} onChange={(e) => setForm((prev) => ({ ...prev, cron_expression: e.target.value }))} className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono" placeholder="0 9 * * *" />
                            </div>
                        )}

                        {form.trigger_type === "interval" && (
                            <div>
                                <label className="text-xs font-mono text-muted-foreground block mb-1">间隔秒数</label>
                                <input type="number" min={1} value={form.interval_seconds} onChange={(e) => setForm((prev) => ({ ...prev, interval_seconds: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono" />
                            </div>
                        )}

                        {form.trigger_type === "once" && (
                            <div>
                                <label className="text-xs font-mono text-muted-foreground block mb-1">执行时间</label>
                                <input type="datetime-local" value={form.run_at} onChange={(e) => setForm((prev) => ({ ...prev, run_at: e.target.value }))} className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono" />
                            </div>
                        )}

                        <div>
                            <label className="text-xs font-mono text-muted-foreground block mb-1">Identity</label>
                            <select value={form.identity_id} onChange={(e) => setForm((prev) => ({ ...prev, identity_id: e.target.value }))} className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono">
                                <option value="">默认沿用 Flow 设置</option>
                                {identities.map((identity) => (
                                    <option key={identity.id} value={identity.id}>{identity.name} ({identity.type})</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                            <div>
                                <p className="text-sm font-mono text-foreground">创建后立即启用</p>
                                <p className="text-[11px] font-mono text-muted-foreground">默认关闭，需要时手动打开</p>
                            </div>
                            <Switch
                                checked={form.enabled}
                                onCheckedChange={(checked) =>
                                    setForm((prev) => ({ ...prev, enabled: checked }))
                                }
                            />
                        </div>

                        <div className="flex gap-2 pt-2">
                            <button onClick={handleSave} disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono hover:opacity-90 disabled:opacity-60">
                                {saving && <Loader2 size={14} className="animate-spin" />}
                                {editingId ? "保存修改" : "新增任务"}
                            </button>
                            {editingId && (
                                <button onClick={resetForm} className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-mono">取消</button>
                            )}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-mono text-foreground">当前任务</p>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-muted-foreground">总开关</span>
                                    <Switch
                                        checked={allEnabled}
                                        disabled={!hasSchedules || togglingAll}
                                        onCheckedChange={handleToggleAll}
                                    />
                                </div>
                                <button onClick={loadSchedules} className="text-xs font-mono text-muted-foreground hover:text-foreground">刷新</button>
                            </div>
                        </div>

                        <p className="text-[11px] font-mono text-muted-foreground">
                            {hasSchedules ? `已启用 ${enabledCount}/${schedules.length} 个任务` : "暂无可切换的计划任务"}
                        </p>

                        {loading ? (
                            <div className="rounded-lg border border-border p-6 text-center text-sm font-mono text-muted-foreground">加载中...</div>
                        ) : schedules.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm font-mono text-muted-foreground">
                                暂无计划任务，先创建一个。
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {schedules.map((schedule) => (
                                    <div key={schedule.id} className="rounded-lg border border-border p-4 bg-card">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="font-mono text-sm font-semibold text-foreground">{schedule.name}</p>
                                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${schedule.enabled ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{schedule.enabled ? "已启用" : "已关闭"}</span>
                                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-secondary text-secondary-foreground">{schedule.trigger_type}</span>
                                                </div>
                                                <div className="mt-2 space-y-1 text-xs font-mono text-muted-foreground">
                                                    {schedule.cron_expression && <p>Cron: {schedule.cron_expression}</p>}
                                                    {schedule.interval_seconds && <p>每 {schedule.interval_seconds} 秒</p>}
                                                    {schedule.run_at && <p>执行时间: {formatDateTime(schedule.run_at)}</p>}
                                                    <p>上次执行: {formatDateTime(schedule.last_run_at)}</p>
                                                    <p>下次执行: {formatDateTime(schedule.next_run_at)}</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0">
                                                <button onClick={() => handleRunNow(schedule.id)} className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground" title="立即执行" disabled={runningId === schedule.id}>
                                                    {runningId === schedule.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                                </button>
                                                <button onClick={() => startEdit(schedule)} className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground" title="编辑">
                                                    <Plus size={14} className="rotate-45" />
                                                </button>
                                                <button onClick={() => handleToggle(schedule)} className={`px-2 py-1 rounded-md text-xs font-mono ${schedule.enabled ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"}`}>
                                                    {schedule.enabled ? "关闭" : "启用"}
                                                </button>
                                                <button onClick={() => handleDelete(schedule.id)} className="p-2 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive" title="删除">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
