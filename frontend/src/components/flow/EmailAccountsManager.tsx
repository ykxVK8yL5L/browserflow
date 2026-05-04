import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Copy,
    Mail,
    Pencil,
    RefreshCw,
    ShieldCheck,
    ShieldEllipsis,
    Trash2,
    Upload,
    X,
} from "lucide-react";
import { toast } from "sonner";

import {
    deleteEmailAccounts,
    fetchEmailProviders,
    fetchEmailAccounts,
    importEmailAccounts,
    testEmailAccountReceive,
    updateEmailAccount,
    deleteEmailAccount,
    type EmailProviderDefinition,
    type EmailProviderFieldDefinition,
    type EmailAccountProvider,
    type EmailAccountRecord,
} from "@/lib/emailAccountStore";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface EmailAccountsManagerProps {
    open: boolean;
    onClose: () => void;
}

type PanelMode = "guide" | "import" | "edit";

type DeleteDialogState =
    | { open: false }
    | { open: true; mode: "single"; accountId: string; accountName: string }
    | { open: true; mode: "bulk"; ids: string[]; count: number };

const buildEditableData = (account: EmailAccountRecord) => ({
    ...account.credential_data,
    provider: account.provider,
    address: account.address,
    identifier: account.identifier,
    accountTag: account.accountTag,
    username: account.username,
    password: "",
    clientId: String(account.credential_data?.clientId || account.credential_data?.client_id || ""),
    refreshToken: "",
    accessToken: "",
});

const EmailAccountsManager = ({ open, onClose }: EmailAccountsManagerProps) => {
    const [accounts, setAccounts] = useState<EmailAccountRecord[]>([]);
    const [providers, setProviders] = useState<EmailProviderDefinition[]>([]);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [mode, setMode] = useState<PanelMode>("guide");
    const [keyword, setKeyword] = useState("");
    const [providerFilter, setProviderFilter] = useState<EmailAccountProvider | "all">("all");
    const [importProvider, setImportProvider] = useState<EmailAccountProvider>("imap");
    const [importText, setImportText] = useState("");
    const [editing, setEditing] = useState<EmailAccountRecord | null>(null);
    const [editName, setEditName] = useState("");
    const [editDescription, setEditDescription] = useState("");
    const [editData, setEditData] = useState<Record<string, any>>({});
    const [receivingTestIds, setReceivingTestIds] = useState<Set<string>>(new Set());
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({ open: false });

    const loadAccounts = useCallback(async () => {
        setLoading(true);
        try {
            const list = await fetchEmailAccounts();
            setAccounts(list);
            setSelectedIds((prev) => new Set([...prev].filter((id) => list.some((item) => item.id === id))));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "加载邮箱账号失败");
            setAccounts([]);
            setSelectedIds(new Set());
        } finally {
            setLoading(false);
        }
    }, []);

    const loadProviders = useCallback(async () => {
        try {
            const list = await fetchEmailProviders();
            setProviders(list);
            setImportProvider((current) => current || list[0]?.key || "imap");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "加载邮箱 provider 失败");
            setProviders([]);
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        void loadAccounts();
        void loadProviders();
        setMode("guide");
        setKeyword("");
        setProviderFilter("all");
        setImportText("");
        setEditing(null);
        setSelectedIds(new Set());
    }, [open, loadAccounts, loadProviders]);

    const importProviderMeta = useMemo(
        () => providers.find((item) => item.key === importProvider) || providers[0],
        [importProvider, providers],
    );

    const providerMap = useMemo(() => new Map(providers.map((item) => [item.key, item])), [providers]);

    const filteredAccounts = useMemo(() => {
        const needle = keyword.trim().toLowerCase();
        return accounts.filter((account) => {
            if (providerFilter !== "all" && account.provider !== providerFilter) {
                return false;
            }
            if (!needle) return true;
            const haystack = [
                account.name,
                account.description,
                account.provider,
                account.address,
                account.accountTag,
                account.username,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return haystack.includes(needle);
        });
    }, [accounts, keyword, providerFilter]);

    const openEdit = (account: EmailAccountRecord) => {
        setEditing(account);
        setEditName(account.name);
        setEditDescription(account.description || "");
        setEditData(buildEditableData(account));
        setMode("edit");
    };

    const selectedCount = selectedIds.size;
    const filteredIds = filteredAccounts.map((account) => account.id);
    const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
    const someFilteredSelected = filteredIds.some((id) => selectedIds.has(id));

    const closePanelState = () => {
        setEditing(null);
        setEditName("");
        setEditDescription("");
        setEditData({});
        setImportText("");
        setMode("guide");
    };

    const handleImport = async () => {
        if (submitting) return;
        if (!importText.trim()) {
            toast.error("请输入至少一条账号");
            return;
        }

        setSubmitting(true);
        try {
            const result = await importEmailAccounts(importProvider, importText, {
                description: importProviderMeta?.description,
                is_visible: true,
            });
            toast.success(`已导入 ${result.count} 条邮箱账号`);
            await loadAccounts();
            setImportText("");
            setMode("guide");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "导入邮箱账号失败");
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdate = async () => {
        if (!editing || submitting) return;
        setSubmitting(true);
        try {
            const nextData = { ...editData };
            const providerMeta = providerMap.get(editing.provider);
            for (const field of providerMeta?.accountFields || []) {
                if (field.preserveOnBlank && !String(nextData[field.key] || "").trim()) {
                    delete nextData[field.key];
                }
            }
            await updateEmailAccount(editing.id, editing.provider, nextData, {
                name: editName,
                description: editDescription,
                is_visible: editing.is_visible,
                is_valid: editing.is_valid,
            });
            toast.success("邮箱账号已更新");
            await loadAccounts();
            closePanelState();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "更新邮箱账号失败");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteEmailAccount(id);
            toast.success("邮箱账号已删除");
            await loadAccounts();
            setSelectedIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            if (editing?.id === id) {
                closePanelState();
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "删除邮箱账号失败");
        }
    };

    const requestSingleDelete = (account: EmailAccountRecord) => {
        setDeleteDialog({
            open: true,
            mode: "single",
            accountId: account.id,
            accountName: account.name,
        });
    };

    const toggleSelectAccount = (id: string, checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    };

    const toggleSelectAllFiltered = (checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const id of filteredIds) {
                if (checked) {
                    next.add(id);
                } else {
                    next.delete(id);
                }
            }
            return next;
        });
    };

    const handleBulkDelete = async (ids: string[]) => {
        if (ids.length === 0 || submitting) return;

        setSubmitting(true);
        try {
            const result = await deleteEmailAccounts(ids);
            toast.success(`已删除 ${result.deleted} 个邮箱账号`);
            if (editing && ids.includes(editing.id)) {
                closePanelState();
            }
            setSelectedIds(new Set());
            await loadAccounts();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "批量删除邮箱账号失败");
        } finally {
            setSubmitting(false);
        }
    };

    const requestBulkDelete = () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0 || submitting) return;
        setDeleteDialog({ open: true, mode: "bulk", ids, count: ids.length });
    };

    const handleConfirmDelete = async () => {
        if (!deleteDialog.open || submitting) return;

        if (deleteDialog.mode === "single") {
            await handleDelete(deleteDialog.accountId);
        } else {
            await handleBulkDelete(deleteDialog.ids);
        }

        setDeleteDialog({ open: false });
    };

    const handleCopy = async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(`${label}已复制`);
        } catch {
            toast.error("复制失败");
        }
    };

    const handleTestReceive = async (account: EmailAccountRecord) => {
        const providerMeta = providerMap.get(account.provider);
        if (!providerMeta?.supportsTestReceive) {
            toast.info("当前 provider 暂不支持测试收信能力");
            return;
        }

        setReceivingTestIds((prev) => new Set(prev).add(account.id));
        try {
            const result = await testEmailAccountReceive(account.id);
            toast.success(`${result.message} · ${result.mailbox} · ${result.message_count} 封邮件`);
            await loadAccounts();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "测试收信失败");
            await loadAccounts();
        } finally {
            setReceivingTestIds((prev) => {
                const next = new Set(prev);
                next.delete(account.id);
                return next;
            });
        }
    };

    const renderProviderField = (field: EmailProviderFieldDefinition) => (
        <div key={field.key}>
            <label className="text-xs font-mono text-muted-foreground block mb-1.5">{field.label}</label>
            <Input
                type={field.inputType === "password" ? "password" : "text"}
                value={String(editData[field.key] || "")}
                onChange={(event) => setEditData((prev) => ({ ...prev, [field.key]: event.target.value }))}
                placeholder={field.placeholder || undefined}
            />
        </div>
    );

    const renderProviderActions = (account: EmailAccountRecord) => {
        return (
            <Button
                variant="outline"
                size="sm"
                onClick={() => toast.info(`${account.provider} 暂无额外操作`)}
            >
                <ShieldEllipsis size={14} />
                操作
            </Button>
        );
    };

    return (
        <>
            <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
                <SheetContent className="w-[96vw] sm:max-w-[1080px] bg-card border-border flex flex-col p-0">
                    <SheetHeader className="px-5 py-4 border-b border-border shrink-0 flex flex-row items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                <Mail size={18} />
                            </div>
                            <div>
                                <SheetTitle className="font-mono text-sm">Email Accounts</SheetTitle>
                                <p className="text-xs text-muted-foreground font-mono mt-1">
                                    统一邮箱账号管理，新增走导入，编辑保留，并按 provider 扩展操作能力
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => void loadAccounts()} disabled={loading}>
                                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                                刷新
                            </Button>
                            <SheetClose asChild>
                                <Button variant="ghost" size="icon">
                                    <X size={16} />
                                </Button>
                            </SheetClose>
                        </div>
                    </SheetHeader>

                    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.45fr_1fr]">
                        <div className="border-b lg:border-b-0 lg:border-r border-border flex flex-col min-h-0">
                            <div className="p-5 space-y-3 shrink-0">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <h3 className="font-mono text-sm text-foreground">账号列表</h3>
                                        <p className="text-xs text-muted-foreground font-mono mt-1">
                                            支持统一查看不同 provider 的邮箱账号
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" onClick={() => setMode("import")}>
                                            <Upload size={14} />
                                            导入账号
                                        </Button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">
                                    <Input
                                        value={keyword}
                                        onChange={(event) => setKeyword(event.target.value)}
                                        placeholder="搜索名称、provider、标签或邮箱地址"
                                    />
                                    <Select value={providerFilter} onValueChange={(value) => setProviderFilter(value as EmailAccountProvider | "all")}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="筛选 provider" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">全部 Provider</SelectItem>
                                            {providers.map((item) => (
                                                <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                                    <div className="flex items-center gap-3">
                                        <span>共 {filteredAccounts.length} 条</span>
                                        <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                                            <Checkbox
                                                checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                                                onCheckedChange={(checked) => toggleSelectAllFiltered(checked === true)}
                                            />
                                            当前筛选全选
                                        </label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span>已选 {selectedCount} 条</span>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={requestBulkDelete}
                                            disabled={selectedCount === 0 || submitting}
                                        >
                                            <Trash2 size={14} />
                                            批量删除
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <ScrollArea className="flex-1 px-5 pb-5">
                                <div className="space-y-3 pr-4">
                                    {loading ? (
                                        <div className="py-20 text-center text-sm font-mono text-muted-foreground">正在加载邮箱账号...</div>
                                    ) : filteredAccounts.length === 0 ? (
                                        <div className="py-20 text-center">
                                            <Mail size={36} className="mx-auto text-muted-foreground mb-3" />
                                            <p className="text-sm font-mono text-muted-foreground">还没有邮箱账号</p>
                                            <p className="text-xs font-mono text-muted-foreground/70 mt-1">先选择 provider 再导入账号</p>
                                        </div>
                                    ) : (
                                        filteredAccounts.map((account) => {
                                            const isReceiveTesting = receivingTestIds.has(account.id);
                                            return (
                                                <div key={account.id} className="rounded-xl border border-border bg-background/40 p-4 transition-colors hover:border-primary/30">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0 flex items-start gap-3">
                                                            <Checkbox
                                                                className="mt-0.5"
                                                                checked={selectedIds.has(account.id)}
                                                                onCheckedChange={(checked) => toggleSelectAccount(account.id, checked === true)}
                                                            />
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <p className="font-mono text-sm font-semibold text-foreground truncate">{account.name}</p>
                                                                    <Badge variant="secondary" className="font-mono uppercase">{account.provider}</Badge>
                                                                    <Badge variant="outline" className="font-mono">{account.authType}</Badge>
                                                                </div>
                                                                <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{account.address || account.identifier || "未设置标识"}</p>
                                                                <p className="text-xs font-mono text-muted-foreground/80 mt-1 truncate">标签: {account.accountTag || "—"}</p>
                                                                {account.description ? (
                                                                    <p className="text-xs font-mono text-muted-foreground/70 mt-1 truncate">{account.description}</p>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            <Button variant="ghost" size="icon" onClick={() => void handleCopy(account.address || account.identifier, "邮箱标识")} title="复制邮箱标识">
                                                                <Copy size={14} />
                                                            </Button>
                                                            <Button variant="ghost" size="icon" onClick={() => openEdit(account)} title="编辑账号">
                                                                <Pencil size={14} />
                                                            </Button>
                                                            <Button variant="ghost" size="icon" onClick={() => requestSingleDelete(account)} title="删除账号">
                                                                <Trash2 size={14} />
                                                            </Button>
                                                        </div>
                                                    </div>

                                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                                                        <div className="rounded-lg border border-border bg-card/60 p-3">
                                                            <p className="text-muted-foreground mb-1">用户名 / 标识</p>
                                                            <code className="text-foreground break-all">{account.username || account.identifier || "—"}</code>
                                                        </div>
                                                        <div className="rounded-lg border border-border bg-card/60 p-3">
                                                            <p className="text-muted-foreground mb-1">认证方式</p>
                                                            <code className="text-foreground break-all">{account.authType || "—"}</code>
                                                        </div>
                                                    </div>

                                                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                                                        {renderProviderActions(account)}
                                                        {providerMap.get(account.provider)?.supportsTestReceive ? (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => void handleTestReceive(account)}
                                                                disabled={isReceiveTesting}
                                                            >
                                                                <Mail size={14} className={isReceiveTesting ? "animate-pulse" : ""} />
                                                                {isReceiveTesting ? "收信测试中..." : "测试收信"}
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </ScrollArea>
                        </div>

                        <div className="flex flex-col min-h-0">
                            <div className="p-5 border-b border-border shrink-0">
                                <Tabs value={mode} onValueChange={(value) => setMode(value as PanelMode)}>
                                    <TabsList className="grid w-full grid-cols-3">
                                        <TabsTrigger value="guide">说明</TabsTrigger>
                                        <TabsTrigger value="import">导入</TabsTrigger>
                                        <TabsTrigger value="edit" disabled={!editing}>编辑</TabsTrigger>
                                    </TabsList>
                                </Tabs>
                            </div>

                            <ScrollArea className="flex-1 p-5">
                                <Tabs value={mode} onValueChange={(value) => setMode(value as PanelMode)}>
                                    <TabsContent value="guide" className="mt-0 space-y-4">
                                        <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
                                            <h4 className="font-mono text-sm text-foreground">当前设计</h4>
                                            <p className="text-xs font-mono text-muted-foreground leading-6">
                                                统一做成邮箱账号管理，provider 列表、导入说明和能力标记全部由后端接口提供。
                                            </p>
                                        </div>
                                        <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
                                            <h4 className="font-mono text-sm text-foreground">导入规则</h4>
                                            <div className="space-y-2 text-xs font-mono text-muted-foreground">
                                                {providers.map((item) => (
                                                    <div key={item.key} className="rounded-lg bg-card p-3">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-foreground">{item.label}</span>
                                                            <Badge variant="outline" className="font-mono">{item.importHint}</Badge>
                                                        </div>
                                                        <p className="mt-2 leading-6">{item.description}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </TabsContent>

                                    <TabsContent value="import" className="mt-0 space-y-4">
                                        <div className="space-y-3">
                                            <div>
                                                <label className="text-xs font-mono text-muted-foreground block mb-1.5">Provider</label>
                                                <Select value={importProvider} onValueChange={(value) => setImportProvider(value as EmailAccountProvider)}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="选择 provider" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {providers.filter((item) => item.manualImportEnabled).map((item) => (
                                                            <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="rounded-lg border border-border bg-background/40 p-3 text-xs font-mono text-muted-foreground leading-6">
                                                <p className="text-foreground mb-1">导入格式</p>
                                                <p>{importProviderMeta?.importHint || "请选择 provider"}</p>
                                                <p className="mt-2">{importProviderMeta?.description || ""}</p>
                                            </div>
                                            <div>
                                                <label className="text-xs font-mono text-muted-foreground block mb-1.5">导入内容</label>
                                                <Textarea
                                                    className="min-h-[220px] font-mono text-sm"
                                                    value={importText}
                                                    onChange={(event) => setImportText(event.target.value)}
                                                    placeholder={importProviderMeta?.importHint || ""}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 pt-2">
                                            <Button variant="outline" className="flex-1" onClick={closePanelState}>取消</Button>
                                            <Button className="flex-1" onClick={() => void handleImport()} disabled={submitting}>
                                                {submitting ? "导入中..." : "开始导入"}
                                            </Button>
                                        </div>
                                    </TabsContent>

                                    <TabsContent value="edit" className="mt-0 space-y-4">
                                        {editing ? (
                                            <>
                                                <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-xs font-mono text-muted-foreground">
                                                    正在编辑：{editing.name} · {editing.provider}
                                                </div>
                                                <div className="space-y-3">
                                                    <div>
                                                        <label className="text-xs font-mono text-muted-foreground block mb-1.5">显示名称</label>
                                                        <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-mono text-muted-foreground block mb-1.5">邮箱地址</label>
                                                        <Input
                                                            value={String(editData.address || "")}
                                                            onChange={(event) => setEditData((prev) => ({ ...prev, address: event.target.value, identifier: event.target.value, username: event.target.value }))}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-mono text-muted-foreground block mb-1.5">账号标签</label>
                                                        <Input
                                                            value={String(editData.accountTag || "")}
                                                            onChange={(event) => setEditData((prev) => ({ ...prev, accountTag: event.target.value }))}
                                                        />
                                                    </div>
                                                    {(providerMap.get(editing.provider)?.accountFields || []).map(renderProviderField)}
                                                    <div>
                                                        <label className="text-xs font-mono text-muted-foreground block mb-1.5">描述</label>
                                                        <Input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 pt-2">
                                                    <Button variant="outline" className="flex-1" onClick={closePanelState}>取消</Button>
                                                    <Button className="flex-1" onClick={() => void handleUpdate()} disabled={submitting}>
                                                        {submitting ? "保存中..." : "更新账号"}
                                                    </Button>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm font-mono text-muted-foreground">
                                                先从左侧列表选择一条账号再编辑
                                            </div>
                                        )}
                                    </TabsContent>
                                </Tabs>
                            </ScrollArea>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>

            <AlertDialog
                open={deleteDialog.open}
                onOpenChange={(next) => {
                    if (!next) {
                        setDeleteDialog({ open: false });
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>确认删除邮箱账号</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteDialog.open && deleteDialog.mode === "single"
                                ? `确定要删除邮箱账号“${deleteDialog.accountName}”吗？此操作不可撤销。`
                                : `确定要批量删除 ${deleteDialog.open && deleteDialog.mode === "bulk" ? deleteDialog.count : 0} 个邮箱账号吗？此操作不可撤销。`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleConfirmDelete()} disabled={submitting}>
                            {submitting ? "删除中..." : "确认删除"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default EmailAccountsManager;
