import { useState, useEffect, useCallback } from "react";
import {
  getCurrentUser,
  getRecoveryCodes,
  regenerateRecoveryCodes,
} from "@/lib/authStore";
import type { User } from "@/lib/authStore";
import { LifeBuoy, Copy, RefreshCw, Loader2 } from "lucide-react";
import { RECOVERY_CODES_STATUS_CHANGED_EVENT } from "./RecoveryCodeLowAlert";

const RecoveryCodesView = ({ userId }: { userId: string }) => {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<{ total: number; usedCodes: string[]; available: number } | null>(null);
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    const [userData, codesData] = await Promise.all([
      getCurrentUser(),
      getRecoveryCodes(userId),
    ]);
    setUser(userData);
    setData(codesData);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 重新生成恢复码
  const handleRegenerate = async () => {
    if (!confirm("确定要重新生成恢复码吗？旧的恢复码将全部失效。")) return;

    setActionLoading(true);
    const otpCode = prompt("请输入 OTP 代码或恢复码以验证：");
    if (!otpCode) {
      setActionLoading(false);
      return;
    }

    const codes = await regenerateRecoveryCodes(userId, otpCode);
    if (codes) {
      setGeneratedCodes(codes);
      setData({ total: codes.length, usedCodes: [], available: codes.length });
      window.dispatchEvent(new Event(RECOVERY_CODES_STATUS_CHANGED_EVENT));
    } else {
      alert("验证失败，无法重新生成恢复码");
    }
    setActionLoading(false);
  };

  const handleDownloadCodes = () => {
    if (!generatedCodes || generatedCodes.length === 0) return;

    const content = [
      "BrowserFlow Recovery Codes",
      "",
      "请妥善保管这些恢复码。每个恢复码只能使用一次。",
      `生成时间: ${new Date().toLocaleString()}`,
      "",
      ...generatedCodes.map((code, index) => `${index + 1}. ${code}`),
      "",
      "重要：这些恢复码只会显示一次。",
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `browserflow-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (!user?.otpEnabled) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <LifeBuoy size={16} className="text-muted-foreground" />
          <span className="font-mono text-sm font-bold text-foreground">
            恢复码
          </span>
        </div>
        <p className="text-xs font-mono text-muted-foreground">
          请先启用双因素认证以生成恢复码。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LifeBuoy size={16} className="text-primary" />
          <span className="font-mono text-sm font-bold text-foreground">
            恢复码
          </span>
        </div>
        <button
          onClick={handleRegenerate}
          disabled={actionLoading}
          className="text-xs font-mono text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
        >
          {actionLoading ? (
            <Loader2 className="animate-spin" size={12} />
          ) : (
            <RefreshCw size={12} />
          )}
          重新生成
        </button>
      </div>

      <p className="text-xs font-mono text-muted-foreground">
        如果您丢失了验证器，可以使用这些恢复码访问您的账户。每个恢复码只能使用一次。
      </p>
      {generatedCodes && (
        <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs font-mono text-foreground">
            新恢复码仅显示这一次，请立即保存。
          </p>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-3">
            {generatedCodes.map((code) => (
              <code key={code} className="text-xs font-mono text-foreground">
                {code}
              </code>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigator.clipboard.writeText(generatedCodes.join("\n"))}
              className="flex items-center gap-1 text-xs font-mono text-primary hover:underline"
            >
              <Copy size={12} />
              复制全部
            </button>
            <button
              onClick={handleDownloadCodes}
              className="text-xs font-mono text-primary hover:underline"
            >
              下载到本地
            </button>
            <button
              onClick={() => setGeneratedCodes(null)}
              className="text-xs font-mono text-muted-foreground hover:text-foreground"
            >
              我已保存
            </button>
          </div>
        </div>
      )}
      {data && (
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-muted-foreground">可用恢复码:</span>
          <span className="text-primary font-bold">
            {data.available} / {data.total}
          </span>
        </div>
      )}
      {!generatedCodes && (
        <p className="text-xs font-mono text-muted-foreground">
          为安全起见，恢复码只会在生成时显示一次，之后不会再次展示明文。
        </p>
      )}
    </div>
  );
};

export default RecoveryCodesView;
