import { useState, useEffect } from "react";
import { X, Plus, Trash2, Pencil, KeyRound, Eye, EyeOff, Copy } from "lucide-react";
import { getCredentials, createCredential, updateCredential, deleteCredential, fetchCredentials, type Credential } from "@/lib/credentialStore";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface CredentialsManagerProps {
  open: boolean;
  onClose: () => void;
}

const typeOptions: { label: string; value: Credential["type"] }[] = [
  { label: "Password", value: "password" },
  { label: "API Key", value: "api_key" },
  { label: "Token", value: "token" },
  { label: "Text", value: "text" },
];

const inputClass =
  "w-full px-3 py-2 rounded-md bg-secondary border border-border text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

const CredentialsManager = ({ open, onClose }: CredentialsManagerProps) => {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [editing, setEditing] = useState<Credential | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<Credential["type"]>("password");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  const handleAuthExpired = () => {
    toast.error("登录已过期，请重新登录");
    onClose();
    navigate("/");
  };

  useEffect(() => {
    if (open) {
      fetchCredentials()
        .then(setCredentials)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (
            message === "Session expired or revoked"
            || message === "Invalid or expired token"
            || message === "Not authenticated"
          ) {
            handleAuthExpired();
            return;
          }
          toast.error(message || "加载凭证失败");
          setCredentials(getCredentials());
        });
      setCreating(false);
      setEditing(null);
      setVisibleIds(new Set());
    }
  }, [open]);

  const refresh = () => setCredentials(getCredentials());

  const resetForm = () => {
    setName("");
    setType("password");
    setValue("");
    setDescription("");
    setCreating(false);
    setEditing(null);
  };

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!value.trim()) { toast.error("Value is required"); return; }
    // Check for duplicate names
    if (credentials.some((c) => c.name === name.trim())) {
      toast.error("A credential with this name already exists");
      return;
    }
    try {
      await createCredential({ name: name.trim(), type, value, description: description.trim() });
      toast.success("Credential created");
      refresh();
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message === "Session expired or revoked"
        || message === "Invalid or expired token"
        || message === "Not authenticated"
      ) {
        handleAuthExpired();
        return;
      }
      toast.error(message || "Credential create failed");
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    if (!name.trim()) { toast.error("Name is required"); return; }
    // Check for duplicate names (excluding self)
    if (credentials.some((c) => c.name === name.trim() && c.id !== editing.id)) {
      toast.error("A credential with this name already exists");
      return;
    }
    try {
      await updateCredential(editing.id, { name: name.trim(), type, value, description: description.trim() });
      toast.success("Credential updated");
      refresh();
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message === "Session expired or revoked"
        || message === "Invalid or expired token"
        || message === "Not authenticated"
      ) {
        handleAuthExpired();
        return;
      }
      toast.error(message || "Credential update failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCredential(id);
      toast.success("Credential deleted");
      refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message === "Session expired or revoked"
        || message === "Invalid or expired token"
        || message === "Not authenticated"
      ) {
        handleAuthExpired();
        return;
      }
      toast.error(message || "Credential delete failed");
    }
  };

  const openEdit = (cred: Credential) => {
    setEditing(cred);
    setCreating(false);
    setName(cred.name);
    setType(cred.type);
    setValue(cred.value);
    setDescription(cred.description);
  };

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setName("");
    setType("password");
    setValue("");
    setDescription("");
  };

  const toggleVisible = (id: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const copyRef = (credName: string) => {
    navigator.clipboard.writeText(`{{credential:${credName}}}`);
    toast.success("Reference copied to clipboard");
  };

  const maskValue = (val: string) => "•".repeat(Math.min(val.length, 24));

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
            <KeyRound size={18} className="text-primary" />
            <h3 className="font-mono font-bold text-foreground text-sm">Credentials Manager</h3>
          </div>
          <div className="flex items-center gap-2">
            {!showForm && (
              <button
                onClick={openCreate}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-mono font-medium hover:opacity-90 transition-opacity"
              >
                <Plus size={13} />
                Add
              </button>
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
                  placeholder="e.g. my_api_key"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground/60 font-mono mt-1">
                  Use in nodes as: <code className="text-primary/80">{"{{credential:" + (name || "name") + "}}"}</code>
                </p>
              </div>
              <div>
                <label className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Type</label>
                <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as Credential["type"])}>
                  {typeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Value</label>
                <input
                  className={inputClass}
                  type={type === "text" ? "text" : "password"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Secret value"
                />
              </div>
              <div>
                <label className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Description</label>
                <input
                  className={inputClass}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                />
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
          ) : credentials.length === 0 ? (
            <div className="text-center py-12">
              <KeyRound size={36} className="mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground font-mono">No credentials yet</p>
              <p className="text-xs text-muted-foreground/60 font-mono mt-1">
                Add credentials to use in your flow nodes
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {credentials.map((cred) => (
                <div
                  key={cred.id}
                  className="group flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/30 transition-colors"
                >
                  <KeyRound size={14} className="text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground truncate">{cred.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-secondary text-muted-foreground uppercase">
                        {cred.type.replace("_", " ")}
                      </span>
                    </div>
                    {cred.description && (
                      <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{cred.description}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      <code className="text-xs font-mono text-muted-foreground/70 truncate">
                        {visibleIds.has(cred.id) ? cred.value : maskValue(cred.value)}
                      </code>
                      <button
                        onClick={() => toggleVisible(cred.id)}
                        className="p-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      >
                        {visibleIds.has(cred.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => copyRef(cred.name)}
                      className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy reference"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={() => openEdit(cred)}
                      className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(cred.id)}
                      className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        {!showForm && credentials.length > 0 && (
          <div className="px-5 py-3 border-t border-border shrink-0">
            <p className="text-xs text-muted-foreground/60 font-mono text-center">
              Use <code className="text-primary/70">{"{{credential:name}}"}</code> in any node text field to inject a credential
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CredentialsManager;
