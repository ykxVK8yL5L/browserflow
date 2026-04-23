import { useState, useEffect, useMemo, useCallback } from "react";
import { X, Plus, Trash2, Pencil, KeyRound, Eye, EyeOff, Copy } from "lucide-react";
import {
  createCredential,
  updateCredential,
  deleteCredential,
  fetchCredentials,
  type Credential,
} from "@/lib/credentialStore";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Switch } from "@/components/ui/switch";

interface CredentialsManagerProps {
  open: boolean;
  onClose: () => void;
}

const typeOptions: { label: string; value: Credential["type"] }[] = [
  { label: "Password", value: "password" },
  { label: "API Key", value: "api_key" },
  { label: "Token", value: "token" },
  { label: "Text", value: "text" },
  { label: "Dictionary", value: "dictionary" },
];

const CREDENTIAL_PAGE_SIZE = 8;
type CredentialDictionaryData = Record<string, unknown>;

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
  const [isVisible, setIsVisible] = useState(true);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [dictionaryText, setDictionaryText] = useState('{\n  "username": "",\n  "password": ""\n}');
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);

  const handleAuthExpired = useCallback(() => {
    toast.error("登录已过期，请重新登录");
    onClose();
    navigate("/");
  }, [navigate, onClose]);

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
          setCredentials([]);
        });
      setCreating(false);
      setEditing(null);
      setVisibleIds(new Set());
      setKeyword("");
      setPage(1);
    }
  }, [open, handleAuthExpired]);

  const refresh = async () => {
    try {
      const nextCredentials = await fetchCredentials();
      setCredentials(nextCredentials);
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
      toast.error(message || "加载凭证失败");
      setCredentials([]);
    }
  };

  const resetForm = () => {
    setName("");
    setType("password");
    setValue("");
    setDescription("");
    setIsVisible(true);
    setDictionaryText('{\n  "username": "",\n  "password": ""\n}');
    setCreating(false);
    setEditing(null);
  };

  const parseDictionaryData = (): CredentialDictionaryData | null => {
    try {
      const parsed = JSON.parse(dictionaryText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        toast.error("Dictionary 类型必须是 JSON 对象");
        return null;
      }
      return parsed;
    } catch {
      toast.error("Dictionary JSON 格式不正确");
      return null;
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    let credentialData: CredentialDictionaryData | undefined;
    if (type === "dictionary") {
      credentialData = parseDictionaryData() || undefined;
      if (!credentialData) return;
    } else if (!value.trim()) { toast.error("Value is required"); return; }
    // Check for duplicate names
    if (credentials.some((c) => c.name === name.trim())) {
      toast.error("A credential with this name already exists");
      return;
    }
    try {
      await createCredential({
        name: name.trim(),
        type,
        value,
        description: description.trim(),
        credential_data: credentialData,
        is_visible: isVisible,
      });
      toast.success("Credential created");
      await refresh();
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
    let credentialData: CredentialDictionaryData | undefined;
    if (type === "dictionary" && editing.is_visible) {
      credentialData = parseDictionaryData() || undefined;
      if (!credentialData) return;
    }
    if (type !== "dictionary" && editing.is_visible && !value.trim()) {
      toast.error("Value is required");
      return;
    }
    // Check for duplicate names (excluding self)
    if (credentials.some((c) => c.name === name.trim() && c.id !== editing.id)) {
      toast.error("A credential with this name already exists");
      return;
    }
    try {
      await updateCredential(editing.id, {
        name: name.trim(),
        type,
        value,
        description: description.trim(),
        credential_data: credentialData,
      });
      toast.success("Credential updated");
      await refresh();
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
      await refresh();
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
    setType((cred.type || "text") as Credential["type"]);
    setValue(cred.value || "");
    setDescription(cred.description);
    setIsVisible(cred.is_visible);
    setDictionaryText(
      cred.is_visible ? JSON.stringify(cred.credential_data || {}, null, 2) : '{\n  "username": "",\n  "password": ""\n}'
    );
  };

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setName("");
    setType("password");
    setValue("");
    setDescription("");
    setIsVisible(true);
    setDictionaryText('{\n  "username": "",\n  "password": ""\n}');
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

  const filteredCredentials = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return credentials;

    return credentials.filter((cred) => {
      const searchText = [
        cred.name,
        cred.description,
        cred.type,
        cred.site,
        JSON.stringify(cred.credential_data || {}),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchText.includes(normalizedKeyword);
    });
  }, [credentials, keyword]);

  const pageCount = Math.max(1, Math.ceil(filteredCredentials.length / CREDENTIAL_PAGE_SIZE));

  const pagedCredentials = useMemo(() => {
    const safePage = Math.min(page, pageCount);
    const startIndex = (safePage - 1) * CREDENTIAL_PAGE_SIZE;
    return filteredCredentials.slice(startIndex, startIndex + CREDENTIAL_PAGE_SIZE);
  }, [filteredCredentials, page, pageCount]);

  useEffect(() => {
    setPage(1);
  }, [keyword]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

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
                <Input
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
              {type === "dictionary" ? (
                <div>
                  <label className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Dictionary JSON</label>
                  {editing && !editing.is_visible ? (
                    <div className="min-h-[160px] rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm font-mono text-muted-foreground flex items-center">
                      当前凭证已设置为不可见，现有字典内容不会再明文展示。
                    </div>
                  ) : (
                    <Textarea
                      className="min-h-[160px] font-mono text-sm"
                      value={dictionaryText}
                      onChange={(e) => setDictionaryText(e.target.value)}
                      placeholder='{"username":"demo","password":"123456"}'
                    />
                  )}
                  <p className="text-xs text-muted-foreground/60 font-mono mt-1">
                    可使用 <code className="text-primary/80">{"{{credential:" + (name || "name") + ".username}}"}</code>
                  </p>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Value</label>
                  {editing && !editing.is_visible ? (
                    <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm font-mono text-muted-foreground">
                      当前凭证已设置为不可见，现有值不会再明文展示。
                    </div>
                  ) : (
                    <Input
                      className={inputClass}
                      type={type === "text" ? "text" : "password"}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder="Secret value"
                    />
                  )}
                </div>
              )}
              <div>
                <label className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Description</label>
                <Input
                  className={inputClass}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-mono font-medium text-foreground uppercase tracking-wider">允许查看明文</p>
                    <p className="text-xs text-muted-foreground font-mono mt-1">
                      {editing
                        ? "该选项仅可在创建时设置，创建后不可更改"
                        : "关闭后，创建后将不再允许查看明文，仅执行时参与解析"}
                    </p>
                  </div>
                  <Switch checked={isVisible} onCheckedChange={setIsVisible} disabled={!!editing} />
                </div>
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
            <div className="space-y-3">
              <div className="space-y-2">
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="快速搜索名称、描述、类型或字段内容"
                />
                <div className="text-xs font-mono text-muted-foreground flex items-center justify-between">
                  <span>共 {filteredCredentials.length} 条</span>
                  <span>第 {Math.min(page, pageCount)} / {pageCount} 页</span>
                </div>
              </div>
              {pagedCredentials.map((cred) => (
                <div
                  key={cred.id}
                  className="group flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/30 transition-colors"
                >
                  <KeyRound size={14} className="text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground truncate">{cred.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-secondary text-muted-foreground uppercase">
                        {(cred.type || "text").replace("_", " ")}
                      </span>
                      {!cred.is_visible && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-400 uppercase">
                          hidden
                        </span>
                      )}
                    </div>
                    {cred.description && (
                      <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{cred.description}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      <code className="text-xs font-mono text-muted-foreground/70 truncate">
                        {cred.is_visible
                          ? (visibleIds.has(cred.id) ? (cred.value || "") : maskValue(cred.value || ""))
                          : "创建后已隐藏，不可查看"}
                      </code>
                      {cred.is_visible && (
                        <button
                          onClick={() => toggleVisible(cred.id)}
                          className="p-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          {visibleIds.has(cred.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      )}
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
              {filteredCredentials.length > 0 && (
                <Pagination className="mx-0 w-auto justify-end pt-2">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setPage((current) => Math.max(1, current - 1));
                        }}
                        className={page <= 1 ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                    {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                      <PaginationItem key={pageNumber}>
                        <PaginationLink
                          href="#"
                          isActive={pageNumber === page}
                          onClick={(e) => {
                            e.preventDefault();
                            setPage(pageNumber);
                          }}
                        >
                          {pageNumber}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setPage((current) => Math.min(pageCount, current + 1));
                        }}
                        className={page >= pageCount ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        {!showForm && credentials.length > 0 && (
          <div className="px-5 py-3 border-t border-border shrink-0">
            <p className="text-xs text-muted-foreground/60 font-mono text-left">
              使用<code className="text-primary/70">{"{{credential:name}}"}</code> 在节点中插入敏感信息
            </p>
            <p className="text-xs text-muted-foreground/50 font-mono text-left mt-1">
              字典类型可用 <code className="text-primary/70">{"{{credential:name.key}}"}</code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CredentialsManager;
