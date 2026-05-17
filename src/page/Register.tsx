import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { accountingService } from "../services/accountingService";
import AuthPageControls from "../components/AuthPageControls";
import { useLanguage } from "../i18n/LanguageProvider";

import Logo from "../assets/logo_no_bg.png";

function getRegisterErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("rate limit") || normalizedMessage.includes("email rate limit")) {
    return "ระบบส่งอีเมลเกินจำนวนที่กำหนด กรุณารอสักครู่แล้วลองใหม่ หรือตั้งค่า SMTP/rate limit ใน Supabase";
  }

  return message;
}

function RegisterWrapper({ children }: { children: ReactNode }) {
  const { t } = useLanguage();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-y-auto bg-[#f7f9fb] px-3 pb-4 pt-20 dark:bg-slate-950 sm:px-4 sm:py-6">
      <AuthPageControls />
      <div className="relative z-10 flex w-full max-w-md items-center justify-center rounded-2xl border-2 border-[#eaeef2] bg-white px-3 py-6 dark:border-slate-800 dark:bg-slate-900 sm:border-4 sm:px-4 sm:py-10">
        <div className="relative z-10 w-full rounded-2xl px-4 py-5 sm:p-8">
          <div className="flex justify-center p-1 sm:p-2">
            <img src={Logo} alt="Logo" className="h-auto w-full max-w-[260px] sm:max-w-[340px]" />
          </div>
          <h2 className="mb-5 text-center text-xl font-bold text-black dark:text-white sm:mb-6 sm:text-2xl">
            {t("auth.loginTitle")}
          </h2>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function Register() {
  const { t } = useLanguage();
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    userId?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});
  const [registered, setRegistered] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setErrorMsg(null);

    const nextFieldErrors: {
      userId?: string;
      email?: string;
      password?: string;
      confirmPassword?: string;
    } = {};

    if (!userId.trim()) nextFieldErrors.userId = t("form.fillField");
    if (!email.trim()) nextFieldErrors.email = t("form.fillField");
    if (!password.trim()) nextFieldErrors.password = t("form.fillField");
    if (!confirmPassword.trim()) nextFieldErrors.confirmPassword = t("form.fillField");
    if (!nextFieldErrors.password && password.length < 6) {
      nextFieldErrors.password = t("auth.passwordTooShort");
    }
    if (!nextFieldErrors.confirmPassword && password !== confirmPassword) {
      nextFieldErrors.confirmPassword = t("auth.passwordMismatch");
    }

    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedUserId = userId.trim();

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            user_id: normalizedUserId,
          },
        },
      });

      if (error) {
        setErrorMsg(getRegisterErrorMessage(error.message));
        return;
      }

      if (data.user) {
        setNeedsVerification(!data.session);
        if (data.session) {
          await new Promise((resolve) => setTimeout(resolve, 500));

          const { error: insertError } = await supabase.from("user_information").upsert(
            {
              auth_user_id: data.user.id,
              user_id: normalizedUserId,
              email: normalizedEmail,
            },
            { onConflict: "auth_user_id" },
          );

          if (insertError) {
            console.error("Data insertion error:", insertError);
            setErrorMsg(insertError.message);
            return;
          }
        }

        if (data.session) {
          void accountingService
            .logActivity({
              user_id: data.user.id,
              action: "auth.registered",
              resource: "auth",
              metadata: {
                email_verified_immediately: true,
              },
            })
            .catch((logError) => {
              console.error("Activity log failed:", logError);
            });
        }
      }

      await supabase.auth.signOut();
      setEmail(normalizedEmail);
      setRegistered(true);
    } finally {
      setLoading(false);
    }
  };

  if (registered) {
    return (
      <RegisterWrapper>
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-[#1a5fb4]/30 bg-[#1a5fb4]/10">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1a5fb4"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-10 w-10"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>

          <div className="space-y-1">
            <p className="text-xl font-bold text-slate-900 dark:text-white">
              {t("auth.registerSuccessTitle")}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {needsVerification ? t("auth.registerVerify") : t("auth.registerImmediate")}
            </p>
          </div>

          {needsVerification && (
            <div className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-500/30 dark:bg-blue-950/20">
              <p className="text-xs leading-relaxed text-blue-700 dark:text-blue-300">
                {t("auth.registerCheckEmail", { email })}
              </p>
            </div>
          )}

          <Link to="/" className="btn-primary mt-2 inline-block w-full rounded-lg py-2.5 text-center">
            {t("auth.goToLogin")}
          </Link>
        </div>
      </RegisterWrapper>
    );
  }

  return (
    <RegisterWrapper>
      <form noValidate onSubmit={handleRegister} className="space-y-5">
        <div>
          <label className="mb-1 block font-medium text-gray-600 dark:text-slate-300">
            {t("auth.userId")}
          </label>
          <input
            type="text"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              if (fieldErrors.userId) {
                setFieldErrors((current) => ({ ...current, userId: undefined }));
              }
            }}
            className={`w-full rounded-lg border bg-white px-4 py-2 text-black focus:outline-none focus:ring-1 dark:bg-slate-950 dark:text-white ${
              fieldErrors.userId
                ? "border-red-400 focus:ring-red-200 dark:border-red-500/60"
                : "border-gray-500 focus:ring-[#04418b] dark:border-slate-700"
            }`}
            placeholder={t("auth.enterUserId")}
            required
          />
          {fieldErrors.userId && (
            <p className="mt-2 text-sm text-red-500 dark:text-red-400">{fieldErrors.userId}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block font-medium text-gray-600 dark:text-slate-300">
            {t("auth.email")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) {
                setFieldErrors((current) => ({ ...current, email: undefined }));
              }
            }}
            className={`w-full rounded-lg border bg-white px-4 py-2 text-black focus:outline-none focus:ring-1 dark:bg-slate-950 dark:text-white ${
              fieldErrors.email
                ? "border-red-400 focus:ring-red-200 dark:border-red-500/60"
                : "border-gray-500 focus:ring-[#04418b] dark:border-slate-700"
            }`}
            placeholder={t("auth.enterEmail")}
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
                if (fieldErrors.password || fieldErrors.confirmPassword) {
                  setFieldErrors((current) => ({
                    ...current,
                    password: undefined,
                    confirmPassword: undefined,
                  }));
                }
                if (errorMsg) setErrorMsg(null);
              }}
              className={`w-full rounded-lg border bg-white py-2 pl-4 pr-10 text-black focus:outline-none focus:ring-1 dark:bg-slate-950 dark:text-white ${
                fieldErrors.password
                  ? "border-red-400 focus:ring-red-200 dark:border-red-500/60"
                  : "border-gray-500 focus:ring-[#04418b] dark:border-slate-700"
              }`}
              placeholder={t("auth.enterPassword")}
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
              className={`w-full rounded-lg border bg-white py-2 pl-4 pr-10 text-black focus:outline-none focus:ring-1 dark:bg-slate-950 dark:text-white ${
                fieldErrors.confirmPassword
                  ? "border-red-400 focus:ring-red-200 dark:border-red-500/60"
                  : "border-gray-500 focus:ring-[#04418b] dark:border-slate-700"
              }`}
              placeholder={t("auth.enterConfirmPassword")}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (fieldErrors.confirmPassword) {
                  setFieldErrors((current) => ({ ...current, confirmPassword: undefined }));
                }
                if (errorMsg) setErrorMsg(null);
              }}
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
        {errorMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-950/20">
            <p className="text-xs leading-relaxed text-red-600 dark:text-red-300">{errorMsg}</p>
          </div>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full rounded-lg py-2 disabled:opacity-50">
          {loading ? t("auth.sending") : t("auth.register")}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600 dark:text-slate-400">
        {t("auth.haveAccount")}{" "}
        <Link to="/" className="font-medium text-[#04418b] dark:text-sky-400">
          {t("auth.goToLogin")}
        </Link>
      </p>
    </RegisterWrapper>
  );
}
