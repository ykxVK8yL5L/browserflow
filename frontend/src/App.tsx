import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useNavigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { logout as clearAuthSession } from "@/lib/authStore";
import AuthPage from "./pages/AuthPage";
import OtpSetupPage from "./pages/OtpSetupPage";
import PasswordRecovery from "./pages/PasswordRecovery";
import FlowList from "./pages/FlowList.tsx";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import { useState, useEffect } from "react";
import RecoveryCodeLowAlert from "@/components/security/RecoveryCodeLowAlert";

// const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const queryClient = new QueryClient();

// OTP 设置状态
type OtpStatus = "checking" | "required" | "completed";

const ProtectedRoutes = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [otpStatus, setOtpStatus] = useState<OtpStatus>("checking");

  useEffect(() => {
    // 检查是否需要 OTP 设置
    const checkOtpStatus = async () => {
      if (!user) return;

      try {
        const res = await fetch(`/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${user.token}`,
          },
        });

        if (res.status === 403) {
          const data = await res.json();
          if (data.code === "OTP_SETUP_EXPIRED") {
            await clearAuthSession();
            navigate("/recovery", { replace: true });
            return;
          }
          if (data.code === "OTP_SETUP_REQUIRED" || data.code === "RECOVERY_CODES_REQUIRED") {
            setOtpStatus("required");
            return;
          }
        }

        setOtpStatus("completed");
      } catch {
        setOtpStatus("completed");
      }
    };

    checkOtpStatus();
  }, [user]);

  if (!user) return <AuthPage />;

  if (otpStatus === "checking") {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-mono text-muted-foreground">验证安全状态...</p>
        </div>
      </div>
    );
  }

  if (otpStatus === "required") {
    return (
      <OtpSetupPage
        user={user}
        onComplete={() => {
          setOtpStatus("completed");
          navigate(location.pathname || "/");
        }}
      />
    );
  }

  return (
    <>
      <RecoveryCodeLowAlert userId={user.userId} />
      <Routes>
        <Route path="/" element={<FlowList />} />
        <Route path="/flow/:flowId" element={<Index />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/recovery" element={<PasswordRecovery />} />
            <Route path="*" element={<ProtectedRoutes />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
