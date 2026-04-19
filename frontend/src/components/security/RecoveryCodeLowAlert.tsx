import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { getRecoveryCodes } from "@/lib/authStore";

const LOW_RECOVERY_CODE_THRESHOLD = 5;

const RecoveryCodeLowAlert = ({ userId }: { userId: string }) => {
    const [available, setAvailable] = useState<number | null>(null);

    const loadRecoveryCodeStatus = useCallback(async () => {
        const data = await getRecoveryCodes(userId);
        setAvailable(data?.available ?? null);
    }, [userId]);

    useEffect(() => {
        loadRecoveryCodeStatus();

        const intervalId = window.setInterval(loadRecoveryCodeStatus, 30000);
        const handleFocus = () => loadRecoveryCodeStatus();
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                loadRecoveryCodeStatus();
            }
        };

        window.addEventListener("focus", handleFocus);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [loadRecoveryCodeStatus]);

    if (available === null || available >= LOW_RECOVERY_CODE_THRESHOLD) {
        return null;
    }

    return (
        <>
            <div className="fixed inset-x-0 top-0 z-[100] border-b border-amber-500/30 bg-amber-500/10 backdrop-blur">
                <div className="mx-auto flex min-h-14 max-w-7xl items-center gap-3 px-4 py-3">
                    <AlertTriangle size={18} className="shrink-0 text-amber-500" />
                    <div className="font-mono text-xs text-foreground sm:text-sm">
                        恢复码剩余 <span className="font-bold text-amber-600 dark:text-amber-400">{available}</span> 个，
                        已低于安全阈值。若恢复码耗尽，账号将无法找回。该提醒无法关闭，请尽快前往安全设置重新生成恢复码并妥善保存。
                    </div>
                </div>
            </div>
            <div className="h-14 shrink-0" />
        </>
    );
};

export default RecoveryCodeLowAlert;