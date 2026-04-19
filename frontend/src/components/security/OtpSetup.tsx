import { useState, useEffect, useCallback } from "react";
import {
  getCurrentUser,
  setupOtp,
  confirmOtpSetup,
  resetOtp,
} from "@/lib/authStore";
import type { User } from "@/lib/authStore";
import {
  Shield,
  ShieldCheck,
  RefreshCw,
  Copy,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";

const OtpSetup = ({ userId }: { userId: string }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupData, setSetupData] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetError, setResetError] = useState("");
  const [showDemo, setShowDemo] = useState(false);
  const [demoCode, setDemoCode] = useState("------");
  const [actionLoading, setActionLoading] = useState(false);

  // 加载用户信息
  const loadUser = useCallback(async () => {
    setLoading(true);
    const u = await getCurrentUser();
    setUser(u);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // 本地计算 OTP 演示代码 (TOTP 算法简化版)
  useEffect(() => {
    if (showDemo && setupData?.secret) {
      const calcOtp = () => {
        const counter = Math.floor(Date.now() / 30000);
        const secret = setupData.secret;
        let hash = 0;
        const combined = secret + counter.toString();
        for (let i = 0; i < combined.length; i++) {
          hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
        }
        const otp = Math.abs(hash % 1000000).toString().padStart(6, "0");
        setDemoCode(otp);
      };
      calcOtp();
      const iv = setInterval(calcOtp, 1000);
      return () => clearInterval(iv);
    }
  }, [showDemo, setupData]);

  const startSetup = async () => {
    setActionLoading(true);
    setError("");
    const data = await setupOtp(userId);
    if (data) {
      setSetupData(data);
    } else {
      setError("无法启动 OTP 设置");
    }
    setActionLoading(false);
  };

  const confirmSetup = async () => {
    if (!setupData) return;
    setActionLoading(true);
    setError("");
    const res = await confirmOtpSetup(userId, setupData.secret, code);
    if (res.ok) {
      // 只有首次设置才显示恢复码，重置后重新绑定不显示
      setRecoveryCodes(res.firstSetup ? (res.recoveryCodes || null) : null);
      setSetupData(null);
      setCode("");
      await loadUser();
    } else {
      setError(res.error || "验证失败");
    }
    setActionLoading(false);
  };

  const handleReset = async () => {
    if (!resetPassword || !resetCode) {
      setResetError("请输入当前密码和恢复码");
      return;
    }
    setActionLoading(true);
    setResetError("");
    const res = await resetOtp(userId, resetPassword, resetCode);
    if (res.ok && res.secret && res.uri && res.qr) {
      // 重置成功，显示新的 OTP 设置信息
      setSetupData({ secret: res.secret, uri: res.uri, qr: res.qr });
      setResetPassword("");
      setResetCode("");
      setResetError("");
    } else {
      setResetError(res.error || "重置失败");
    }
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (!user) return null;

  // 优先显示设置流程（重置后需要重新绑定）
  if (setupData) {
    return (
      <div className="space-y-3">
        <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3">
          <p className="text-xs font-mono text-green-500">
            ✓ 2FA 重置成功！请扫描新的二维码重新绑定验证器
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-primary" />
          <span className="font-mono text-sm font-bold text-foreground">
            重新绑定 2FA
          </span>
        </div>
        <div className="bg-background border border-border rounded-md p-3">
          <code className="text-xs font-mono text-foreground break-all">
            {setupData.secret}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(setupData.secret);
            }}
            className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors mt-1"
          >
            <Copy size={12} />
            复制密钥
          </button>
        </div>
        <div className="flex justify-center">
          <img
            src={setupData.qr}
            alt="OTP QR Code"
            className="w-40 h-40 border border-border rounded-md"
          />
        </div>
        <p className="text-xs font-mono text-muted-foreground">
          扫描二维码或手动输入密钥，然后输入验证器显示的 6 位代码：
        </p>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          maxLength={6}
          className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground text-center tracking-widest placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {error && (
          <p className="text-xs font-mono text-destructive">{error}</p>
        )}
        <button
          onClick={confirmSetup}
          disabled={actionLoading || code.length !== 6}
          className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50"
        >
          {actionLoading ? (
            <Loader2 className="animate-spin mx-auto" size={14} />
          ) : (
            "确认绑定"
          )}
        </button>
      </div>
    );
  }

  // 显示恢复码
  if (recoveryCodes) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck size={16} />
          <span className="font-mono text-sm font-bold">2FA 已启用!</span>
        </div>
        <p className="text-xs font-mono text-muted-foreground">
          请安全保存这些恢复码。每个恢复码只能使用一次，用于在丢失验证器时访问您的账户。
        </p>
        <div className="bg-background border border-border rounded-md p-3 grid grid-cols-2 gap-1">
          {recoveryCodes.map((c) => (
            <code key={c} className="text-xs font-mono text-foreground">
              {c}
            </code>
          ))}
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(recoveryCodes.join("\n"));
          }}
          className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          <Copy size={12} />
          复制全部
        </button>
        <button
          onClick={() => setRecoveryCodes(null)}
          className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90"
        >
          完成
        </button>
      </div>
    );
  }

  // OTP 已启用
  if (user.otpEnabled) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck size={16} />
          <span className="font-mono text-sm font-bold">双因素认证已开启</span>
        </div>
        <p className="text-xs font-mono text-muted-foreground">
          登录时需要使用验证器应用生成的一次性代码。
        </p>
        <div className="border-t border-border pt-4">
          <p className="text-xs font-mono text-muted-foreground mb-2">
            输入密码或恢复码以重置 2FA（旧设备遗失时使用）：
          </p>
          <input
            type="password"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            placeholder="登录密码"
            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-2"
          />
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs font-mono text-muted-foreground">和</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <input
            type="text"
            value={resetCode}
            onChange={(e) => setResetCode(e.target.value)}
            placeholder="恢复码"
            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {resetError && (
            <p className="text-xs font-mono text-destructive mt-1">
              {resetError}
            </p>
          )}
          <button
            onClick={handleReset}
            disabled={actionLoading || (!resetPassword && !resetCode)}
            className="w-full mt-2 px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {actionLoading ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
            重置 2FA
          </button>
        </div>
      </div>
    );
  }

  // 设置流程
  if (setupData) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-primary" />
          <span className="font-mono text-sm font-bold text-foreground">
            设置 2FA
          </span>
        </div>
        <p className="text-xs font-mono text-muted-foreground">
          将此密钥添加到您的验证器应用（如 Google Authenticator、Authy 等）：
        </p>
        <div className="bg-background border border-border rounded-md p-3">
          <code className="text-xs font-mono text-foreground break-all">
            {setupData.secret}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(setupData.secret)}
            className="ml-2 text-muted-foreground hover:text-foreground"
          >
            <Copy size={12} />
          </button>
        </div>

        {/* QR Code URI 链接 */}
        <div className="text-center">
          <a
            href={setupData.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-primary hover:underline"
          >
            或点击此处打开验证器应用
          </a>
        </div>

        <button
          onClick={() => setShowDemo(!showDemo)}
          className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground"
        >
          {showDemo ? <EyeOff size={12} /> : <Eye size={12} />}
          {showDemo ? "隐藏演示代码" : "显示演示代码（测试用）"}
        </button>

        {showDemo && (
          <div className="bg-background border border-primary/30 rounded-md p-3 text-center">
            <p className="text-xs font-mono text-muted-foreground mb-1">
              当前 OTP 代码：
            </p>
            <code className="text-2xl font-mono font-bold text-primary tracking-[0.3em]">
              {demoCode}
            </code>
          </div>
        )}

        <div>
          <label className="text-xs font-mono text-muted-foreground block mb-1">
            输入代码以验证：
          </label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            maxLength={6}
            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground text-center tracking-widest placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {error && <p className="text-xs font-mono text-destructive">{error}</p>}

        <button
          onClick={confirmSetup}
          disabled={actionLoading || !code}
          className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50"
        >
          {actionLoading ? "验证中..." : "验证并启用"}
        </button>

        <button
          onClick={() => {
            setSetupData(null);
            setCode("");
            setError("");
          }}
          className="w-full text-xs font-mono text-muted-foreground hover:text-foreground"
        >
          取消
        </button>
      </div>
    );
  }

  // 默认状态
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Shield size={16} className="text-muted-foreground" />
        <span className="font-mono text-sm font-bold text-foreground">
          双因素认证
        </span>
      </div>
      <p className="text-xs font-mono text-muted-foreground">
        为您的账户添加额外的安全层，登录时需要一次性代码验证。
      </p>
      <button
        onClick={startSetup}
        disabled={actionLoading}
        className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50"
      >
        {actionLoading ? "加载中..." : "启用 2FA"}
      </button>
    </div>
  );
};

export default OtpSetup;
