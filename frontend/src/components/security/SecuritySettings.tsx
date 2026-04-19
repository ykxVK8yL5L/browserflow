import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { changePassword, getCurrentUser } from "@/lib/authStore";
import type { User } from "@/lib/authStore";
import OtpSetup from "./OtpSetup";
import PasskeyManager from "./PasskeyManager";
import SessionManager from "./SessionManager";
import ApiKeyManager from "./ApiKeyManager";
import RecoveryCodesView from "./RecoveryCodesView";
import EmailBind from "./EmailBind";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "password" | "otp" | "passkey" | "sessions" | "apikeys" | "recovery" | "email";

const tabs: { id: Tab; label: string }[] = [
  { id: "password", label: "Password" },
  { id: "otp", label: "2FA / OTP" },
  { id: "email", label: "Email" },
  { id: "passkey", label: "Passkey" },
  { id: "sessions", label: "Sessions" },
  { id: "apikeys", label: "API Keys" },
  { id: "recovery", label: "Recovery" },
];

const SecuritySettings = ({ open, onClose }: Props) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("password");
  const [userInfo, setUserInfo] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdSuccess, setPwdSuccess] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdOtpRequired, setPwdOtpRequired] = useState(false);
  const [pwdOtpCode, setPwdOtpCode] = useState("");

  const resetPasswordForm = () => {
    setCurrentPwd("");
    setNewPwd("");
    setConfirmPwd("");
    setPwdError("");
    setPwdSuccess("");
    setPwdLoading(false);
    setPwdOtpRequired(false);
    setPwdOtpCode("");
  };

  // 加载用户信息（包含邮箱）
  useEffect(() => {
    if (open && tab === "email") {
      setLoading(true);
      getCurrentUser()
        .then((u) => setUserInfo(u))
        .finally(() => setLoading(false));
    }
  }, [open, tab]);

  const handleEmailBound = () => {
    // 重新获取用户信息
    setLoading(true);
    getCurrentUser()
      .then((u) => setUserInfo(u))
      .finally(() => setLoading(false));
  };

  const handleClose = () => {
    resetPasswordForm();
    setTab("password");
    onClose();
  };

  if (!open || !user) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="bg-card border border-border rounded-lg w-full max-w-4xl h-[min(85vh,720px)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h3 className="font-mono font-bold text-sm text-foreground">
            Security Settings
          </h3>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-secondary text-muted-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-wrap gap-x-1 gap-y-1 border-b border-border shrink-0 px-2 py-2 sm:px-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-2 text-xs font-mono whitespace-nowrap transition-colors ${tab === t.id
                ? "bg-secondary text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {tab === "password" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-4 space-y-2">
                <p className="text-sm font-mono text-foreground">修改密码</p>
                <p className="text-xs font-mono text-muted-foreground">
                  这里是当前账号的个人安全设置，不影响平台级认证策略。
                </p>
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="space-y-2">
                  <input
                    type="password"
                    value={currentPwd}
                    onChange={(e) => setCurrentPwd(e.target.value)}
                    placeholder="Current password"
                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="password"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    placeholder="New password"
                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="password"
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  {pwdOtpRequired && (
                    <input
                      type="text"
                      value={pwdOtpCode}
                      onChange={(e) =>
                        setPwdOtpCode(e.target.value.replace(/\s/g, ""))
                      }
                      placeholder="OTP code (or recovery code)"
                      maxLength={11}
                      className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  )}
                  {pwdError && (
                    <p className="text-xs font-mono text-destructive">{pwdError}</p>
                  )}
                  {pwdSuccess && (
                    <p className="text-xs font-mono text-primary">{pwdSuccess}</p>
                  )}
                  <button
                    disabled={pwdLoading}
                    onClick={async () => {
                      setPwdError("");
                      setPwdSuccess("");
                      if (newPwd !== confirmPwd) {
                        setPwdError("Passwords do not match");
                        return;
                      }
                      setPwdLoading(true);
                      const res = await changePassword(
                        user.userId,
                        currentPwd,
                        newPwd,
                        pwdOtpRequired ? pwdOtpCode : undefined,
                      );
                      setPwdLoading(false);
                      if (res.ok) {
                        setPwdSuccess("Password changed successfully");
                        setCurrentPwd("");
                        setNewPwd("");
                        setConfirmPwd("");
                        setPwdOtpCode("");
                        setPwdOtpRequired(false);
                      } else if (res.otpRequired) {
                        setPwdOtpRequired(true);
                        setPwdError("Please enter your OTP code");
                      } else {
                        setPwdError(res.error || "Failed");
                      }
                    }}
                    className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {pwdLoading
                      ? "..."
                      : pwdOtpRequired
                        ? "Verify & Update"
                        : "Update Password"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {tab === "otp" && <OtpSetup userId={user.userId} />}
          {tab === "email" && (
            loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : userInfo?.email && userInfo?.emailVerified ? (
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-muted-foreground">
                      已绑定邮箱:
                    </span>
                    <span className="text-sm font-mono text-foreground">
                      {userInfo.email}
                    </span>
                  </div>
                  <button
                    onClick={() => setUserInfo(null)}
                    className="px-3 py-1 text-xs font-mono text-muted-foreground hover:text-foreground border border-border rounded hover:bg-secondary transition-colors"
                  >
                    换绑
                  </button>
                </div>
              </div>
            ) : (
              <EmailBind onComplete={handleEmailBound} />
            )
          )}
          {tab === "passkey" && <PasskeyManager userId={user.userId} />}
          {tab === "sessions" && (
            <SessionManager userId={user.userId} currentSessionId={user.sessionId} />
          )}
          {tab === "apikeys" && <ApiKeyManager userId={user.userId} />}
          {tab === "recovery" && <RecoveryCodesView userId={user.userId} />}
        </div>
      </div>
    </div>
  );
};

export default SecuritySettings;
