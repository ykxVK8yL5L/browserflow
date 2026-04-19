import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getAuthSettings,
  hasAnyUsers,
  verifyLoginOtp,
  loginWithPasskey,
} from "@/lib/authStore";
import type { AuthSettings } from "@/lib/authStore";
import {
  Workflow,
  LogIn,
  UserPlus,
  KeyRound,
  Fingerprint,
  Mail,
  Github,
  Chrome,
  ArrowLeft,
  HelpCircle,
  Lock,
} from "lucide-react";

type Stage = "login" | "register" | "otp" | "forgot-password";
type LoginMethod = "password" | "email" | "passkey";

const AuthPage = () => {
  const { login, register } = useAuth();
  const [settings, setSettings] = useState<AuthSettings>({
    registrationEnabled: true,
    passkeyLoginEnabled: false,
    otpRequired: true,
  });
  const [noUsers, setNoUsers] = useState(false);

  // 表单状态
  const [stage, setStage] = useState<Stage>("login");
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [pendingUserId, setPendingUserId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // OAuth 提供商配置（预留）
  const oauthProviders = [
    { id: "github", name: "GitHub", icon: Github, enabled: false },
    { id: "google", name: "Google", icon: Chrome, enabled: false },
  ];
  const enabledOAuthProviders = oauthProviders.filter((p) => p.enabled);

  // 初始化
  useEffect(() => {
    const loadSettings = async () => {
      const [settingsRes, hasUsersRes] = await Promise.all([
        getAuthSettings(),
        hasAnyUsers(),
      ]);
      setSettings(settingsRes);
      setNoUsers(!hasUsersRes);
      // 如果没有用户，跳转到注册
      if (!hasUsersRes) {
        setStage("register");
      }
    };
    loadSettings();
  }, []);

  // 用户名密码登录
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await login(username, password);
    setLoading(false);
    if (res.requiresOtp && res.userId) {
      setPendingUserId(res.userId);
      setStage("otp");
      return;
    }
    if (!res.ok) setError(res.error || "登录失败");
  };

  // 邮箱密码登录
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    if (!email.trim()) {
      setError("请输入邮箱地址");
      setLoading(false);
      return;
    }
    if (!password.trim()) {
      setError("请输入密码");
      setLoading(false);
      return;
    }
    const res = await login(email, password);
    setLoading(false);
    if (res.requiresOtp && res.userId) {
      setPendingUserId(res.userId);
      setStage("otp");
      return;
    }
    if (!res.ok) setError(res.error || "登录失败");
  };

  // Passkey 登录
  const handlePasskeyLogin = async () => {
    setError("");
    setLoading(true);
    // 快速登录模式：不传用户名
    const res = await loginWithPasskey(username.trim() || undefined);
    setLoading(false);
    if (res.requiresOtp && res.userId) {
      setPendingUserId(res.userId);
      setStage("otp");
      return;
    }
    if (res.ok) {
      window.location.reload();
    } else {
      setError(res.error || "Passkey 登录失败");
    }
  };

  // OTP 验证
  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await verifyLoginOtp(pendingUserId, otpCode);
    setLoading(false);
    if (res.ok) {
      window.location.reload();
    } else {
      setError(res.error || "验证码错误");
    }
  };

  // 注册
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await register(username, password);
    setLoading(false);
    if (!res.ok) setError(res.error || "注册失败");
  };

  // OAuth 登录（预留接口）
  const handleOAuthLogin = (provider: string) => {
    // TODO: 实现 OAuth 登录
    setError(`${provider} 登录功能开发中`);
  };

  // 渲染 Logo
  const renderLogo = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      <Workflow size={28} className="text-primary" />
      <h1 className="font-mono font-bold text-xl text-foreground">
        BrowserFlow
      </h1>
    </div>
  );

  // 渲染 OTP 验证页面
  if (stage === "otp") {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {renderLogo()}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-mono font-bold text-sm text-foreground mb-1 flex items-center gap-2">
              <KeyRound size={16} />
              双因素认证
            </h2>
            <p className="text-xs text-muted-foreground font-mono mb-4">
              请输入验证器应用的 6 位数字代码，或使用恢复码
            </p>
            <form onSubmit={handleOtpSubmit} className="space-y-3">
              <input
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="000000 或恢复码"
                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground text-center tracking-widest placeholder:text-muted-foreground placeholder:tracking-normal focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
                maxLength={9}
              />
              {error && (
                <p className="text-xs font-mono text-destructive">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? "验证中..." : "验证"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStage("login");
                  setOtpCode("");
                  setError("");
                }}
                className="w-full text-xs font-mono text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
              >
                <ArrowLeft size={14} />
                返回登录
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // 渲染注册页面
  if (stage === "register") {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {renderLogo()}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-mono font-bold text-sm text-foreground mb-1 flex items-center gap-2">
              <UserPlus size={16} />
              {noUsers ? "创建管理员账户" : "注册新账户"}
            </h2>
            {noUsers && (
              <p className="text-xs text-muted-foreground font-mono mb-4">
                系统暂无用户，请创建第一个管理员账户
              </p>
            )}
            <form onSubmit={handleRegister} className="space-y-3 mt-4">
              <div>
                <label className="text-xs font-mono text-muted-foreground block mb-1">
                  用户名
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="text-xs font-mono text-muted-foreground block mb-1">
                  密码
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>
              {error && (
                <p className="text-xs font-mono text-destructive">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? "注册中..." : "注册"}
              </button>
            </form>
            {!noUsers && (
              <button
                onClick={() => {
                  setStage("login");
                  setError("");
                }}
                className="w-full mt-3 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
              >
                <ArrowLeft size={14} />
                已有账户？返回登录
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 渲染找回密码页面
  if (stage === "forgot-password") {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {renderLogo()}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-mono font-bold text-sm text-foreground mb-1 flex items-center gap-2">
              <HelpCircle size={16} />
              找回密码
            </h2>
            <p className="text-xs text-muted-foreground font-mono mb-4">
              请输入注册时使用的邮箱，我们将发送密码重置链接
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                setLoading(true);
                // TODO: 调用找回密码 API
                await new Promise((r) => setTimeout(r, 1000));
                setLoading(false);
                setError("找回密码功能开发中");
              }}
              className="space-y-3"
            >
              <div>
                <label className="text-xs font-mono text-muted-foreground block mb-1">
                  邮箱地址
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  required
                />
              </div>
              {error && (
                <p className="text-xs font-mono text-destructive">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? "发送中..." : "发送重置链接"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStage("login");
                  setEmail("");
                  setError("");
                }}
                className="w-full text-xs font-mono text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
              >
                <ArrowLeft size={14} />
                返回登录
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // 渲染登录页面
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {renderLogo()}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="font-mono font-bold text-sm text-foreground mb-4 flex items-center gap-2">
            <LogIn size={16} />
            登录到 BrowserFlow
          </h2>

          {/* 登录方式切换 */}
          <div className="flex gap-1 mb-4 p-1 bg-muted rounded-md">
            <button
              type="button"
              onClick={() => setLoginMethod("password")}
              className={`flex-1 px-3 py-1.5 text-xs font-mono rounded transition-colors ${loginMethod === "password"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              用户名
            </button>
            <button
              type="button"
              onClick={() => setLoginMethod("email")}
              className={`flex-1 px-3 py-1.5 text-xs font-mono rounded transition-colors ${loginMethod === "email"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              邮箱
            </button>
            {settings.passkeyLoginEnabled && (
              <button
                type="button"
                onClick={() => setLoginMethod("passkey")}
                className={`flex-1 px-3 py-1.5 text-xs font-mono rounded transition-colors ${loginMethod === "passkey"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                Passkey
              </button>
            )}
          </div>

          {/* 用户名密码登录 */}
          {loginMethod === "password" && (
            <form onSubmit={handlePasswordLogin} className="space-y-3">
              <div>
                <label className="text-xs font-mono text-muted-foreground block mb-1">
                  用户名
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="text-xs font-mono text-muted-foreground block mb-1">
                  密码
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>
              {error && (
                <p className="text-xs font-mono text-destructive">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? "登录中..." : "登录"}
              </button>
            </form>
          )}

          {/* 邮箱登录 */}
          {loginMethod === "email" && (
            <form onSubmit={handleEmailLogin} className="space-y-3">
              <div>
                <label className="text-xs font-mono text-muted-foreground block mb-1">
                  邮箱地址
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="text-xs font-mono text-muted-foreground block mb-1">
                  密码
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>
              {error && (
                <p className="text-xs font-mono text-destructive">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Lock size={14} />
                {loading ? "登录中..." : "登录"}
              </button>
            </form>
          )}

          {/* Passkey 登录 */}
          {loginMethod === "passkey" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground font-mono text-center">
                使用 Passkey 安全快速登录，无需输入密码
              </p>
              {/* <div>
                <label className="text-xs font-mono text-muted-foreground block mb-1">
                  用户名（可选）
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="留空则使用快速登录"
                  className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div> */}
              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={loading}
                className="w-full px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Fingerprint size={16} />
                {loading ? "验证中..." : username.trim() ? "使用 Passkey 登录" : "快速登录"}
              </button>
              {error && (
                <p className="text-xs font-mono text-destructive">{error}</p>
              )}
            </div>
          )}

          {/* 分隔线 */}
          {enabledOAuthProviders.length > 0 && (
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-2 text-muted-foreground font-mono">
                  或使用
                </span>
              </div>
            </div>
          )}

          {/* OAuth 登录按钮 */}
          {enabledOAuthProviders.length > 0 && (
            <div className="space-y-2">
              {enabledOAuthProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => handleOAuthLogin(provider.id)}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm font-mono font-medium hover:bg-muted transition-colors flex items-center justify-center gap-2"
                >
                  <provider.icon size={16} />
                  使用 {provider.name} 登录
                </button>
              ))}
            </div>
          )}

          {/* 底部链接 */}
          <div className="mt-4 flex justify-between text-xs font-mono">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/recovery";
              }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              忘记密码？
            </button>
            {settings.registrationEnabled && (
              <button
                type="button"
                onClick={() => {
                  setStage("register");
                  setError("");
                }}
                className="text-primary hover:opacity-80 transition-opacity"
              >
                注册新账户
              </button>
            )}
          </div>
        </div>

        {/* 底部提示 */}
        <p className="mt-4 text-center text-xs font-mono text-muted-foreground">
          登录即表示您同意我们的服务条款和隐私政策
        </p>
      </div>
    </div>
  );
};

export default AuthPage;
