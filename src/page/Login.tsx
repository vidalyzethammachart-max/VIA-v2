import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import { accountingService } from "../services/accountingService";
import AuthPageControls from "../components/AuthPageControls";
import { getUserRole } from "../hooks/useAuthRole";
import { normalizeRole, roleAtLeast } from "../lib/roles";
import { useLanguage } from "../i18n/LanguageProvider";

import Logo from "../assets/logo_no_bg.png";

export default function Login() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const nextFieldErrors: { email?: string; password?: string } = {};
    if (!email.trim()) {
      nextFieldErrors.email = t("form.fillField");
    }
    if (!password.trim()) {
      nextFieldErrors.password = t("form.fillField");
    }
    setFieldErrors(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setErrorMessage(t("auth.invalidLogin"));
      setLoading(false);
      return;
    }

    if (data.user) {
      const role = normalizeRole(
        await getUserRole(data.user.id).catch((roleError) => {
          console.error("Failed to load role after login:", roleError);
          return "user";
        }),
      );

      void accountingService
        .logActivity({
          user_id: data.user.id,
          action: "auth.login_success",
          resource: "auth",
        })
        .catch((logError) => {
          console.error("Activity log failed:", logError);
        });

      setLoading(false);

      if (roleAtLeast(role, "admin")) {
        navigate("/admin", { replace: true });
        return;
      }

      if (roleAtLeast(role, "editor")) {
        navigate("/form-submit", { replace: true });
        return;
      }

      navigate("/dashboard", { replace: true });
      return;
    }

    setLoading(false);
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-y-auto bg-[#f7f9fb] px-3 pb-4 pt-20 dark:bg-slate-950 sm:px-4 sm:py-6">
      <AuthPageControls />
      <div className="relative z-10 flex w-full max-w-md items-center justify-center rounded-2xl border-2 border-[#eaeef2] bg-white px-3 py-6 dark:border-slate-800 dark:bg-slate-900 sm:border-4 sm:px-4 sm:py-10">
        <div className="relative z-10 w-full rounded-2xl px-4 py-5 sm:p-8">
          <div className="flex justify-center p-1 sm:p-2">
            <img src={Logo} alt="Logo" className="h-auto w-full max-w-[260px] sm:max-w-[340px]" />
          </div>
          <div>
            <h2 className="mb-5 text-center text-xl font-bold text-black dark:text-white sm:mb-6 sm:text-2xl">
              {t("auth.loginTitle")}
            </h2>
          </div>
          <form noValidate onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
            <div>
              <label className="mb-1 block font-medium text-gray-600 dark:text-slate-300">
                {t("auth.email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                  if (fieldErrors.email) {
                    setFieldErrors((current) => ({ ...current, email: undefined }));
                  }
                }}
                disabled={loading}
                className={`w-full rounded-lg border bg-white px-4 py-2 text-black focus:outline-none focus:ring-1 disabled:opacity-70 dark:bg-slate-950 dark:text-white ${
                  fieldErrors.email
                    ? "border-red-400 focus:ring-red-200 dark:border-red-500/60"
                    : "border-gray-500 focus:ring-[#04418b] dark:border-slate-700"
                }`}
                placeholder={t("auth.enterEmail")}
                autoComplete="email"
                required
              />
              {fieldErrors.email && (
                <p className="mt-2 text-sm text-red-500 dark:text-red-400">{fieldErrors.email}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-600 dark:text-slate-300">
                {t("auth.password")}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                    if (fieldErrors.password) {
                      setFieldErrors((current) => ({ ...current, password: undefined }));
                    }
                  }}
                  disabled={loading}
                  className={`w-full rounded-lg border bg-white py-2 pl-4 pr-10 text-black focus:outline-none focus:ring-1 disabled:opacity-70 dark:bg-slate-950 dark:text-white ${
                    fieldErrors.password
                      ? "border-red-400 bg-red-50 focus:ring-red-200 dark:border-red-500/60 dark:bg-red-950/20"
                      : errorMessage
                        ? "border-red-300 bg-red-50 focus:ring-red-200 dark:border-red-500/60 dark:bg-red-950/20"
                      : "border-gray-500 focus:ring-[#04418b] dark:border-slate-700"
                  }`}
                  placeholder={t("auth.enterPassword")}
                  autoComplete="current-password"
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
              {errorMessage && (
                <div
                  className="mt-2 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300"
                  role="alert"
                >
                  <svg
                    className="mt-0.5 h-4 w-4 shrink-0"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10A8 8 0 114.343 4.343 8 8 0 0118 10zm-8.75-3.5a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0v-4zm0 6.5a.75.75 0 011.5 0V13a.75.75 0 01-1.5 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full rounded-lg py-2">
              {loading ? t("auth.loggingIn") : t("auth.login")}
            </button>
            <button
              type="button"
              disabled={loading}
              className="btn-secondary w-full rounded-lg py-2"
              onClick={() => navigate("/register")}
            >
              {t("auth.register")}
            </button>
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                disabled={loading}
                className="text-sm font-medium text-[#04418b] disabled:opacity-60 motion-safe:transition motion-safe:duration-200 motion-safe:ease-in-out motion-safe:hover:text-[#04416b] dark:text-sky-400 dark:hover:text-sky-300"
              >
                {t("auth.forgotPassword")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
