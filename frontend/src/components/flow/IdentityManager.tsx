import { useState, useEffect } from "react";
import { X, Plus, Trash2, Pencil, UserCircle, Upload, Globe, Monitor, Eye, EyeOff } from "lucide-react";
import {
    createIdentity,
    updateIdentity,
    deleteIdentity,
    fetchIdentities,
    uploadIdentityState,
    type Identity
} from "@/lib/identityStore";
import { toast } from "sonner";

interface IdentityManagerProps {
    open: boolean;
    onClose: () => void;
}

const typeOptions: { label: string; value: string }[] = [
    { label: "None (Pure)", value: "none" },
    { label: "File (State)", value: "file" },
    { label: "Profile (Full)", value: "profile" },
];

const inputClass =
    "w-full px-3 py-2 rounded-md bg-secondary border border-border text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

const IdentityManager = ({ open, onClose }: IdentityManagerProps) => {
    const [identities, setIdentities] = useState<Identity[]>([]);
    const [editing, setEditing] = useState<Identity | null>(null);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [type, setType] = useState("none");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open) {
            loadIdentities();
        }
    }, [open]);

    const loadIdentities = async () => {
        setLoading(true);
        try {
            const data = await fetchIdentities();
            setIdentities(data);
        } catch (error) {
            toast.error("Failed to load identities");
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setName("");
        setType("none");
        setCreating(false);
        setEditing(null);
    };

    const handleCreate = async () => {
        if (!name.trim()) { toast.error("Name is required"); return; }
        try {
            const newId = await createIdentity({
                name: name.trim(),
                type,
            });
            toast.success("Identity created");
            await loadIdentities();
            resetForm();
        } catch (error: any) {
            toast.error(error.message || "Failed to create identity");
        }
    };

    const handleUpdate = async () => {
        if (!editing) return;
        if (!name.trim()) { toast.error("Name is required"); return; }
        try {
            await updateIdentity(editing.id, {
                name: name.trim(),
                type,
            });
            toast.success("Identity updated");
            await loadIdentities();
            resetForm();
        } catch (error: any) {
            toast.error(error.message || "Failed to update identity");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this identity? All associated files will be removed.")) return;
        try {
            await deleteIdentity(id);
            toast.success("Identity deleted");
            await loadIdentities();
        } catch (error: any) {
            toast.error(error.message || "Failed to delete identity");
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append("file", file);
        formData.append("name", `Uploaded ${file.name.replace(".json", "")}`);

        try {
            await uploadIdentityState(formData);
            toast.success("Identity state uploaded");
            await loadIdentities();
        } catch (error: any) {
            toast.error(error.message || "Upload failed");
        }
    };

    const openEdit = (id: Identity) => {
        setEditing(id);
        setCreating(false);
        setName(id.name);
        setType(id.type);
    };

    const openCreate = () => {
        setEditing(null);
        setCreating(true);
        setName("");
        setType("none");
    };

    const showForm = creating || editing !== null;

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-card border border-border rounded-xl w-[90vw] max-w-lg shadow-2xl max-h-[80vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                    <div className="flex items-center gap-2.5">
                        <UserCircle size={18} className="text-primary" />
                        <h3 className="font-mono font-bold text-foreground text-sm">Identity Manager</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {!showForm && (
                            <>
                                <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-mono font-medium hover:bg-secondary/80 transition-colors cursor-pointer">
                                    <Upload size={13} />
                                    Upload
                                    <input type="file" accept=".json" className="hidden" onChange={handleUpload} />
                                </label>
                                <button
                                    onClick={openCreate}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-mono font-medium hover:opacity-90 transition-opacity"
                                >
                                    <Plus size={13} />
                                    Create
                                </button>
                            </>
                        )}
                        <button onClick={onClose} className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5">
                    {showForm ? (
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Name</label>
                                <input
                                    className={inputClass}
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Google-Main-Account"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Type</label>
                                <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
                                    {typeOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button onClick={resetForm} className="flex-1 px-3 py-2 rounded-md text-sm font-mono text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                                    Cancel
                                </button>
                                <button
                                    onClick={editing ? handleUpdate : handleCreate}
                                    className="flex-1 px-3 py-2 rounded-md text-sm font-mono bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                                >
                                    {editing ? "Update" : "Create"}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {loading ? (
                                <div className="flex items-center justify-center h-40">
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                                </div>
                            ) : identities.length === 0 ? (
                                <div className="text-center py-10">
                                    <p className="text-xs text-muted-foreground font-mono">No identities found</p>
                                </div>
                            ) : (
                                identities.map((id) => (
                                    <div key={id.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/20 hover:bg-secondary/40 transition-colors group">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="p-2 rounded-md bg-background border border-border">
                                                {id.type === "none" && <Globe size={14} className="text-muted-foreground" />}
                                                {id.type === "file" && <Upload size={14} className="text-primary" />}
                                                {id.type === "profile" && <Monitor size={14} className="text-blue-400" />}
                                            </div>
                                            <div className="truncate">
                                                <p className="text-xs font-mono font-medium text-foreground truncate">{id.name}</p>
                                                <p className="text-[10px] font-mono text-muted-foreground uppercase">{id.type}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => openEdit(id)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                                                <Pencil size={14} />
                                            </button>
                                            <button onClick={() => handleDelete(id.id)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default IdentityManager;
