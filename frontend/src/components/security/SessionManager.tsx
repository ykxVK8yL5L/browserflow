import { useState, useEffect } from "react";
import { getUserSessions, revokeSession, revokeAllOtherSessions, cleanRevokedSessions, type Session } from "@/lib/authStore";
import { Monitor, Trash2, LogOut, Loader2 } from "lucide-react";

const SessionManager = ({ userId, currentSessionId }: { userId: string; currentSessionId: string }) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const data = await getUserSessions();
    setSessions(data);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, [userId]);

  const handleRevoke = async (id: string) => {
    await revokeSession(id);
    await refresh();
    if (id === currentSessionId) window.location.reload();
  };

  const handleRevokeAll = async () => {
    await revokeAllOtherSessions(userId, currentSessionId);
    await refresh();
  };

  const handleCleanRevoked = async () => {
    await cleanRevokedSessions();
    await refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  const activeSessions = sessions.filter((s) => s.active);
  const inactiveSessions = sessions.filter((s) => !s.active);

  const formatAgent = (ua?: string) => {
    if (!ua) return "Browser";
    if (ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Safari")) return "Safari";
    return "Browser";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor size={16} className="text-primary" />
          <span className="font-mono text-sm font-bold text-foreground">Active Sessions</span>
          <span className="text-xs font-mono bg-primary/20 text-primary px-1.5 py-0.5 rounded">{activeSessions.length}</span>
        </div>
        {activeSessions.length > 1 && (
          <button
            onClick={handleRevokeAll}
            className="text-xs font-mono text-destructive hover:underline flex items-center gap-1"
          >
            <LogOut size={12} /> Revoke others
          </button>
        )}
      </div>

      <div className="space-y-2">
        {activeSessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between bg-background border border-border rounded-md p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono text-foreground">{formatAgent(s.user_agent || s.userAgent)}</p>
                {s.id === currentSessionId && (
                  <span className="text-xs font-mono bg-primary/20 text-primary px-1.5 py-0.5 rounded">Current</span>
                )}
              </div>
              <p className="text-xs font-mono text-muted-foreground">
                Last active: {new Date(s.last_active || s.lastActive || '').toLocaleString()}
              </p>
            </div>
            {s.id !== currentSessionId && (
              <button
                onClick={() => handleRevoke(s.id)}
                className="p-2 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {inactiveSessions.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs font-mono text-muted-foreground">
              Revoked Sessions ({inactiveSessions.length})
            </p>
            <button
              onClick={handleCleanRevoked}
              className="text-xs font-mono text-muted-foreground hover:text-destructive transition-colors"
            >
              Clean up
            </button>
          </div>
          <div className="space-y-1">
            {inactiveSessions.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-background/50 border border-border/50 rounded-md p-2 opacity-60">
                <div>
                  <p className="text-xs font-mono text-foreground">{formatAgent(s.user_agent || s.userAgent)}</p>
                  <p className="text-xs font-mono text-muted-foreground">
                    {new Date(s.created_at || s.createdAt || '').toLocaleDateString()}
                  </p>
                </div>
                <span className="text-xs font-mono text-destructive">Revoked</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default SessionManager;
