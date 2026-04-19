import { useState, useEffect } from "react";
import {
    setupOtp,
    confirmOtpSetup,
    confirmRecoveryCodesDownloaded,
} from "@/lib/authStore";
import type { User } from "@/lib/authStore";
import { Shield, ShieldCheck, Download, Copy, Check, ArrowRight } from "lucide-react";

interface OtpSetupPageProps {
    user: { userId: string; username: string; sessionId: string; token: string };
    onComplete: () => void;
}

const OtpSetupPage = ({ user, onComplete }: OtpSetupPageProps) => {
    const [loading, setLoading] = useState(true);
    const [setupData, setSetupData] = useState<{ secret: string; uri: string, qr: string } | null>(null);
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
    const [downloaded, setDownloaded] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);

    // 加载用户信息并开始 OTP 设置
    useEffect(() => {
        const init = async () => {
            setLoading(true);
            // 开始 OTP 设置
            if (user) {
                const data = await setupOtp(user.userId);
                if (data) {
                    setSetupData(data);
                } else {
                    setError("无法获取 OTP 设置信息，请刷新页面重试");
                }
            }

            setLoading(false);
        };
        init();
    }, [user]);

    // 确认 OTP 设置
    const handleConfirmSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!setupData || !code) return;

        setError("");
        const res = await confirmOtpSetup(user.userId, setupData.secret, code);

        if (res.ok) {
            if (res.recoveryCodes && res.recoveryCodes.length > 0) {
                setRecoveryCodes(res.recoveryCodes);
            } else {
                onComplete();
            }
            return;
        }

        setError(res.error || "验证失败，请重试");
    };

    // 复制恢复码
    const handleCopy = async (text: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(text);
        setTimeout(() => setCopied(null), 2000);
    };

    // 下载恢复码
    const handleDownload = () => {
        if (!recoveryCodes) return;

        const content = "BrowserFlow Recovery Codes\n" +
            "========================\n" +
            "User: " + user.username + "\n" +
            "Generated: " + new Date().toLocaleString() + "\n\n" +
            "Recovery Codes:\n" +
            recoveryCodes.map((c, i) => (i + 1) + ". " + c).join("\n") + "\n\n" +
            "Please keep these codes safe!\n";

        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "browserflow-recovery-codes-" + new Date().toISOString().slice(0, 10) + ".txt";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setDownloaded(true);
    };

    // 完成设置
    const handleComplete = async () => {
        if (!downloaded) {
            alert("Please download recovery codes first!");
            return;
        }

        // 标记恢复码已下载
        await confirmRecoveryCodesDownloaded();

        // 通知父组件完成
        onComplete();
    };

    if (loading) {
        return (
            <div className="min-h-dvh bg-background flex items-center justify-center">
                <div className="text-center">
                    <Shield className="w-12 h-12 animate-pulse text-primary mx-auto mb-4" />
                    <p className="font-mono text-muted-foreground">Initializing security setup...</p>
                </div>
            </div>
        );
    }

    // 阶段 1: OTP 设置
    if (!recoveryCodes) {
        return (
            <div className="min-h-dvh bg-background flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <Shield className="w-12 h-12 text-primary mx-auto mb-4" />
                        <h1 className="font-mono font-bold text-xl text-foreground">
                            Setup Two-Factor Authentication
                        </h1>
                        <p className="text-sm text-muted-foreground font-mono mt-2">
                            First-time login requires 2FA setup for account security
                        </p>
                    </div>

                    <div className="bg-card border border-border rounded-lg p-6">
                        {setupData ? (
                            <>
                                <div className="mb-6">
                                    <p className="text-sm text-muted-foreground font-mono mb-4">
                                        1. Scan the QR code with your authenticator app:
                                    </p>
                                    <div className="flex justify-center mb-4">
                                        <div className="p-4 bg-white rounded-lg">
                                            <img
                                                src={setupData.qr}
                                                alt="OTP QR Code"
                                                className="w-48 h-48"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground font-mono text-center">
                                        Or enter the secret manually:
                                    </p>
                                    <div className="flex items-center justify-center gap-2 mt-1">
                                        <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                                            {setupData.secret}
                                        </code>
                                        <button
                                            onClick={() => handleCopy(setupData.secret)}
                                            className="p-1 hover:bg-muted rounded"
                                        >
                                            {copied === setupData.secret ? (
                                                <Check className="w-4 h-4 text-green-500" />
                                            ) : (
                                                <Copy className="w-4 h-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <form onSubmit={handleConfirmSetup} className="space-y-4">
                                    <div>
                                        <p className="text-sm text-muted-foreground font-mono mb-2">
                                            2. Enter the 6-digit code from your authenticator:
                                        </p>
                                        <input
                                            type="text"
                                            value={code}
                                            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                            placeholder="000000"
                                            className="w-full px-4 py-3 rounded-md bg-background border border-border text-center text-2xl font-mono tracking-widest placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                            maxLength={6}
                                            autoFocus
                                        />
                                    </div>
                                    {error && (
                                        <p className="text-sm text-destructive font-mono">{error}</p>
                                    )}
                                    <button
                                        type="submit"
                                        disabled={code.length !== 6}
                                        className="w-full px-4 py-3 rounded-md bg-primary text-primary-foreground font-mono font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        Verify and Continue
                                        <ArrowRight className="w-4 h-4" />
                                    </button>
                                </form>
                            </>
                        ) : (
                            <div className="text-center py-8">
                                <p className="text-sm text-muted-foreground font-mono mb-4">
                                    {error || "Loading OTP setup..."}
                                </p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="px-4 py-2 rounded-md bg-secondary text-secondary-foreground font-mono text-sm hover:bg-secondary/80"
                                >
                                    Refresh Page
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // 阶段 2: 恢复码下载
    return (
        <div className="min-h-dvh bg-background flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <ShieldCheck className="w-12 h-12 text-green-500 mx-auto mb-4" />
                    <h1 className="font-mono font-bold text-xl text-foreground">
                        Save Recovery Codes
                    </h1>
                    <p className="text-sm text-muted-foreground font-mono mt-2">
                        Recovery codes can be used when you lose access to your authenticator
                    </p>
                </div>

                <div className="bg-card border border-border rounded-lg p-6">
                    <div className="mb-6">
                        <p className="text-sm text-muted-foreground font-mono mb-4">
                            Please download and keep these recovery codes safe:
                        </p>
                        <div className="bg-muted rounded-lg p-4 font-mono text-sm space-y-1">
                            {recoveryCodes.map((codeItem, i) => (
                                <div key={i} className="flex justify-between items-center">
                                    <span>{codeItem}</span>
                                    <button
                                        onClick={() => handleCopy(codeItem)}
                                        className="p-1 hover:bg-background rounded"
                                    >
                                        {copied === codeItem ? (
                                            <Check className="w-4 h-4 text-green-500" />
                                        ) : (
                                            <Copy className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={handleDownload}
                        className="w-full px-4 py-3 rounded-md bg-secondary text-secondary-foreground font-mono font-medium hover:bg-secondary/80 transition-colors flex items-center justify-center gap-2 mb-4"
                    >
                        <Download className="w-4 h-4" />
                        {downloaded ? "Re-download Recovery Codes" : "Download Recovery Codes"}
                    </button>

                    {downloaded && (
                        <button
                            onClick={handleComplete}
                            className="w-full px-4 py-3 rounded-md bg-primary text-primary-foreground font-mono font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                        >
                            <Check className="w-4 h-4" />
                            Complete Setup
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OtpSetupPage;
