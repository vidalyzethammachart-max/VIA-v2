import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import ConfirmModal from "../components/ConfirmModal";
import MainNavbar from "../components/MainNavbar";
import { SectionCard } from "../components/SectionCard";
import { getLikertLabels, getSections, type LikertValue } from "../config/sections";
import { useLanguage } from "../i18n/LanguageProvider";
import { normalizeRole, type AppRole } from "../lib/roles";
import { supabase } from "../lib/supabaseClient";
import { roleRequestService } from "../services/roleRequestService";
import {
  submitEvaluation,
  type EvaluationPayload,
  type Rubric,
} from "../services/evaluationService";

type SubmissionProgress = {
  percent: number;
  label: string;
};

function createSubmissionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function FormSubmit() {
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const sections = getSections(language);
  const likertLabels = getLikertLabels(language);

  const [orderNumber, setOrderNumber] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [answers, setAnswers] = useState<
    Record<string, Record<string, LikertValue | undefined>>
  >({});
  const [comment, setComment] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<AppRole>("user");
  const [isRequestingRole, setIsRequestingRole] = useState(false);
  const [roleRequestMessage, setRoleRequestMessage] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submissionProgress, setSubmissionProgress] = useState<SubmissionProgress | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        return;
      }

      setUserEmail(user.email ?? null);
      setAuthUserId(user.id);

      void supabase
        .from("user_information")
        .select("role")
        .eq("auth_user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          setUserRole(normalizeRole(data?.role));
        });
    });
  }, []);

  const handleToggleAnswer = (
    sectionId: string,
    questionId: string,
    value: LikertValue,
  ) => {
    setAnswers((prev) => {
      const sectionAnswers = prev[sectionId] || {};
      const current = sectionAnswers[questionId];
      const nextValue = current === value ? undefined : value;

      return {
        ...prev,
        [sectionId]: {
          ...sectionAnswers,
          [questionId]: nextValue,
        },
      };
    });
  };

  const buildRubric = (): Rubric => {
    const rubric: Rubric = {};

    sections.forEach((section) => {
      const sectionAnswers = answers[section.id] ?? {};
      rubric[section.id] = {};

      section.questions.forEach((question) => {
        const value = sectionAnswers[question.id];
        rubric[section.id][question.storageKey] = typeof value === "number" ? value : null;
      });
    });

    return rubric;
  };

  const validateForm = (): string | null => {
    if (!authUserId) {
      return t("form.sessionNotReady");
    }

    if (!orderNumber.trim()) {
      return t("form.fillOrderNumber");
    }

    if (!subjectName.trim()) {
      return t("form.fillSubjectName");
    }

    for (const section of sections) {
      const sectionAnswers = answers[section.id] ?? {};

      for (const question of section.questions) {
        const value = sectionAnswers[question.id];
        if (typeof value !== "number") {
          return t("form.fillAllRubric", { section: section.title });
        }
      }
    }

    if (!comment.trim()) {
      return t("form.fillOverallSuggestion");
    }

    return null;
  };

  const buildPayload = (): EvaluationPayload | null => {
    if (!authUserId) {
      return null;
    }

    return {
      user_id: authUserId,
      order_number: orderNumber.trim(),
      subject_name: subjectName.trim(),
      overall_suggestion: comment.trim(),
      rubric: buildRubric(),
      Email: userEmail || undefined,
    };
  };

  const resetForm = () => {
    setOrderNumber("");
    setSubjectName("");
    setAnswers({});
    setComment("");
    setShowValidation(false);
  };

  const isOrderNumberInvalid = showValidation && !orderNumber.trim();
  const isSubjectNameInvalid = showValidation && !subjectName.trim();
  const isCommentInvalid = showValidation && !comment.trim();

  useEffect(() => {
    if (!showValidation) {
      return;
    }

    setSubmitErrorMessage(validateForm());
  }, [
    authUserId,
    orderNumber,
    subjectName,
    answers,
    comment,
    showValidation,
    language,
  ]);

  const submitForm = async () => {
    setSubmitErrorMessage(null);
    setSubmissionProgress({
      percent: 5,
      label: t("form.progressPreparing"),
    });

    setIsSaving(true);

    const payload = buildPayload();
    if (!payload) {
      setSubmitErrorMessage(t("form.sessionNotReady"));
      setSubmissionProgress(null);
      setIsSaving(false);
      return;
    }

    try {
      const submissionId = createSubmissionId();

      setSubmissionProgress({
        percent: 35,
        label: t("form.progressSending"),
      });

      const result = await submitEvaluation(payload);

      setSubmissionProgress({
        percent: 95,
        label: t("form.progressProcessing"),
      });

      resetForm();
      navigate("/my-forms", {
        replace: true,
        state: { generated: true, evaluationId: result.id, submissionId },
      });
    } catch (error) {
      console.error("Error while saving:", error);
      setSubmitErrorMessage(error instanceof Error ? error.message : t("form.submitFailed"));
      setSubmissionProgress(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      setShowValidation(true);
      setSubmitErrorMessage(validationError);
      return;
    }

    setShowSubmitConfirm(true);
  };

  const handleConfirmSubmit = async () => {
    setShowSubmitConfirm(false);
    await submitForm();
  };

  const handleRequestEditorRole = async () => {
    if (!authUserId) {
      return;
    }

    setIsRequestingRole(true);
    setRoleRequestMessage(null);

    try {
      await roleRequestService.requestRole("editor");
      setRoleRequestMessage(t("form.requestSubmitted"));
    } catch (requestError: unknown) {
      setRoleRequestMessage(
        requestError instanceof Error ? requestError.message : t("form.requestFailed"),
      );
    } finally {
      setIsRequestingRole(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <MainNavbar />
      <ConfirmModal
        isOpen={showSubmitConfirm}
        title={t("form.submitConfirmTitle")}
        message={t("form.submitConfirmMessage")}
        variant="primary"
        onCancel={() => {
          if (!isSaving) setShowSubmitConfirm(false);
        }}
        onConfirm={() => void handleConfirmSubmit()}
        confirmLabel={t("form.submitConfirmAction")}
        cancelLabel={t("common.cancel")}
        confirmDisabled={isSaving}
      />

      <main className="mx-auto max-w-5xl px-4 py-6 md:py-8">
        {userRole === "user" && (
          <section className="ui-hover-card mb-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6">
            <h2 className="text-sm font-semibold text-slate-900">{t("form.needEditorTitle")}</h2>
            <p className="mt-1 text-xs text-slate-500">{t("form.needEditorDescription")}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleRequestEditorRole}
                disabled={isRequestingRole}
                className="btn-primary disabled:bg-slate-400"
              >
                {isRequestingRole ? t("form.requestSubmitting") : t("form.requestEditorRole")}
              </button>
              <Link to="/role-requests" className="btn-secondary text-center font-medium">
                {t("form.viewRequests")}
              </Link>
            </div>
            {roleRequestMessage && (
              <p className="mt-3 text-xs text-slate-600">{roleRequestMessage}</p>
            )}
          </section>
        )}

        {userRole !== "user" && (
          <section className="ui-hover-card mb-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{t("form.workspaceTitle")}</h2>
                <p className="mt-1 text-xs text-slate-500">{t("form.workspaceDescription")}</p>
              </div>
              <Link to="/my-forms" className="btn-primary text-center">
                {t("form.goToMyForms")}
              </Link>
            </div>
          </section>
        )}

        <form noValidate onSubmit={handleSubmit} className="space-y-6">
          <section className="ui-hover-card space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="space-y-1 md:w-40">
                <label className="text-xs font-medium text-slate-700">{t("form.orderNumber")}</label>
                <input
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder={t("form.orderPlaceholder")}
                  required
                  aria-invalid={isOrderNumberInvalid}
                  className={`w-full rounded-xl bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                    isOrderNumberInvalid
                      ? "border border-red-400 focus:border-red-400 focus:ring-red-200 dark:border-red-500 dark:focus:border-red-500 dark:focus:ring-red-950/40"
                      : "border border-slate-200 focus:border-primary focus:ring-primary/60 dark:border-slate-700"
                  }`}
                />
                {isOrderNumberInvalid && (
                  <p className="text-xs font-medium text-red-600">{t("form.fillField")}</p>
                )}
              </div>

              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-slate-700">{t("form.subjectName")}</label>
                <input
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  placeholder={t("form.subjectPlaceholder")}
                  required
                  aria-invalid={isSubjectNameInvalid}
                  className={`w-full rounded-xl bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                    isSubjectNameInvalid
                      ? "border border-red-400 focus:border-red-400 focus:ring-red-200 dark:border-red-500 dark:focus:border-red-500 dark:focus:ring-red-950/40"
                      : "border border-slate-200 focus:border-primary focus:ring-primary/60 dark:border-slate-700"
                  }`}
                />
                {isSubjectNameInvalid && (
                  <p className="text-xs font-medium text-red-600">{t("form.fillField")}</p>
                )}
              </div>
            </div>
          </section>

          <section className="ui-hover-card space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-900 md:text-base">
                {t("form.rubricTitle")}
              </h2>
              <p className="text-xs text-slate-600 md:text-sm">{t("form.rubricDescription")}</p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-slate-600 md:text-sm">
              {([1, 2, 3, 4, 5] as LikertValue[]).map((v) => (
                <div
                  key={v}
                  className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1"
                >
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
                    {v}
                  </span>
                  <span>{likertLabels[v]}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-5">
            {sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                answers={answers[section.id] || {}}
                showValidation={showValidation}
                onToggle={(questionId, value) =>
                  handleToggleAnswer(section.id, questionId, value)
                }
              />
            ))}
          </section>

          <section className="ui-hover-card space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <label className="text-sm font-semibold text-slate-800">{t("form.overallSuggestion")}</label>
            <p className="text-xs text-slate-500">{t("form.overallSuggestionDescription")}</p>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              required
              aria-invalid={isCommentInvalid}
              className={`mt-1 w-full resize-none rounded-xl bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                isCommentInvalid
                  ? "border border-red-400 focus:border-red-400 focus:ring-red-200 dark:border-red-500 dark:focus:border-red-500 dark:focus:ring-red-950/40"
                  : "border border-slate-200 focus:border-primary focus:ring-primary/60 dark:border-slate-700"
              }`}
              placeholder={t("form.overallSuggestionPlaceholder")}
            />
            {isCommentInvalid && (
              <p className="text-xs font-medium text-red-600">{t("form.fillField")}</p>
            )}
          </section>

          <div className="pb-10">
            {submitErrorMessage &&
              !isOrderNumberInvalid &&
              !isSubjectNameInvalid &&
              !isCommentInvalid && (
                <div className="mb-4 w-full rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-center text-sm text-red-600">
                  {submitErrorMessage}
                </div>
              )}
            {isSaving && submissionProgress && (
              <div className="mb-4 rounded-2xl border border-primary/20 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-slate-800">{submissionProgress.label}</span>
                  <span className="tabular-nums font-semibold text-primary">
                    {submissionProgress.percent}%
                  </span>
                </div>
                <div
                  className="h-3 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={submissionProgress.percent}
                  aria-label={submissionProgress.label}
                >
                  <div
                    className="h-full rounded-full bg-primary motion-safe:transition-all motion-safe:duration-300"
                    style={{ width: `${submissionProgress.percent}%` }}
                  />
                </div>
              </div>
            )}
            <div className="flex justify-center">
              <button
                type="submit"
                disabled={isSaving}
                className="btn-primary rounded-full px-6 py-2 text-base shadow-md"
              >
                {isSaving ? t("form.generating") : t("form.submit")}
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}

export default FormSubmit;
