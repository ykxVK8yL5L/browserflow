import { useState, useEffect } from "react";
import {
  getUserApiKeys,
  createApiKey,
  revokeApiKey,
  deleteApiKey,
  type ApiKey,
} from "@/lib/authStore";
import { Key, Trash2, Copy, Plus, Trash } from "lucide-react";

const ApiKeyManager = ({ userId }: { userId: string }) => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("30");
  const [newKey, setNewKey] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const fetchedKeys = await getUserApiKeys();
      setKeys(fetchedKeys);
    } catch (error) {
      console.error("Failed to fetch API keys:", error);
      setKeys([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const days = expiry === "never" ? null : parseInt(expiry);
    const result = await createApiKey(userId, name.trim(), days);
    if (result) {
      setNewKey(result.key);
      setName("");
      setShowCreate(false);
      refresh();
    }
  };

  const handleRevoke = async (id: string) => {
    await revokeApiKey(id);
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteApiKey(id);
    refresh();
  };

  const handleCleanup = async () => {
    // 删除所有已撤销或已过期的 keys
    const keysToDelete = keys.filter((k) => k.revoked || isExpired(k));
    for (const k of keysToDelete) {
      await deleteApiKey(k.id);
    }
    refresh();
  };

  const isExpired = (k: ApiKey) => k.expiresAt && new Date(k.expiresAt) < new Date();

  const hasRevokedOrExpiredKeys = keys.some((k) => k.revoked || isExpired(k));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key size={16} className="text-primary" />
          <span className="font-mono text-sm font-bold text-foreground">API Keys</span>
        </div>
        <div className="flex items-center gap-2">
          {hasRevokedOrExpiredKeys && !loading && (
            <button
              onClick={handleCleanup}
              className="text-xs font-mono text-muted-foreground hover:text-destructive flex items-center gap-1"
            >
              <Trash size={12} />
              Cleanup
            </button>
          )}
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="text-xs font-mono text-primary hover:underline flex items-center gap-1"
          >
            <Plus size={12} /> New Key
          </button>
        </div>
      </div>
      <p className="text-xs font-mono text-muted-foreground">
        API keys can be used to authenticate API requests. They support expiration and can be
        revoked.
      </p>
      {newKey && (
        <div className="bg-primary/10 border border-primary/30 rounded-md p-3">
          <p className="text-xs font-mono text-primary mb-2">
            Copy your new API key now — it won't be shown again:
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-foreground bg-background rounded px-2 py-1 flex-1 break-all">
              {newKey}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(newKey);
              }}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <Copy size={14} />
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="mt-2 text-xs font-mono text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}
      {showCreate && (
        <div className="bg-background border border-border rounded-md p-3 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g., CI/CD)"
            className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <select
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-card border border-border text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="7">Expires in 7 days</option>
            <option value="30">Expires in 30 days</option>
            <option value="90">Expires in 90 days</option>
            <option value="365">Expires in 1 year</option>
            <option value="never">No expiration</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="flex-1 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-mono font-medium hover:opacity-90"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {loading ? (
          <p className="text-xs font-mono text-muted-foreground text-center py-4">
            Loading API keys...
          </p>
        ) : keys.length === 0 ? (
          <p className="text-xs font-mono text-muted-foreground text-center py-4">
            No API keys created yet.
          </p>
        ) : (
          keys.map((k) => (
            <div
              key={k.id}
              className={`flex items-center justify-between bg-background border border-border rounded-md p-3 ${k.revoked || isExpired(k) ? "opacity-50" : ""
                }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-mono text-foreground">{k.name}</p>
                  {k.revoked && (
                    <span className="text-xs font-mono bg-destructive/20 text-destructive px-1.5 py-0.5 rounded">
                      Revoked
                    </span>
                  )}
                  {isExpired(k) && !k.revoked && (
                    <span className="text-xs font-mono bg-destructive/20 text-destructive px-1.5 py-0.5 rounded">
                      Expired
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-muted-foreground">
                  {k.keyPrefix} · Created {new Date(k.createdAt).toLocaleDateString()}
                  {k.expiresAt && ` · Expires ${new Date(k.expiresAt).toLocaleDateString()}`}
                </p>
                {k.lastUsed && (
                  <p className="text-xs font-mono text-muted-foreground">
                    Last used: {new Date(k.lastUsed).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!k.revoked && !isExpired(k) && (
                  <button
                    onClick={() => handleRevoke(k.id)}
                    className="p-2 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                {(k.revoked || isExpired(k)) && (
                  <button
                    onClick={() => handleDelete(k.id)}
                    className="p-2 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete this key"
                  >
                    <Trash size={14} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ApiKeyManager;
