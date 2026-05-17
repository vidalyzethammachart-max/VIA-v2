import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import Logo from "../assets/logo_no_bg.png";
import { accountingService } from "../services/accountingService";
import AuthAlert from "../components/AuthAlert";
import AuthModal from "../components/AuthModal";
import AuthPageControls from "../components/AuthPageControls";
import { useLanguage } from "../i18n/LanguageProvider";
import {
  getPasswordUpdateErrorMessage,
  hasRecoveryParams,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_RECOVERY_KEY,
  PASSWORD_UPDATE_TIMEOUT_MS,
  RECOVERY_SESSION_WAIT_MS,
  validatePasswordReset,
} from "../utils/passwordReset";

type RecoveryState = "checking" | "ready" | "expired";

export default function ResetPassword() {
  const { t } = useLanguage();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [pageError, setPageError] = useState("");
  const [modalError, setModalError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    password?: string;
    confirmPassword?: string;
  }>({});
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const recoveryTimeoutRef = useRef<number | null>(null);
  const redirectTimeoutRef = useRef<number | null>(null);

  const isCheckingRecovery = recoveryState === "checking";
  const hasRecoverySession = recoveryState === "ready";
  const effectivePageError = recoveryState === "expired" ? t("auth.resetLinkExpired") : pageError;

  useEffect(() => {
    mountedRef.current = true;

    const clearRecoveryTimeout = () => {
      if (recoveryTimeoutRef.current !== null) {
        window.clearTimeout(recoveryTimeoutRef.current);
        recoveryTimeoutRef.current = null;
      }
    };

    const clearRedirectTimeout = () => {
      if (redirectTimeoutRef.current !== null) {
        window.clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
    };

    const persistRecoveryMarker = () => {
      window.sessionStorage.setItem(PASSWORD_RESET_RECOVERY_KEY, "1");
    };

    const clearRecoveryMarker = () => {
      window.sessionStorage.removeItem(PASSWORD_RESET_RECOVERY_KEY);
    };

    const markRecoveryReady = () => {
      clearRecoveryTimeout();
      persistRecoveryMarker();
      setRecoveryState("ready");
      setPageError("");
    };

    const markRecoveryExpired = () => {
      clearRecoveryTimeout();
      clearRecoveryMarker();
      setRecoveryState("expired");
      setPageError("");
    };

    const bootstrapRecoverySession = async () => {
      const currentUrl = new URL(window.location.href);
      const recoveryParamsPresent = hasRecoveryParams(currentUrl);
      const hasRecoveryMarker = window.sessionStorage.getItem(PASSWORD_RESET_RECOVERY_KEY) === "1";
      const searchParams = currentUrl.searchParams;
      const hashParams = new URLSearchParams(currentUrl.hash.replace(/^#/, ""));
      const authCode = searchParams.get("code");
      const malformedTokenHashMatch = currentUrl.search.match(/[?&]token_hash=([^&]+)/);
      const tokenHash =
        searchParams.get("token_hash") ??
        hashParams.get("token_hash") ??
        malformedTokenHashMatch?.[1] ??
        null;
      const accessToken = hashParams.get("access_token") ?? searchParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token") ?? searchParams.get("refresh_token");

      const clearRecoveryUrl = () => {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("code");
        nextUrl.searchParams.delete("token_hash");
        nextUrl.searchParams.delete("type");
        nextUrl.searchParams.delete("access_token");
        nextUrl.searchParams.delete("refresh_token");
        nextUrl.hash = "";
        window.history.replaceState(window.history.state, "", `${nextUrl.pathname}${nextUrl.search}`);
      };

      try {
        if (authCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(authCode);

          if (!mountedRef.current) return;
          if (!error) {
            clearRecoveryUrl();
            markRecoveryReady();
            return;
          }
          console.error("exchangeCodeForSession failed:", error.message);
        }

        if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });

          if (!mountedRef.current) return;
          if (!error) {
            clearRecoveryUrl();
            markRecoveryReady();
            return;
          }
          console.error("verifyOtp recovery failed:", error.message);
        }

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (!mountedRef.current) return;
          if (!error) {
            clearRecoveryUrl();
            markRecoveryReady();
            return;
          }
          console.error("setSession recovery failed:", error.message);
        }
      } catch (error) {
        console.error("bootstrapRecoverySession failed:", error);
      }

      if (!recoveryParamsPresent && !hasRecoveryMarker) {
        markRecoveryExpired();
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mountedRef.current) return;

      if (session && (recoveryParamsPresent || hasRecoveryMarker)) {
        markRecoveryReady();
        return;
      }

      recoveryTimeoutRef.current = window.setTimeout(async () => {
        const {
          data: { session: delayedSession },
        } = await supabase.auth.getSession();

        if (!mountedRef.current) return;

        if (delayedSession) {
          markRecoveryReady();
          return;
        }

        markRecoveryExpired();
      }, RECOVERY_SESSION_WAIT_MS);
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        if (session) {
          markRecoveryReady();
          return;
        }

        markRecoveryExpired();
      }
    });

    void bootstrapRecoverySession();

    return () => {
      mountedRef.current = false;
      clearRecoveryTimeout();
      clearRedirectTimeout();
      authListener.subscription.unsubscribe();
    };
  }, []);

  const logResetFailed = async (reason: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    void accountingService
      .logActivity({
        user_id: user.id,
        action: "RESET_PASSWORD_FAILED",
        resource: "auth",
        metadata: { reason },
      })
      .catch((logError) => {
        console.error("Activity log failed:", logError);
      });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!hasRecoverySession) {
      setPageError(t("auth.resetLinkExpired"));
      return;
    }

    setMessage("");
    setModalError("");
    setStatusMessage("");
    if (recoveryState !== "expired") {
      setPageError("");
    }

    const validationErrors = validatePasswordReset(password, confirmPassword);
    const nextFieldErrors: {
      password?: string;
      confirmPassword?: string;
    } = {
      password:
        validationErrors.password === "required"
          ? t("form.fillField")
          : validationErrors.password === "too_short"
            ? t("auth.resetPasswordTooShort", { min: MIN_PASSWORD_LENGTH })
            : undefined,
      confirmPassword:
        validationErrors.confirmPassword === "required"
          ? t("form.fillField")
          : validationErrors.confirmPassword === "mismatch"
            ? t("auth.resetPasswordsDoNotMatch")
            : undefined,
    };

    const hasFieldErrors = Object.values(nextFieldErrors).some(Boolean);

    setFieldErrors(nextFieldErrors);
    if (hasFieldErrors) {
      const reason =
        validationErrors.confirmPassword === "mismatch"
          ? "password_mismatch"
          : "weak_password";
      await logResetFailed(reason);
      return;
    }

    setLoading(true);
    setStatusMessage(t("auth.updating"));

    try {
      const updateResult = await Promise.race([
        supabase.auth.updateUser({
          password,
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(new Error("timeout"));
          }, PASSWORD_UPDATE_TIMEOUT_MS);
        }),
      ]);

      const { error: updateError } = updateResult;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (updateError) {
        const safeMessage = getPasswordUpdateErrorMessage(updateError.message);
        setModalError(safeMessage);

        if (user) {
          void accountingService
            .logActivity({
              user_id: user.id,
              action: "RESET_PASSWORD_FAILED",
              resource: "auth",
              metadata: { reason: updateError.message },
            })
            .catch((logError) => {
              console.error("Activity log failed:", logError);
            });
        }
        return;
      }

      if (user) {
        void accountingService
          .logActivity({
            user_id: user.id,
            action: "RESET_PASSWORD_SUCCESS",
            resource: "auth",
          })
          .catch((logError) => {
            console.error("Activity log failed:", logError);
          });
      }

      setMessage(t("auth.resetSuccess"));
      setStatusMessage("");
      window.sessionStorage.removeItem(PASSWORD_RESET_RECOVERY_KEY);

      redirectTimeoutRef.current = window.setTimeout(async () => {
        await supabase.auth.signOut();
        navigate("/", { replace: true });
      }, 1600);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : undefined;
      console.error("updateUser failed:", error);
      setModalError(getPasswordUpdateErrorMessage(errorMessage));
      await logResetFailed("unknown_error");
    } finally {
      setStatusMessage("");
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f7f9fb] dark:bg-slate-950">
      <AuthPageControls />
      {modalError && <AuthModal message={modalError} onClose={() => setModalError("")} />}

      <div className="relative z-10 flex w-full max-w-md items-center justify-center rounded-2xl border-4 border-[#eaeef2] bg-white px-4 py-12 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative z-10 w-full max-w-md rounded-2xl p-8 backdrop-blur-lg">
          <div className="mb-4 flex justify-center p-2">
            <img src={Logo} alt="Logo" className="h-auto w-100" />
          </div>
          <div>
            <h2 className="mb-2 text-center text-2xl font-bold text-black dark:text-white">
              {t("auth.resetPasswordTitle")}
            </h2>
            <p className="mb-6 text-center text-sm text-gray-500 dark:text-slate-400">
              {t("auth.resetPasswordSubtitle")}
            </p>
          </div>

          {message && <AuthAlert variant="success" message={message} />}
          {effectivePageError && <AuthAlert variant="error" message={effectivePageError} />}
          {statusMessage && !message && !effectivePageError && (
            <AuthAlert variant="info" message={statusMessage} />
          )}
          {isCheckingRecovery && <AuthAlert variant="info" message={t("auth.resetLinkChecking")} />}

          <form noValidate onSubmit={handleUpdate} className="space-y-5">
            <div>
              <label className="mb-1 block font-medium text-gray-600 dark:text-slate-300">
                {t("auth.newPassword")}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (modalError) setModalError("");
                    if (pageError && recoveryState !== "expired") setPageError("");
                    if (fieldErrors.password || fieldErrors.confirmPassword) {
                      setFieldErrors((current) => ({
                        ...current,
                        password: undefined,
                        confirmPassword: current.confirmPassword ? undefined : current.confirmPassword,
                      }));
                    }
                  }}
                  disabled={loading || !hasRecoverySession}
                  className={`w-full rounded-lg border bg-white py-2 pl-4 pr-10 text-black focus:outline-none focus:ring-1 dark:bg-slate-950 dark:text-white ${
                    fieldErrors.password
                      ? "border-red-400 focus:ring-red-200 dark:border-red-500/60"
                      : "border-gray-500 focus:ring-[#04418b] dark:border-slate-700"
                  }`}
                  placeholder={t("auth.enterNewPassword")}
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  title={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
              {fieldErrors.password && (
                <p className="mt-2 text-sm text-red-500 dark:text-red-400">{fieldErrors.password}</p>
              )}
            </div>

            <div>
              <label className="mb-1 block font-medium text-gray-600 dark:text-slate-300">
                {t("auth.confirmPassword")}
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (modalError) setModalError("");
                    if (pageError && recoveryState !== "expired") setPageError("");
                    if (fieldErrors.confirmPassword) {
                      setFieldErrors((current) => ({
                        ...current,
                        confirmPassword: undefined,
                      }));
                    }
                  }}
                  disabled={loading || !hasRecoverySession}
                  className={`w-full rounded-lg border bg-white py-2 pl-4 pr-10 text-black focus:outline-none focus:ring-1 dark:bg-slate-950 dark:text-white ${
                    fieldErrors.confirmPassword
                      ? "border-red-400 focus:ring-red-200 dark:border-red-500/60"
                      : "border-gray-500 focus:ring-[#04418b] dark:border-slate-700"
                  }`}
                  placeholder={t("auth.confirmNewPassword")}
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  title={showConfirmPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
              {fieldErrors.confirmPassword && (
                <p className="mt-2 text-sm text-red-500 dark:text-red-400">
                  {fieldErrors.confirmPassword}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !!message || !hasRecoverySession}
              className="btn-primary w-full rounded-lg py-2 disabled:opacity-50"
            >
              {loading ? t("auth.updating") : t("auth.updatePassword")}
            </button>

            {recoveryState === "expired" && (
              <button
                type="button"
                className="btn-secondary w-full rounded-lg py-2"
                onClick={() => navigate("/forgot-password")}
              >
                {t("auth.requestNewResetLink")}
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
