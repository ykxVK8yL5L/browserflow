import React, { useState, useEffect } from "react";
import {
    Plus,
    Trash2,
    Pencil,
    Check,
    X,
    Globe,
    Loader2
} from "lucide-react";
import {
    loadUserAgents,
    addUserAgent,
    editUserAgent,
    removeUserAgent,
    type UserAgent
} from "@/lib/userAgentStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const UserAgentManager = () => {
    const [uas, setUas] = useState<UserAgent[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);

    const [newValue, setNewValue] = useState("");
    const [newIsDefault, setNewIsDefault] = useState(false);

    const [editingUa, setEditingUa] = useState<UserAgent | null>(null);
    const [editValue, setEditValue] = useState("");
    const [editIsDefault, setEditIsDefault] = useState(false);

    useEffect(() => {
        refresh();
    }, []);

    const refresh = async () => {
        setLoading(true);
        try {
            const data = await loadUserAgents();
            setUas(data);
        } catch (e) {
            toast.error("Failed to load User-Agents");
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newValue.trim()) return;
        try {
            await addUserAgent(newValue.trim(), newIsDefault);
            toast.success("User-Agent added");
            setNewValue("");
            setNewIsDefault(false);
            setIsAddOpen(false);
            await refresh();
        } catch (e) {
            toast.error("Failed to add User-Agent");
        }
    };

    const handleEdit = async () => {
        if (!editingUa || !editValue.trim()) return;
        try {
            await editUserAgent(editingUa.id, editValue.trim(), editIsDefault);
            toast.success("User-Agent updated");
            setIsEditOpen(false);
            await refresh();
        } catch (e) {
            toast.error("Failed to update User-Agent");
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await removeUserAgent(id);
            toast.success("User-Agent deleted");
            await refresh();
        } catch (e) {
            toast.error("Failed to delete User-Agent");
        }
    };

    const openEdit = (ua: UserAgent) => {
        setEditingUa(ua);
        setEditValue(ua.value);
        setEditIsDefault(ua.is_default);
        setIsEditOpen(true);
    };

    return (
        <div className="space-y-4 max-w-full overflow-hidden">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Globe size={18} className="text-primary" />
                    <h3 className="font-mono font-bold text-sm text-foreground">User-Agents</h3>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 font-mono text-xs"
                    onClick={() => setIsAddOpen(true)}
                >
                    <Plus size={14} />
                    Add UA
                </Button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-muted-foreground" />
                </div>
            ) : uas.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-border rounded-lg">
                    <p className="text-xs text-muted-foreground font-mono">No User-Agents configured.</p>
                </div>
            ) : (
                <div className="grid gap-2">
                    {uas.map((ua) => (
                        <div
                            key={ua.id}
                            className="flex items-center justify-between p-2 rounded-md bg-card border border-border group hover:border-primary/40 transition-colors"
                        >
                            <div className="flex-1 min-w-0 mr-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Input
                                        value={ua.value}
                                        readOnly
                                        className="flex-1 h-7 text-xs font-mono bg-transparent border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground truncate"
                                    />
                                    {ua.is_default && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono font-medium shrink-0">
                                            Default
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    onClick={() => openEdit(ua)}
                                >
                                    <Pencil size={12} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleDelete(ua.id)}
                                >
                                    <Trash2 size={12} />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add Dialog */}
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogContent className="sm:max-w-[425px] bg-card border-border">
                    <DialogHeader>
                        <DialogTitle className="font-mono text-sm">Add User-Agent</DialogTitle>
                        <DialogDescription className="font-mono text-xs text-muted-foreground">
                            Define a custom User-Agent string for your browser sessions.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label className="text-xs font-mono">UA String</Label>
                            <Textarea
                                placeholder="Mozilla/5.0 ..."
                                value={newValue}
                                onChange={(e) => setNewValue(e.target.value)}
                                className="font-mono text-xs min-h-[80px] resize-none break-all"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <Input
                                type="checkbox"
                                id="isDefault"
                                checked={newIsDefault}
                                onChange={(e) => setNewIsDefault(e.target.checked)}
                                className="h-4 w-4"
                            />
                            <Label htmlFor="isDefault" className="text-xs font-mono cursor-pointer">
                                Set as default
                            </Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddOpen(false)} className="font-mono text-xs">
                            Cancel
                        </Button>
                        <Button onClick={handleAdd} className="font-mono text-xs">
                            Add
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Dialog */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-[425px] bg-card border-border">
                    <DialogHeader>
                        <DialogTitle className="font-mono text-sm">Edit User-Agent</DialogTitle>
                        <DialogDescription className="font-mono text-xs text-muted-foreground">
                            Modify an existing User-Agent string.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label className="text-xs font-mono">UA String</Label>
                            <Textarea
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="font-mono text-xs min-h-[80px] resize-none break-all"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <Input
                                type="checkbox"
                                id="editIsDefault"
                                checked={editIsDefault}
                                onChange={(e) => setEditIsDefault(e.target.checked)}
                                className="h-4 w-4"
                            />
                            <Label htmlFor="editIsDefault" className="text-xs font-mono cursor-pointer">
                                Set as default
                            </Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditOpen(false)} className="font-mono text-xs">
                            Cancel
                        </Button>
                        <Button onClick={handleEdit} className="font-mono text-xs">
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default UserAgentManager;
