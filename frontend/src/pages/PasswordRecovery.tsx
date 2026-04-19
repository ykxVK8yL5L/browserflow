import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    startPasswordRecovery,
    sendRecoveryEmailCode,
    verifyPasswordRecovery,
    startRecoveryOtpReset,
    confirmRecoveryOtpReset,
    resetPassword,
    type RecoveryMethods,
} from "@/lib/authStore";
import { ArrowLeft, Mail, Key, Smartphone, Shield, Lock } from "lucide-react";

type Step = "username" | "methods" | "verify" | "action" | "reset" | "resetOtp" | "done";

const PasswordRecovery = () => {
    const navigate = useNavigate();
    const [step, setStep] = useState<Step>("username");
    const [username, setUsername] = useState("");
    const [methods, setMethods] = useState<RecoveryMethods | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // 验证方式选择
    const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
    const [emailCode, setEmailCode] = useState("");
    const [otpCode, setOtpCode] = useState("");
    const [recoveryCode, setRecoveryCode] = useState("");
    const [oldPassword, setOldPassword] = useState("");
    const [verificationToken, setVerificationToken] = useState("");
    const [resetMessage, setResetMessage] = useState("");
    const [doneTitle, setDoneTitle] = useState("操作已完成");
    const [doneHint, setDoneHint] = useState("请返回登录");

    // 新密码
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [otpSetupData, setOtpSetupData] = useState<{ secret: string; uri: string; qr: string } | null>(null);
    const [newOtpCode, setNewOtpCode] = useState("");
    const [copySuccess, setCopySuccess] = useState(false);

    // 开发环境验证码
    const [devCode, setDevCode] = useState("");

    const handleStartRecovery = async () => {
        if (!username.trim()) {
            setError("请输入用户名");
            return;
        }
        setLoading(true);
        setError("");
        const res = await startPasswordRecovery(username.trim());
        setLoading(false);
        if (res.ok && res.methods) {
            setMethods(res.methods);
            setStep("methods");
        } else {
            setError(res.error || "获取验证方式失败");
        }
    };

    const handleMethodToggle = (method: string) => {
        setSelectedMethods((prev) =>
            prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
        );
    };

    const handleSendEmailCode = async () => {
        setLoading(true);
        setError("");
        const res = await sendRecoveryEmailCode(username);
        setLoading(false);
        if (res.ok) {
            if (res.dev_code) {
                setDevCode(res.dev_code);
            }
        } else {
            setError(res.error || "发送验证码失败");
        }
    };

    const handleVerify = async () => {
        if (selectedMethods.length < 2) {
            setError("请至少选择两种验证方式");
            return;
        }

        // 检查必填字段
        if (selectedMethods.includes("email") && !emailCode) {
            setError("请输入邮箱验证码");
            return;
        }
        if (selectedMethods.includes("otp") && !otpCode) {
            setError("请输入 OTP 验证码");
            return;
        }
        if (selectedMethods.includes("recovery_code") && !recoveryCode) {
            setError("请输入恢复码");
            return;
        }
        if (selectedMethods.includes("old_password") && !oldPassword) {
            setError("请输入曾用密码");
            return;
        }

        setLoading(true);
        setError("");
        const res = await verifyPasswordRecovery({
            username,
            verification_methods: selectedMethods,
            email_code: selectedMethods.includes("email") ? emailCode : undefined,
            otp_code: selectedMethods.includes("otp") ? otpCode : undefined,
            recovery_code: selectedMethods.includes("recovery_code") ? recoveryCode : undefined,
            old_password: selectedMethods.includes("old_password") ? oldPassword : undefined,
        });
        setLoading(false);

        if (res.ok && res.verification_token) {
            setVerificationToken(res.verification_token);
            setStep("action");
        } else {
            setError(res.error || "验证失败");
        }
    };

    const handleChooseResetPassword = () => {
        setError("");
        setStep("reset");
    };

    const handleChooseResetOtp = async () => {
        setLoading(true);
        setError("");
        const res = await startRecoveryOtpReset(username, verificationToken);
        setLoading(false);

        if (res.ok && res.secret && res.uri && res.qr) {
            setOtpSetupData({ secret: res.secret, uri: res.uri, qr: res.qr });
            setNewOtpCode("");
            setStep("resetOtp");
        } else {
            setError(res.error || "启动 OTP 重置失败");
        }
    };

    const handleResetPassword = async () => {
        if (!newPassword || newPassword.length < 4) {
            setError("密码至少需要 4 个字符");
            return;
        }
        if (newPassword !== confirmPassword) {
            setError("两次输入的密码不一致");
            return;
        }

        setLoading(true);
        setError("");
        const res = await resetPassword(username, newPassword, verificationToken);
        setLoading(false);

        if (res.ok) {
            setResetMessage(res.message || "密码已重置");
            setDoneTitle("密码已成功重置");
            setDoneHint("请使用新密码登录");
            setStep("done");
        } else {
            setError(res.error || "重置密码失败");
        }
    };

    const handleConfirmResetOtp = async () => {
        if (!otpSetupData) {
            setError("OTP 设置信息不存在，请重新开始");
            return;
        }
        if (!newOtpCode) {
            setError("请输入新的 OTP 验证码");
            return;
        }

        setLoading(true);
        setError("");
        const res = await confirmRecoveryOtpReset(
            username,
            verificationToken,
            otpSetupData.secret,
            newOtpCode
        );
        setLoading(false);

        if (res.ok) {
            setResetMessage(res.message || "OTP 已重置");
            setDoneTitle("OTP 已成功重置");
            setDoneHint("请使用现有密码和新的 OTP 登录");
            setOtpSetupData(null);
            setNewOtpCode("");
            setStep("done");
        } else {
            setError(res.error || "确认 OTP 失败");
        }
    };

    const handleCopySecret = async () => {
        if (!otpSetupData?.secret) return;
        try {
            await navigator.clipboard.writeText(otpSetupData.secret);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch {
            setError("复制失败，请手动复制密钥");
        }
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div className="w-full max-w-md space-y-6">
                {/* Header */}
                <div className="text-center">
                    <h1 className="text-2xl font-mono font-bold text-foreground">密码找回</h1>
                    <div className="text-sm font-mono text-muted-foreground mt-2 space-y-2">
                        <p>
                            {step === "username" && "请输入您的用户名"}
                            {step === "methods" && "选择验证方式（至少两种）"}
                            {step === "verify" && "完成身份验证"}
                            {step === "action" && "请选择要恢复的内容"}
                            {step === "reset" && "设置新密码"}
                            {step === "resetOtp" && "绑定新的 OTP"}
                            {step === "done" && doneTitle}
                        </p>
                        {step === "done" && resetMessage && (
                            <div className="bg-primary/10 border border-primary/30 rounded-md p-3 text-left">
                                <p className="text-xs font-mono text-foreground whitespace-pre-line">{resetMessage}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3">
                        <p className="text-xs font-mono text-destructive">{error}</p>
                    </div>
                )}

                {/* Step: Username */}
                {step === "username" && (
                    <div className="space-y-4">
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="用户名"
                            className="w-full px-4 py-3 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            onKeyDown={(e) => e.key === "Enter" && handleStartRecovery()}
                            autoFocus
                        />
                        <button
                            onClick={handleStartRecovery}
                            disabled={loading}
                            className="w-full px-4 py-3 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50"
                        >
                            {loading ? "..." : "下一步"}
                        </button>
                    </div>
                )}

                {/* Step: Methods */}
                {step === "methods" && methods && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            {methods.has_email && (
                                <button
                                    onClick={() => handleMethodToggle("email")}
                                    className={`w-full flex items-center gap-3 p-3 rounded-md border transition-colors ${selectedMethods.includes("email")
                                        ? "bg-primary/10 border-primary"
                                        : "bg-card border-border hover:border-primary/50"
                                        }`}
                                >
                                    <Mail size={18} className="text-primary" />
                                    <div className="text-left">
                                        <p className="text-sm font-mono text-foreground">邮箱验证码</p>
                                        <p className="text-xs font-mono text-muted-foreground">发送验证码到绑定邮箱</p>
                                    </div>
                                </button>
                            )}

                            {methods.has_otp && (
                                <button
                                    onClick={() => handleMethodToggle("otp")}
                                    className={`w-full flex items-center gap-3 p-3 rounded-md border transition-colors ${selectedMethods.includes("otp")
                                        ? "bg-primary/10 border-primary"
                                        : "bg-card border-border hover:border-primary/50"
                                        }`}
                                >
                                    <Smartphone size={18} className="text-primary" />
                                    <div className="text-left">
                                        <p className="text-sm font-mono text-foreground">OTP 验证码</p>
                                        <p className="text-xs font-mono text-muted-foreground">使用验证器应用</p>
                                    </div>
                                </button>
                            )}

                            {methods.has_recovery_codes && (
                                <button
                                    onClick={() => handleMethodToggle("recovery_code")}
                                    className={`w-full flex items-center gap-3 p-3 rounded-md border transition-colors ${selectedMethods.includes("recovery_code")
                                        ? "bg-primary/10 border-primary"
                                        : "bg-card border-border hover:border-primary/50"
                                        }`}
                                >
                                    <Shield size={18} className="text-primary" />
                                    <div className="text-left">
                                        <p className="text-sm font-mono text-foreground">恢复码</p>
                                        <p className="text-xs font-mono text-muted-foreground">使用保存的恢复码</p>
                                    </div>
                                </button>
                            )}

                            {methods.has_old_password && (
                                <button
                                    onClick={() => handleMethodToggle("old_password")}
                                    className={`w-full flex items-center gap-3 p-3 rounded-md border transition-colors ${selectedMethods.includes("old_password")
                                        ? "bg-primary/10 border-primary"
                                        : "bg-card border-border hover:border-primary/50"
                                        }`}
                                >
                                    <Key size={18} className="text-primary" />
                                    <div className="text-left">
                                        <p className="text-sm font-mono text-foreground">曾用密码</p>
                                        <p className="text-xs font-mono text-muted-foreground">使用注册时或之前使用过的密码</p>
                                    </div>
                                </button>
                            )}
                        </div>

                        <p className="text-xs font-mono text-muted-foreground text-center">
                            已选择 {selectedMethods.length} / {methods.required_methods} 种
                        </p>

                        <div className="flex gap-2">
                            <button
                                onClick={() => setStep("username")}
                                className="flex-1 px-4 py-3 rounded-md bg-secondary text-secondary-foreground text-sm font-mono font-medium hover:opacity-90"
                            >
                                返回
                            </button>
                            <button
                                onClick={() => {
                                    if (selectedMethods.length < methods.required_methods) {
                                        setError(`请至少选择 ${methods.required_methods} 种验证方式`);
                                    } else {
                                        setStep("verify");
                                    }
                                }}
                                disabled={loading}
                                className="flex-1 px-4 py-3 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50"
                            >
                                下一步
                            </button>
                        </div>
                    </div>
                )}

                {/* Step: Verify */}
                {step === "verify" && (
                    <div className="space-y-4">
                        {selectedMethods.includes("email") && (
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={emailCode}
                                        onChange={(e) => setEmailCode(e.target.value.replace(/\s/g, ""))}
                                        placeholder="邮箱验证码"
                                        maxLength={6}
                                        className="flex-1 px-4 py-3 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                    <button
                                        onClick={handleSendEmailCode}
                                        disabled={loading}
                                        className="px-4 py-3 rounded-md bg-secondary text-secondary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50"
                                    >
                                        发送
                                    </button>
                                </div>
                                {devCode && (
                                    <p className="text-xs font-mono text-muted-foreground">
                                        开发环境验证码: <span className="text-primary">{devCode}</span>
                                    </p>
                                )}
                            </div>
                        )}

                        {selectedMethods.includes("otp") && (
                            <input
                                type="text"
                                value={otpCode}
                                onChange={(e) => setOtpCode(e.target.value.replace(/\s/g, ""))}
                                placeholder="OTP 验证码"
                                maxLength={6}
                                className="w-full px-4 py-3 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        )}

                        {selectedMethods.includes("recovery_code") && (
                            <input
                                type="text"
                                value={recoveryCode}
                                onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                                placeholder="恢复码 (例如: XXXX-XXXX)"
                                maxLength={9}
                                className="w-full px-4 py-3 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        )}

                        {selectedMethods.includes("old_password") && (
                            <input
                                type="password"
                                value={oldPassword}
                                onChange={(e) => setOldPassword(e.target.value)}
                                placeholder="曾用密码"
                                className="w-full px-4 py-3 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        )}

                        <div className="flex gap-2">
                            <button
                                onClick={() => setStep("methods")}
                                className="flex-1 px-4 py-3 rounded-md bg-secondary text-secondary-foreground text-sm font-mono font-medium hover:opacity-90"
                            >
                                返回
                            </button>
                            <button
                                onClick={handleVerify}
                                disabled={loading}
                                className="flex-1 px-4 py-3 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50"
                            >
                                {loading ? "验证中..." : "验证"}
                            </button>
                        </div>
                    </div>
                )}

                {step === "action" && (
                    <div className="space-y-4">
                        <button
                            onClick={handleChooseResetPassword}
                            className="w-full flex items-center gap-3 p-4 rounded-md border bg-card border-border hover:border-primary/50 transition-colors"
                        >
                            <Lock size={18} className="text-primary" />
                            <div className="text-left">
                                <p className="text-sm font-mono text-foreground">重置密码</p>
                                <p className="text-xs font-mono text-muted-foreground">设置新的登录密码</p>
                            </div>
                        </button>

                        <button
                            onClick={handleChooseResetOtp}
                            disabled={loading}
                            className="w-full flex items-center gap-3 p-4 rounded-md border bg-card border-border hover:border-primary/50 transition-colors disabled:opacity-50"
                        >
                            <Smartphone size={18} className="text-primary" />
                            <div className="text-left">
                                <p className="text-sm font-mono text-foreground">重置 OTP</p>
                                <p className="text-xs font-mono text-muted-foreground">保留现有密码，绑定新的验证器</p>
                            </div>
                        </button>

                        <button
                            onClick={() => setStep("verify")}
                            className="w-full px-4 py-3 rounded-md bg-secondary text-secondary-foreground text-sm font-mono font-medium hover:opacity-90"
                        >
                            返回
                        </button>
                    </div>
                )}

                {/* Step: Reset */}
                {step === "reset" && (
                    <div className="space-y-4">
                        <div className="relative">
                            <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="新密码"
                                className="w-full pl-10 pr-4 py-3 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="确认新密码"
                            className="w-full px-4 py-3 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button
                            onClick={handleResetPassword}
                            disabled={loading}
                            className="w-full px-4 py-3 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50"
                        >
                            {loading ? "重置中..." : "重置密码"}
                        </button>
                    </div>
                )}

                {step === "resetOtp" && otpSetupData && (
                    <div className="space-y-4">
                        <div className="bg-primary/5 border border-primary/20 rounded-md p-4 space-y-3">
                            <p className="text-xs font-mono text-muted-foreground">请使用验证器扫描二维码，或手动录入密钥后输入 6 位验证码完成绑定。</p>
                            <img src={otpSetupData.qr} alt="OTP QR" className="w-48 h-48 mx-auto rounded-md border border-border bg-white p-2" />
                            <div className="space-y-2">
                                <p className="text-xs font-mono text-muted-foreground">手动密钥</p>
                                <div className="flex gap-2">
                                    <div className="flex-1 px-3 py-2 rounded-md bg-card border border-border text-xs font-mono break-all text-foreground">
                                        {otpSetupData.secret}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleCopySecret}
                                        className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono hover:opacity-90"
                                    >
                                        {copySuccess ? "已复制" : "复制"}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <input
                            type="text"
                            value={newOtpCode}
                            onChange={(e) => setNewOtpCode(e.target.value.replace(/\s/g, ""))}
                            placeholder="新的 OTP 验证码"
                            maxLength={6}
                            className="w-full px-4 py-3 rounded-md bg-card border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />

                        <div className="flex gap-2">
                            <button
                                onClick={() => setStep("action")}
                                className="flex-1 px-4 py-3 rounded-md bg-secondary text-secondary-foreground text-sm font-mono font-medium hover:opacity-90"
                            >
                                返回
                            </button>
                            <button
                                onClick={handleConfirmResetOtp}
                                disabled={loading}
                                className="flex-1 px-4 py-3 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50"
                            >
                                {loading ? "确认中..." : "确认重置 OTP"}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step: Done */}
                {step === "done" && (
                    <div className="space-y-4 text-center">
                        <div className="bg-primary/10 border border-primary/30 rounded-md p-6">
                            <Lock size={32} className="mx-auto text-primary mb-3" />
                            <p className="text-sm font-mono text-foreground">{doneTitle}</p>
                            <p className="text-xs font-mono text-muted-foreground mt-2">{doneHint}</p>
                        </div>
                        <button
                            onClick={() => navigate("/")}
                            className="w-full px-4 py-3 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90"
                        >
                            前往登录
                        </button>
                    </div>
                )}

                {/* Back to login */}
                {step !== "done" && (
                    <button
                        onClick={() => navigate("/")}
                        className="w-full flex items-center justify-center gap-2 text-sm font-mono text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft size={16} />
                        返回登录
                    </button>
                )}
            </div>
        </div>
    );
};

export default PasswordRecovery;
