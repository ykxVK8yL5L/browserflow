import { useState, useEffect, useCallback } from "react";
import { getCurrentUser } from "@/lib/authStore";
import { beginPasskeyRegistration, completePasskeyRegistration, deletePasskey } from "@/lib/authStore";
import type { User } from "@/lib/authStore";
import { Fingerprint, Trash2, Loader2, CheckCircle } from "lucide-react";

const PasskeyManager = ({ userId }: { userId: string }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [success, setSuccess] = useState("");

    // 加载数据
    const loadData = useCallback(async () => {
        setLoading(true);
        const userData = await getCurrentUser();
        setUser(userData);
        setLoading(false);
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // 注册 Passkey
    const handleRegister = async () => {
        setActionLoading(true);
        setSuccess("");

        try {
            // 1. 开始注册流程
            const options = await beginPasskeyRegistration();
            if (!options) {
                throw new Error("Failed to begin registration");
            }

            // 2. 转换 challenge 和 user.id 为 Uint8Array
            const publicKey = {
                ...options,
                challenge: Uint8Array.from(
                    atob(options.challenge.replace(/-/g, "+").replace(/_/g, "/")),
                    (c) => c.charCodeAt(0)
                ),
                user: {
                    ...options.user,
                    id: Uint8Array.from(
                        atob(options.user.id.replace(/-/g, "+").replace(/_/g, "/")),
                        (c) => c.charCodeAt(0)
                    ),
                },
                excludeCredentials: options.excludeCredentials?.map((cred: any) => ({
                    ...cred,
                    id: Uint8Array.from(
                        atob(cred.id.replace(/-/g, "+").replace(/_/g, "/")),
                        (c) => c.charCodeAt(0)
                    ),
                })),
            };

            // 3. 使用 WebAuthn API 创建凭证
            const credential = await navigator.credentials.create({ publicKey });

            if (!credential) {
                throw new Error("No credential returned");
            }

            // 4. 转换凭证为可序列化格式
            const pkCredential = credential as PublicKeyCredential;
            const credentialData = {
                id: pkCredential.id,
                rawId: btoa(
                    String.fromCharCode(...new Uint8Array(pkCredential.rawId))
                ),
                response: {
                    clientDataJSON: btoa(
                        String.fromCharCode(
                            ...new Uint8Array((pkCredential.response as AuthenticatorAttestationResponse).clientDataJSON)
                        )
                    ),
                    attestationObject: btoa(
                        String.fromCharCode(
                            ...new Uint8Array((pkCredential.response as AuthenticatorAttestationResponse).attestationObject)
                        )
                    ),
                },
                type: pkCredential.type,
            };

            // 5. 发送到服务器完成注册
            const result = await completePasskeyRegistration(credentialData);

            if (result.ok) {
                setSuccess("Passkey 注册成功！");
                await loadData();
            } else {
                throw new Error(result.error || "Registration failed");
            }
        } catch (err) {
            console.error("Passkey registration error:", err);
            alert(`注册失败: ${(err as Error).message}`);
        } finally {
            setActionLoading(false);
        }
    };

    // 删除 Passkey
    const handleRemove = async () => {
        if (!confirm("确定要删除此 Passkey 吗？删除后将无法使用 Passkey 登录。")) return;

        setActionLoading(true);
        setSuccess("");

        const result = await deletePasskey();

        if (result.ok) {
            setSuccess("Passkey 已删除");
            await loadData();
        } else {
            alert(`删除失败: ${result.error}`);
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

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Fingerprint size={16} className="text-primary" />
                <span className="font-mono text-sm font-bold text-foreground">
                    Passkey
                </span>
            </div>

            <p className="text-xs font-mono text-muted-foreground">
                Passkey 提供无密码的快速安全登录方式，支持指纹、Face ID 等生物识别。
            </p>

            {success && (
                <div className="flex items-center gap-2 text-primary text-xs font-mono bg-primary/10 p-2 rounded">
                    <CheckCircle size={14} />
                    {success}
                </div>
            )}

            {/* 用户 Passkey 管理 */}
            <div className="border-t border-border pt-4">
                {user.passkeyEnabled ? (
                    <div className="flex items-center justify-between bg-background border border-border rounded-md p-3">
                        <div>
                            <p className="text-sm font-mono text-foreground">已注册 Passkey</p>
                            <p className="text-xs text-muted-foreground">
                                可使用生物识别快速登录
                            </p>
                        </div>
                        <button
                            onClick={handleRemove}
                            disabled={actionLoading}
                            className="p-2 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        >
                            {actionLoading ? (
                                <Loader2 className="animate-spin" size={14} />
                            ) : (
                                <Trash2 size={14} />
                            )}
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={handleRegister}
                        disabled={actionLoading}
                        className="w-full px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-mono font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {actionLoading ? (
                            <Loader2 className="animate-spin" size={14} />
                        ) : (
                            <Fingerprint size={14} />
                        )}
                        注册 Passkey
                    </button>
                )}
            </div>
        </div>
    );
};

export default PasskeyManager;
