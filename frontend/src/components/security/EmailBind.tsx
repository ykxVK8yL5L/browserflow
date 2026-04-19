import { useState } from "react";
import { sendEmailCode, verifyEmail } from "@/lib/authStore";
import { Mail, Send, Loader2, CheckCircle } from "lucide-react";

interface EmailBindProps {
    onComplete: () => void;
}

const EmailBind = ({ onComplete }: EmailBindProps) => {
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [step, setStep] = useState<"input" | "verify">("input");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [devCode, setDevCode] = useState<string | null>(null);

    const handleSendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;

        setError("");
        setLoading(true);

        const res = await sendEmailCode(email);
        setLoading(false);

        if (res.ok) {
            setStep("verify");
            if (res.dev_code) {
                setDevCode(res.dev_code);
            }
        } else {
            setError(res.error || "发送验证码失败");
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code) return;

        setError("");
        setLoading(true);
        const res = await verifyEmail(email, code);
        setLoading(false);
        if (res.ok) {
            onComplete();
        } else {
            setError(res.error || "验证失败");
        }
    };

    if (step === "verify") {
        return (
            <div className="bg-card border border-border rounded-lg p-6">
                <div className="text-center mb-4">
                    <Mail className="w-10 h-10 text-primary mx-auto mb-2" />
                    <h3 className="font-mono font-bold text-sm text-foreground">验证邮箱</h3>
                    <p className="text-xs text-muted-foreground font-mono mt-1">
                        验证码已发送至 {email}
                    </p>
                    {devCode && (
                        <p className="text-xs text-yellow-600 font-mono mt-2 bg-yellow-100 p-2 rounded">
                            开发模式验证码: {devCode}
                        </p>
                    )}
                </div>

                <form onSubmit={handleVerify} className="space-y-4">
                    <div>
                        <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            placeholder="6位验证码"
                            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono text-center tracking-widest placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            maxLength={6}
                            autoFocus
                        />
                    </div>

                    {error && <p className="text-xs text-destructive font-mono">{error}</p>}

                    <button
                        type="submit"
                        disabled={code.length !== 6 || loading}
                        className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        {loading ? "验证中..." : "完成绑定"}
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            setStep("input");
                            setCode("");
                            setError("");
                        }}
                        className="w-full text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                        更换邮箱
                    </button>
                </form>
            </div>
        );
    }

    return (
        <div className="bg-card border border-border rounded-lg p-6">
            <div className="text-center mb-4">
                <Mail className="w-10 h-10 text-primary mx-auto mb-2" />
                <h3 className="font-mono font-bold text-sm text-foreground">绑定邮箱</h3>
                <p className="text-xs text-muted-foreground font-mono mt-1">
                    绑定后可使用邮箱登录
                </p>
            </div>

            <form onSubmit={handleSendCode} className="space-y-4">
                <div>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="请输入邮箱地址"
                        className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        required
                    />
                </div>

                {error && <p className="text-xs text-destructive font-mono">{error}</p>}

                <button
                    type="submit"
                    disabled={!email || loading}
                    className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {loading ? "发送中..." : "发送验证码"}
                </button>
            </form>
        </div>
    );
};

export default EmailBind;
