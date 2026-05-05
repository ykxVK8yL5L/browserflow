import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
    ChevronRight,
    Eye,
    FileText,
    Folder,
    FolderPlus,
    Globe,
    Monitor,
    MoreHorizontal,
    Pencil,
    Save,
    Trash2,
    Upload,
    Plus,
    UserCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
    createFolder,
    deleteFilePath,
    getFileContent,
    listFiles,
    renameFilePath,
    saveFileContent,
    uploadFile,
    type FileEntry,
} from "@/lib/filesApi";
import {
    createIdentity,
    createIdentityFolder,
    deleteIdentity,
    deleteIdentityPath,
    fetchIdentities,
    fetchIdentityFileContent,
    fetchIdentityFiles,
    fetchIdentityState,
    renameIdentityPath,
    saveIdentityState,
    saveIdentityFileContent,
    uploadIdentityFile,
    updateIdentity,
    uploadIdentityState,
    type Identity,
    type IdentityFileEntry,
    type IdentityStateFile,
} from "@/lib/identityStore";
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
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface FileManagerProps {
    open: boolean;
    onClose: () => void;
}

type DeleteState =
    | { open: false }
    | { open: true; path: string; name: string };

type FileCreateState =
    | { open: false }
    | { open: true };

type IdentityDeleteState =
    | { open: false }
    | { open: true; identityId: string; identityName: string };

type ManagedResource =
    | { scope: "files" }
    | { scope: "identity-profile"; identityId: string; identityName: string };

const identityTypeOptions: { label: string; value: string }[] = [
    { label: "None (Pure)", value: "none" },
    { label: "File (State)", value: "file" },
    { label: "Profile (Full)", value: "profile" },
];

const FileManager = ({ open, onClose }: FileManagerProps) => {
    const [activeTab, setActiveTab] = useState("files");
    const [currentPath, setCurrentPath] = useState("");
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedFilePath, setSelectedFilePath] = useState("");
    const [selectedFileName, setSelectedFileName] = useState("");
    const [fileContent, setFileContent] = useState("");
    const [identityContent, setIdentityContent] = useState("");
    const [editorLoading, setEditorLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [folderName, setFolderName] = useState("");
    const [newFileName, setNewFileName] = useState("");
    const [fileCreateState, setFileCreateState] = useState<FileCreateState>({ open: false });
    const [renameValue, setRenameValue] = useState("");
    const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
    const [deleteState, setDeleteState] = useState<DeleteState>({ open: false });
    const uploadInputRef = useRef<HTMLInputElement | null>(null);
    const identityUploadInputRef = useRef<HTMLInputElement | null>(null);
    const editorPanelRef = useRef<HTMLDivElement | null>(null);

    const [identities, setIdentities] = useState<Identity[]>([]);
    const [identitiesLoading, setIdentitiesLoading] = useState(false);
    const [identityEditing, setIdentityEditing] = useState<Identity | null>(null);
    const [identityCreating, setIdentityCreating] = useState(false);
    const [identityName, setIdentityName] = useState("");
    const [identityType, setIdentityType] = useState("none");
    const [identityDeleteState, setIdentityDeleteState] = useState<IdentityDeleteState>({ open: false });
    const [identityStateViewer, setIdentityStateViewer] = useState({
        open: false,
        identityId: "",
        identityName: "",
        content: "",
        path: "",
        size: 0,
        loading: false,
        saving: false,
    });
    const [managedResource, setManagedResource] = useState<ManagedResource>({ scope: "files" });
    const [identityCurrentPath, setIdentityCurrentPath] = useState("");
    const [identityEntries, setIdentityEntries] = useState<IdentityFileEntry[]>([]);
    const [identityLoading, setIdentityLoading] = useState(false);
    const [identitySelectedFilePath, setIdentitySelectedFilePath] = useState("");
    const [identitySelectedFileName, setIdentitySelectedFileName] = useState("");
    const [identityEditorLoading, setIdentityEditorLoading] = useState(false);
    const [identityFolderName, setIdentityFolderName] = useState("");
    const [identityUploadState, setIdentityUploadState] = useState<{ open: false } | { open: true; identityId: string }>({ open: false });

    const currentManagedPath = managedResource.scope === "files" ? currentPath : identityCurrentPath;
    const currentManagedEntries = managedResource.scope === "files" ? entries : identityEntries;
    const currentSelectedFilePath = managedResource.scope === "files" ? selectedFilePath : identitySelectedFilePath;
    const currentSelectedFileName = managedResource.scope === "files" ? selectedFileName : identitySelectedFileName;
    const currentLoading = managedResource.scope === "files" ? loading : identityLoading;
    const currentEditorLoading = managedResource.scope === "files" ? editorLoading : identityEditorLoading;
    const currentContent = managedResource.scope === "files" ? fileContent : identityContent;

    const breadcrumbs = useMemo(() => {
        const basePath = currentManagedPath;
        const rootLabel = managedResource.scope === "files"
            ? "root"
            : managedResource.identityName || "profile";
        if (!basePath) return [{ label: rootLabel, path: "" }];
        const parts = basePath.split("/").filter(Boolean);
        return [{ label: "root", path: "" }, ...parts.map((part, index) => ({
            label: part,
            path: parts.slice(0, index + 1).join("/"),
        }))];
    }, [currentManagedPath, managedResource]);

    const normalizedBreadcrumbs = useMemo(() => {
        if (breadcrumbs.length === 0) return breadcrumbs;
        return [{ ...breadcrumbs[0], label: managedResource.scope === "files" ? "root" : (managedResource.identityName || "profile") }, ...breadcrumbs.slice(1)];
    }, [breadcrumbs, managedResource]);

    const loadEntries = useCallback(async (path = currentPath) => {
        setLoading(true);
        try {
            const data = await listFiles(path);
            setCurrentPath(data.current_path);
            setEntries(data.entries);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "加载文件失败");
        } finally {
            setLoading(false);
        }
    }, [currentPath]);

    const loadIdentityEntries = useCallback(async (identityId: string, path = identityCurrentPath) => {
        setIdentityLoading(true);
        try {
            const data = await fetchIdentityFiles(identityId, path);
            setIdentityCurrentPath(data.current_path);
            setIdentityEntries(data.entries);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "加载 identity 文件失败");
        } finally {
            setIdentityLoading(false);
        }
    }, [identityCurrentPath]);

    const loadIdentities = useCallback(async () => {
        setIdentitiesLoading(true);
        try {
            const data = await fetchIdentities();
            setIdentities(data);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "加载 identities 失败");
        } finally {
            setIdentitiesLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        void loadEntries("");
        void loadIdentities();
        setActiveTab("files");
        setSelectedFilePath("");
        setSelectedFileName("");
        setFileContent("");
        setIdentityContent("");
        setRenameTarget(null);
        setRenameValue("");
        setFolderName("");
        setNewFileName("");
        setManagedResource({ scope: "files" });
        setIdentityCurrentPath("");
        setIdentityEntries([]);
        setIdentitySelectedFilePath("");
        setIdentitySelectedFileName("");
        setIdentityFolderName("");
        resetIdentityForm();
        setIdentityStateViewer({
            open: false,
            identityId: "",
            identityName: "",
            content: "",
            path: "",
            size: 0,
            loading: false,
            saving: false,
        });
    }, [loadEntries, loadIdentities, open]);

    useEffect(() => {
        if (!open || activeTab !== "files" || !currentSelectedFilePath || currentEditorLoading) return;
        if (typeof window !== "undefined" && window.innerWidth >= 1024) return;
        editorPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [activeTab, currentEditorLoading, currentSelectedFilePath, open]);

    const resetIdentityForm = () => {
        setIdentityEditing(null);
        setIdentityCreating(false);
        setIdentityName("");
        setIdentityType("none");
    };

    const openDirectory = (path: string) => {
        if (managedResource.scope === "files") {
            setSelectedFilePath("");
            setSelectedFileName("");
            setFileContent("");
            void loadEntries(path);
            return;
        }

        setIdentitySelectedFilePath("");
        setIdentitySelectedFileName("");
        setIdentityContent("");
        void loadIdentityEntries(managedResource.identityId, path);
    };

    const handleOpenFile = async (entry: FileEntry) => {
        setEditorLoading(true);
        try {
            const data = await getFileContent(entry.path);
            setSelectedFilePath(data.path);
            setSelectedFileName(entry.name);
            setFileContent(data.content);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "读取文件失败");
        } finally {
            setEditorLoading(false);
        }
    };

    const handleOpenIdentityFile = async (entry: IdentityFileEntry) => {
        if (managedResource.scope !== "identity-profile") return;
        setIdentityEditorLoading(true);
        try {
            const data = await fetchIdentityFileContent(managedResource.identityId, entry.path);
            setIdentitySelectedFilePath(data.path);
            setIdentitySelectedFileName(entry.name);
            setIdentityContent(data.content);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "读取 identity 文件失败");
        } finally {
            setIdentityEditorLoading(false);
        }
    };

    const handleSave = async () => {
        if (!currentSelectedFilePath || saving) return;
        setSaving(true);
        try {
            if (managedResource.scope === "files") {
                await saveFileContent(selectedFilePath, fileContent);
                await loadEntries();
            } else {
                await saveIdentityFileContent(managedResource.identityId, identitySelectedFilePath, identityContent);
                await loadIdentityEntries(managedResource.identityId);
            }
            toast.success("文件已保存");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const handleCreateFolder = async () => {
        const trimmed = managedResource.scope === "files" ? folderName.trim() : identityFolderName.trim();
        if (!trimmed) return;
        try {
            if (managedResource.scope === "files") {
                await createFolder(currentPath, trimmed);
                setFolderName("");
                await loadEntries();
            } else {
                await createIdentityFolder(managedResource.identityId, identityCurrentPath, trimmed);
                setIdentityFolderName("");
                await loadIdentityEntries(managedResource.identityId);
            }
            toast.success("目录已创建");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "创建目录失败");
        }
    };

    const handleCreateFile = async () => {
        const trimmed = newFileName.trim();
        if (!trimmed) return;
        if (trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") {
            toast.error("文件名不合法");
            return;
        }

        const basePath = managedResource.scope === "files" ? currentPath : identityCurrentPath;
        const newPath = basePath ? `${basePath}/${trimmed}` : trimmed;
        try {
            const result = managedResource.scope === "files"
                ? await saveFileContent(newPath, "")
                : await saveIdentityFileContent(managedResource.identityId, newPath, "");
            toast.success("文件已创建");
            setFileCreateState({ open: false });
            setNewFileName("");
            if (managedResource.scope === "files") {
                await loadEntries();
                setSelectedFilePath(result.path);
                setSelectedFileName(trimmed);
                setFileContent(result.content);
            } else {
                await loadIdentityEntries(managedResource.identityId);
                setIdentitySelectedFilePath(result.path);
                setIdentitySelectedFileName(trimmed);
                setIdentityContent(result.content);
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "创建文件失败");
        }
    };

    const handleRename = async () => {
        if (!renameTarget) return;
        const trimmed = renameValue.trim();
        if (!trimmed) return;

        const parent = renameTarget.path.includes("/")
            ? renameTarget.path.slice(0, renameTarget.path.lastIndexOf("/"))
            : "";
        const newPath = parent ? `${parent}/${trimmed}` : trimmed;

        try {
            const result = managedResource.scope === "files"
                ? await renameFilePath(renameTarget.path, newPath)
                : await renameIdentityPath(managedResource.identityId, renameTarget.path, newPath);
            toast.success("重命名成功");
            if (managedResource.scope === "files") {
                if (selectedFilePath === renameTarget.path) {
                    setSelectedFilePath(result.path);
                    setSelectedFileName(trimmed);
                }
                await loadEntries();
            } else {
                if (identitySelectedFilePath === renameTarget.path) {
                    setIdentitySelectedFilePath(result.path);
                    setIdentitySelectedFileName(trimmed);
                }
                await loadIdentityEntries(managedResource.identityId);
            }
            setRenameTarget(null);
            setRenameValue("");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "重命名失败");
        }
    };

    const handleDelete = async () => {
        if (!deleteState.open) return;
        try {
            if (managedResource.scope === "files") {
                await deleteFilePath(deleteState.path);
            } else {
                await deleteIdentityPath(managedResource.identityId, deleteState.path);
            }
            toast.success("删除成功");
            if (managedResource.scope === "files" && selectedFilePath === deleteState.path) {
                setSelectedFilePath("");
                setSelectedFileName("");
                setFileContent("");
            }
            if (managedResource.scope === "identity-profile" && identitySelectedFilePath === deleteState.path) {
                setIdentitySelectedFilePath("");
                setIdentitySelectedFileName("");
                setIdentityContent("");
            }
            setDeleteState({ open: false });
            if (managedResource.scope === "files") {
                await loadEntries();
            } else {
                await loadIdentityEntries(managedResource.identityId);
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "删除失败");
        }
    };

    const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            if (managedResource.scope === "files") {
                await uploadFile(currentPath, file);
                await loadEntries();
            } else {
                await uploadIdentityFile(managedResource.identityId, identityCurrentPath, file);
                await loadIdentityEntries(managedResource.identityId);
            }
            toast.success("上传成功");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "上传失败");
        }
    };

    const handleIdentityUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        const formData = new FormData();
        formData.append("file", file);
        formData.append("name", `Uploaded ${file.name.replace(".json", "")}`);

        try {
            await uploadIdentityState(formData);
            toast.success("Identity state uploaded");
            await loadIdentities();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Upload failed");
        }
    };

    const handleCreateIdentity = async () => {
        if (!identityName.trim()) {
            toast.error("Name is required");
            return;
        }
        try {
            await createIdentity({ name: identityName.trim(), type: identityType });
            toast.success("Identity created");
            await loadIdentities();
            resetIdentityForm();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to create identity");
        }
    };

    const handleUpdateIdentity = async () => {
        if (!identityEditing) return;
        if (!identityName.trim()) {
            toast.error("Name is required");
            return;
        }
        try {
            await updateIdentity(identityEditing.id, { name: identityName.trim(), type: identityType });
            toast.success("Identity updated");
            await loadIdentities();
            resetIdentityForm();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to update identity");
        }
    };

    const handleDeleteIdentity = async () => {
        if (!identityDeleteState.open) return;
        try {
            await deleteIdentity(identityDeleteState.identityId);
            toast.success("Identity deleted");
            setIdentityDeleteState({ open: false });
            await loadIdentities();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to delete identity");
        }
    };

    const handleViewIdentityState = async (identity: Identity) => {
        setIdentityStateViewer({
            open: true,
            identityId: identity.id,
            identityName: identity.name,
            content: "",
            path: "",
            size: 0,
            loading: true,
            saving: false,
        });

        try {
            const state: IdentityStateFile = await fetchIdentityState(identity.id);
            setIdentityStateViewer({
                open: true,
                identityId: identity.id,
                identityName: identity.name,
                content: state.content,
                path: state.path,
                size: state.size,
                loading: false,
                saving: false,
            });
        } catch (error) {
            setIdentityStateViewer((prev) => ({ ...prev, loading: false }));
            toast.error(error instanceof Error ? error.message : "读取 identity 文件失败");
        }
    };

    const handleSaveIdentityState = async () => {
        if (!identityStateViewer.identityId || identityStateViewer.loading || identityStateViewer.saving) return;
        setIdentityStateViewer((prev) => ({ ...prev, saving: true }));
        try {
            const result = await saveIdentityState(identityStateViewer.identityId, identityStateViewer.content);
            setIdentityStateViewer((prev) => ({
                ...prev,
                content: result.content,
                path: result.path,
                size: result.size,
                saving: false,
            }));
            toast.success("Identity 文件已保存");
        } catch (error) {
            setIdentityStateViewer((prev) => ({ ...prev, saving: false }));
            toast.error(error instanceof Error ? error.message : "保存 identity 文件失败");
        }
    };

    const openIdentityProfileManager = async (identity: Identity) => {
        setActiveTab("files");
        setManagedResource({ scope: "identity-profile", identityId: identity.id, identityName: identity.name });
        setIdentityCurrentPath("");
        setIdentitySelectedFilePath("");
        setIdentitySelectedFileName("");
        setIdentityContent("");
        await loadIdentityEntries(identity.id, "");
    };

    const switchToFilesManager = () => {
        setManagedResource({ scope: "files" });
    };

    const handleCopyContent = async () => {
        try {
            await navigator.clipboard.writeText(currentContent);
            toast.success("内容已复制");
        } catch {
            toast.error("复制失败，请检查浏览器权限");
        }
    };

    const handlePasteContent = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (managedResource.scope === "files") {
                setFileContent((prev) => prev + text);
            } else {
                setIdentityContent((prev) => prev + text);
            }
            toast.success("内容已粘贴");
        } catch {
            toast.error("粘贴失败，请检查浏览器权限");
        }
    };

    const openIdentityEdit = (identity: Identity) => {
        setIdentityEditing(identity);
        setIdentityCreating(false);
        setIdentityName(identity.name);
        setIdentityType(identity.type);
    };

    const openIdentityCreate = () => {
        setIdentityEditing(null);
        setIdentityCreating(true);
        setIdentityName("");
        setIdentityType("none");
    };

    const showIdentityForm = identityCreating || identityEditing !== null;

    return (
        <>
            <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
                <SheetContent side="right" className="h-[100dvh] max-h-[100dvh] w-full overflow-hidden p-0 sm:max-w-6xl" showCloseButton>
                    <div className="flex h-full min-h-0 flex-col">
                        <SheetHeader className="border-b px-6 py-4">
                            <SheetTitle className="font-mono text-sm">Resources</SheetTitle>
                        </SheetHeader>

                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
                            <div className="border-b px-6 py-3">
                                <TabsList>
                                    <TabsTrigger value="files">Files</TabsTrigger>
                                    <TabsTrigger value="identities">Identities</TabsTrigger>
                                </TabsList>
                            </div>

                            <TabsContent value="files" className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
                                <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row lg:overflow-hidden">
                                    <div className="flex w-full shrink-0 flex-col border-b lg:min-h-0 lg:w-[380px] lg:border-b-0 lg:border-r">
                                        <div className="space-y-3 border-b px-4 py-4">
                                            <div className="flex flex-wrap items-center gap-1 text-xs font-mono text-muted-foreground">
                                                {normalizedBreadcrumbs.map((item, index) => (
                                                    <button
                                                        key={item.path || "root"}
                                                        type="button"
                                                        onClick={() => openDirectory(item.path)}
                                                        className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-secondary hover:text-foreground"
                                                    >
                                                        <span>{item.label}</span>
                                                        {index < normalizedBreadcrumbs.length - 1 && <ChevronRight size={12} />}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                <Button
                                                    type="button"
                                                    variant={managedResource.scope === "files" ? "default" : "secondary"}
                                                    size="sm"
                                                    onClick={switchToFilesManager}
                                                >
                                                    Files
                                                </Button>
                                                {managedResource.scope === "identity-profile" && (
                                                    <Button type="button" variant="secondary" size="sm" disabled>
                                                        {managedResource.identityName}
                                                    </Button>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-2 gap-2">
                                                <Input
                                                    value={managedResource.scope === "files" ? folderName : identityFolderName}
                                                    onChange={(e) => managedResource.scope === "files" ? setFolderName(e.target.value) : setIdentityFolderName(e.target.value)}
                                                    placeholder="新目录名称"
                                                    className="col-span-2 font-mono text-xs"
                                                />
                                                <Button type="button" variant="secondary" size="sm" onClick={() => void handleCreateFolder()}>
                                                    <FolderPlus size={14} className="mr-2" />
                                                    新建目录
                                                </Button>
                                                <Button type="button" variant="secondary" size="sm" onClick={() => setFileCreateState({ open: true })}>
                                                    <Plus size={14} className="mr-2" />
                                                    新建文件
                                                </Button>
                                                <Button type="button" variant="secondary" size="sm" className="col-span-2" onClick={() => uploadInputRef.current?.click()}>
                                                    <Upload size={14} className="mr-2" />
                                                    上传文件
                                                </Button>
                                                <input
                                                    ref={uploadInputRef}
                                                    type="file"
                                                    className="hidden"
                                                    onChange={(e) => void handleUploadChange(e)}
                                                />
                                            </div>
                                        </div>

                                        <ScrollArea className="h-[38vh] lg:flex-1">
                                            <div className="p-3">
                                                {currentLoading ? (
                                                    <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>
                                                ) : currentManagedEntries.length === 0 ? (
                                                    <div className="py-10 text-center text-sm text-muted-foreground">当前目录为空</div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {currentManagedEntries.map((entry) => (
                                                            <div
                                                                key={entry.path}
                                                                className="flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-secondary/60"
                                                            >
                                                                <button
                                                                    type="button"
                                                                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                                                    onClick={() => {
                                                                        if (entry.kind === "directory") {
                                                                            openDirectory(entry.path);
                                                                            return;
                                                                        }
                                                                        if (managedResource.scope === "files") {
                                                                            void handleOpenFile(entry as FileEntry);
                                                                        } else {
                                                                            void handleOpenIdentityFile(entry as IdentityFileEntry);
                                                                        }
                                                                    }}
                                                                >
                                                                    {entry.kind === "directory" ? (
                                                                        <Folder size={16} className="shrink-0 text-primary" />
                                                                    ) : (
                                                                        <FileText size={16} className="shrink-0 text-muted-foreground" />
                                                                    )}
                                                                    <div className="min-w-0">
                                                                        <div className="truncate text-sm font-mono text-foreground">{entry.name}</div>
                                                                        <div className="truncate text-[11px] text-muted-foreground">
                                                                            {entry.kind === "file" && entry.size !== null ? `${entry.size} B · ` : ""}
                                                                            {new Date(entry.updated_at * 1000).toLocaleString()}
                                                                        </div>
                                                                    </div>
                                                                </button>
                                                                <DropdownMenu>
                                                                    <DropdownMenuTrigger asChild>
                                                                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
                                                                            <MoreHorizontal size={14} />
                                                                        </Button>
                                                                    </DropdownMenuTrigger>
                                                                    <DropdownMenuContent align="end">
                                                                        <DropdownMenuItem
                                                                            onClick={() => {
                                                                                setRenameTarget(entry);
                                                                                setRenameValue(entry.name);
                                                                            }}
                                                                        >
                                                                            <Pencil size={14} className="mr-2" />
                                                                            重命名
                                                                        </DropdownMenuItem>
                                                                        <DropdownMenuItem
                                                                            className="text-destructive focus:text-destructive"
                                                                            onClick={() => setDeleteState({ open: true, path: entry.path, name: entry.name })}
                                                                        >
                                                                            <Trash2 size={14} className="mr-2" />
                                                                            删除
                                                                        </DropdownMenuItem>
                                                                    </DropdownMenuContent>
                                                                </DropdownMenu>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </ScrollArea>
                                    </div>

                                    <div ref={editorPanelRef} className="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                                        <div className="flex items-center justify-between border-b px-6 py-4">
                                            <div>
                                                <div className="font-mono text-sm text-foreground">{currentSelectedFileName || "未选择文件"}</div>
                                                <div className="text-xs text-muted-foreground">仅支持 UTF-8 文本文件编辑</div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Button type="button" variant="secondary" onClick={() => void handleCopyContent()} disabled={!currentSelectedFilePath}>
                                                    复制
                                                </Button>
                                                <Button type="button" variant="secondary" onClick={() => void handlePasteContent()} disabled={!currentSelectedFilePath}>
                                                    粘贴
                                                </Button>
                                                <Button type="button" onClick={() => void handleSave()} disabled={!currentSelectedFilePath || saving}>
                                                    <Save size={14} className="mr-2" />
                                                    {saving ? "保存中..." : "保存"}
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="p-6 lg:flex-1 lg:overflow-y-auto">
                                            {currentEditorLoading ? (
                                                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">读取中...</div>
                                            ) : currentSelectedFilePath ? (
                                                <div className="h-[55vh] min-h-[420px] overflow-hidden rounded-md border lg:h-full">
                                                    <Editor
                                                        height="100%"
                                                        defaultLanguage="plaintext"
                                                        language="json"
                                                        theme="vs-dark"
                                                        value={currentContent}
                                                        onChange={(value) => managedResource.scope === "files" ? setFileContent(value ?? "") : setIdentityContent(value ?? "")}
                                                        options={{
                                                            minimap: { enabled: false },
                                                            fontSize: 13,
                                                            wordWrap: "on",
                                                            automaticLayout: true,
                                                            scrollBeyondLastLine: false,
                                                            tabSize: 2,
                                                        }}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                                    从左侧选择一个文件开始编辑
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="identities" className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
                                {showIdentityForm ? (
                                    <div className="mx-auto w-full max-w-xl space-y-4 rounded-lg border bg-card p-5">
                                        <div>
                                            <label className="mb-1.5 block text-xs font-mono font-medium uppercase tracking-wider text-muted-foreground">Name</label>
                                            <Input
                                                value={identityName}
                                                onChange={(e) => setIdentityName(e.target.value)}
                                                placeholder="e.g. Google-Main-Account"
                                                className="font-mono text-sm"
                                                autoFocus
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-xs font-mono font-medium uppercase tracking-wider text-muted-foreground">Type</label>
                                            <select
                                                className="w-full rounded-md border border-border bg-secondary px-3 py-2 font-mono text-sm text-foreground"
                                                value={identityType}
                                                onChange={(e) => setIdentityType(e.target.value)}
                                            >
                                                {identityTypeOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex gap-2 pt-2">
                                            <Button type="button" variant="secondary" className="flex-1" onClick={resetIdentityForm}>
                                                Cancel
                                            </Button>
                                            <Button
                                                type="button"
                                                className="flex-1"
                                                onClick={() => void (identityEditing ? handleUpdateIdentity() : handleCreateIdentity())}
                                            >
                                                {identityEditing ? "Update" : "Create"}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex min-h-0 flex-1 flex-col">
                                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                                <div className="font-mono text-sm text-foreground">Identities</div>
                                                <div className="text-xs text-muted-foreground">管理浏览器身份与状态文件</div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button type="button" variant="secondary" onClick={() => identityUploadInputRef.current?.click()}>
                                                    <Upload size={14} className="mr-2" />
                                                    Upload
                                                </Button>
                                                <input
                                                    ref={identityUploadInputRef}
                                                    type="file"
                                                    accept=".json"
                                                    className="hidden"
                                                    onChange={(e) => void handleIdentityUpload(e)}
                                                />
                                                <Button type="button" onClick={openIdentityCreate}>
                                                    <Plus size={14} className="mr-2" />
                                                    Create
                                                </Button>
                                            </div>
                                        </div>

                                        <ScrollArea className="flex-1">
                                            <div className="space-y-2 pb-4">
                                                {identitiesLoading ? (
                                                    <div className="flex h-40 items-center justify-center">
                                                        <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-primary" />
                                                    </div>
                                                ) : identities.length === 0 ? (
                                                    <div className="py-10 text-center">
                                                        <p className="text-xs font-mono text-muted-foreground">No identities found</p>
                                                    </div>
                                                ) : (
                                                    identities.map((identity) => (
                                                        <div key={identity.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 p-3 transition-colors hover:bg-secondary/40 group">
                                                            <div className="flex min-w-0 items-center gap-3">
                                                                <div className="rounded-md border border-border bg-background p-2">
                                                                    {identity.type === "none" && <Globe size={14} className="text-muted-foreground" />}
                                                                    {identity.type === "file" && <Upload size={14} className="text-primary" />}
                                                                    {identity.type === "profile" && <Monitor size={14} className="text-blue-400" />}
                                                                </div>
                                                                <div className="truncate">
                                                                    <p className="truncate text-xs font-mono font-medium text-foreground">{identity.name}</p>
                                                                    <p className="text-[10px] font-mono uppercase text-muted-foreground">{identity.type}</p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                                                {identity.type !== "profile" && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleViewIdentityState(identity)}
                                                                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                                                        title="View state"
                                                                    >
                                                                        <Eye size={14} />
                                                                    </button>
                                                                )}
                                                                {identity.type === "profile" && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void openIdentityProfileManager(identity)}
                                                                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                                                        title="Manage files"
                                                                    >
                                                                        <Folder size={14} />
                                                                    </button>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openIdentityEdit(identity)}
                                                                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                                                    title="Edit"
                                                                >
                                                                    <Pencil size={14} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setIdentityDeleteState({ open: true, identityId: identity.id, identityName: identity.name })}
                                                                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                                                                    title="Delete"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </ScrollArea>
                                    </div>
                                )}
                            </TabsContent>
                        </Tabs>
                    </div>
                </SheetContent>
            </Sheet>

            <AlertDialog open={fileCreateState.open} onOpenChange={(next) => !next && setFileCreateState({ open: false })}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>新建文件</AlertDialogTitle>
                        <AlertDialogDescription>请输入文件名，文件会创建在当前目录下。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input value={newFileName} onChange={(e) => setNewFileName(e.target.value)} className="font-mono text-sm" placeholder="example.txt" />
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setFileCreateState({ open: false })}>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleCreateFile()}>确认</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={renameTarget !== null} onOpenChange={(next) => !next && setRenameTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>重命名</AlertDialogTitle>
                        <AlertDialogDescription>请输入新的名称。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="font-mono text-sm" />
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setRenameTarget(null)}>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleRename()}>确认</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={deleteState.open} onOpenChange={(next) => !next && setDeleteState({ open: false })}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>确认删除</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteState.open ? `确定删除“${deleteState.name}”吗？此操作不可撤销。` : "确定删除此项吗？"}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleDelete()}>确认删除</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={identityDeleteState.open}
                onOpenChange={(next) => !next && setIdentityDeleteState({ open: false })}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>确认删除 Identity</AlertDialogTitle>
                        <AlertDialogDescription>
                            {identityDeleteState.open
                                ? `确定要删除 Identity“${identityDeleteState.identityName}”吗？相关文件也会被一并移除，且此操作不可撤销。`
                                : "确定要删除此 Identity 吗？相关文件也会被一并移除，且此操作不可撤销。"}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleDeleteIdentity()}>确认删除</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={identityStateViewer.open}
                onOpenChange={(next) => {
                    if (!next) {
                        setIdentityStateViewer({
                            open: false,
                            identityId: "",
                            identityName: "",
                            content: "",
                            path: "",
                            size: 0,
                            loading: false,
                            saving: false,
                        });
                    }
                }}
            >
                <AlertDialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Identity 文件内容</AlertDialogTitle>
                        <AlertDialogDescription>
                            {identityStateViewer.identityName
                                ? `${identityStateViewer.identityName} / ${identityStateViewer.path || "state.json"}`
                                : "查看 identity 的 state.json 内容"}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">
                            {identityStateViewer.path ? `${identityStateViewer.path} · ${identityStateViewer.size} B` : ""}
                        </div>
                        {identityStateViewer.loading ? (
                            <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">读取中...</div>
                        ) : (
                            <div className="space-y-3">
                                <div className="min-h-[420px] overflow-hidden rounded-md border">
                                    <Editor
                                        height="420px"
                                        defaultLanguage="json"
                                        language="json"
                                        theme="vs-dark"
                                        value={identityStateViewer.content}
                                        onChange={(value) => setIdentityStateViewer((prev) => ({ ...prev, content: value ?? "" }))}
                                        options={{
                                            minimap: { enabled: false },
                                            fontSize: 13,
                                            wordWrap: "on",
                                            automaticLayout: true,
                                            scrollBeyondLastLine: false,
                                            tabSize: 2,
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                    <AlertDialogFooter>
                        <div className="flex justify-between w-full">
                            <AlertDialogAction onClick={() => void handleSaveIdentityState()}>{identityStateViewer.saving ? "保存中..." : "保存"}</AlertDialogAction>
                            <AlertDialogCancel>关闭</AlertDialogCancel>
                        </div>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default FileManager;