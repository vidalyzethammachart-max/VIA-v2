import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

import { accountingService } from "../services/accountingService";
import MainNavbar from "../components/MainNavbar";
import { getSections } from "../config/sections";
import { useAuthRole } from "../hooks/useAuthRole";
import { useLanguage } from "../i18n/LanguageProvider";

type RubricValue = number | null;
type RubricData = {
  [sectionId: string]: {
    [questionLabel: string]: RubricValue;
  };
};

type EvaluationRow = {
  id: number;
  user_id: string | null;
  rubric: RubricData;
  created_at: string;
};

type QuestionStats = {
  id: string;
  label: string;
  count: number;
  scores: { [score: number]: number };
  average: number;
};

type SectionStats = {
  id: string;
  title: string;
  questions: QuestionStats[];
};

const DASHBOARD_QUERY_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`${label} timed out`));
      }, timeoutMs);
    }),
  ]);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { loading: authLoading, user: authUser } = useAuthRole();
  const { language, t } = useLanguage();
  const sections = useMemo(() => getSections(language), [language]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<SectionStats[]>([]);
  const [totalResponses, setTotalResponses] = useState(0);
  const [activeTab, setActiveTab] = useState<string>(sections[0]?.id || "1");
  const [chartType, setChartType] = useState<"bar" | "donut">("bar");

  useEffect(() => {
    setActiveTab((current) => current || sections[0]?.id || "1");
  }, [sections]);

  const processStats = useCallback(
    (evaluations: EvaluationRow[]) => {
      setTotalResponses(evaluations.length);

      const sectionMap = new Map<string, Map<string, number[]>>();

      evaluations.forEach((row) => {
        const rubric = row.rubric;
        if (!rubric) return;

        Object.entries(rubric).forEach(([sectionId, questions]) => {
          if (!questions) return;

          if (!sectionMap.has(sectionId)) {
            sectionMap.set(sectionId, new Map());
          }

          const questionMap = sectionMap.get(sectionId)!;

          Object.entries(questions).forEach(([storageKey, rawScore]) => {
            const score = typeof rawScore === "string" ? Number(rawScore) : rawScore;
            if (score === null || score === undefined || Number.isNaN(score)) return;

            if (!questionMap.has(storageKey)) {
              questionMap.set(storageKey, []);
            }
            questionMap.get(storageKey)!.push(score);
          });
        });
      });

      const result: SectionStats[] = sections.map((sectionConf) => {
        const questionMap = sectionMap.get(sectionConf.id) || new Map();
        const questions: QuestionStats[] = sectionConf.questions.map(
          (question) => {
            const scores = [
              ...(questionMap.get(question.storageKey) || []),
              ...(questionMap.get(question.id) || []),
            ];
            const count = scores.length;
            const totalScore = scores.reduce((sum, score) => sum + score, 0);
            const average = count > 0 ? totalScore / count : 0;
            const scoreCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

            scores.forEach((score) => {
              if (score >= 1 && score <= 5) {
                scoreCounts[score as 1 | 2 | 3 | 4 | 5] += 1;
              }
            });

            return {
              id: question.id,
              label: question.label,
              count,
              scores: scoreCounts,
              average,
            };
          },
        );

        return {
          id: sectionConf.id,
          title: sectionConf.title,
          questions,
        };
      });

      setStats(result);
    },
    [sections],
  );

  const fetchEvaluations = useCallback(async () => {
    try {
      if (!authUser) {
        navigate("/", { replace: true });
        return;
      }

      const { data, error } = await withTimeout(
        supabase
          .from("evaluations")
          .select("id, user_id, rubric, created_at")
          .order("created_at", { ascending: false }),
        DASHBOARD_QUERY_TIMEOUT_MS,
        "Loading dashboard evaluations",
      );

      if (error) throw error;

      if (data) {
        processStats(data as EvaluationRow[]);
      }
    } catch (error) {
      console.error("Error fetching evaluations:", error);
    } finally {
      setLoading(false);
    }
  }, [authUser, navigate, processStats]);

  useEffect(() => {
    const run = async () => {
      try {
        if (authLoading) {
          setLoading(true);
          return;
        }

        if (!authUser) {
          navigate("/", { replace: true });
          return;
        }

        void accountingService
          .logActivity({
            user_id: authUser.id,
            action: "dashboard.viewed",
            resource: "dashboard",
          })
          .catch((logError) => {
            console.error("Activity log failed:", logError);
          });

        await fetchEvaluations();
      } catch (error) {
        console.error("Access check failed", error);
        setLoading(false);
      }
    };

    void run();
  }, [authLoading, authUser, fetchEvaluations, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
        <MainNavbar />
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-lg text-gray-600 dark:text-gray-400">{t("common.loading")}</div>
        </div>
      </div>
    );
  }

  const activeSectionData = stats.find((section) => section.id === activeTab);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <MainNavbar />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-gray-100">
            {t("dashboard.title")}
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            {t("dashboard.totalResponses", { count: totalResponses })}
          </p>
        </div>

        <div className="mb-8 flex flex-col items-start justify-between gap-6 xl:flex-row">
          <div className="w-full flex-1">
            <span className="mb-2 block text-sm font-medium text-gray-500 dark:text-gray-400">
              {t("dashboard.selectSection")}
            </span>
            <div className="flex flex-wrap gap-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveTab(section.id)}
                  className={`ui-hover-button whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${
                    activeTab === section.id
                      ? "bg-[#04418b] text-white shadow-md"
                      : "border border-gray-200 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-300"
                  }`}
                >
                  {section.title}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-shrink-0">
            <span className="mb-2 block text-sm font-medium text-gray-500 dark:text-gray-400">
              {t("dashboard.chartMode")}
            </span>
            <div className="flex w-full rounded-lg border border-gray-200 bg-white p-1 shadow-sm dark:border-slate-600 dark:bg-slate-800 sm:w-auto">
              <button
                onClick={() => setChartType("bar")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium sm:flex-none ${
                  chartType === "bar"
                    ? "bg-blue-50 text-[#04418b] dark:bg-blue-900/30 dark:text-blue-300"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <BarChartIcon />
                {t("dashboard.barChart")}
              </button>
              <button
                onClick={() => setChartType("donut")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium sm:flex-none ${
                  chartType === "donut"
                    ? "bg-blue-50 text-[#04418b] dark:bg-blue-900/30 dark:text-blue-300"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <DonutChartIcon />
                {t("dashboard.donutChart")}
              </button>
            </div>
          </div>
        </div>

        {activeSectionData ? (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between bg-[#04418b] px-6 py-4">
              <h2 className="text-xl font-semibold text-white">
                {activeSectionData.title}
              </h2>
              <span className="text-sm text-white/80">
                {t("dashboard.sectionLabel", { id: activeSectionData.id })}
              </span>
            </div>

            <div className="space-y-10 p-6">
              {activeSectionData.questions.map((question, idx) => (
                <div
                  key={question.id}
                  className="border-b border-slate-300 pb-8 last:border-0 last:pb-0 dark:border-slate-700"
                >
                  <div className="flex flex-col gap-8 md:flex-row">
                    <div className="flex-1 space-y-4">
                      <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200">
                        {idx + 1}. {question.label}
                      </h3>

                      {chartType === "bar" ? (
                        <div className="space-y-3 pt-2">
                          {[5, 4, 3, 2, 1].map((score) => {
                            const count = question.scores[score] || 0;
                            const percentage =
                              question.count > 0
                                ? (count / question.count) * 100
                                : 0;

                            return (
                              <div
                                key={score}
                                className="flex items-center gap-3 text-sm"
                              >
                                <span className="w-12 text-right font-medium text-gray-500 dark:text-gray-400">
                                  {score}
                                </span>
                                <div className="group relative h-6 flex-1 overflow-hidden rounded-md bg-gray-100 dark:bg-slate-700">
                                  <div
                                    className="relative flex h-full items-center rounded-md transition-all duration-500"
                                    style={{
                                      width: `${percentage}%`,
                                      backgroundColor: getScoreColor(score),
                                      opacity: percentage > 0 ? 1 : 0.3,
                                    }}
                                  />
                                  {percentage > 0 && (
                                    <div className="absolute inset-0 flex items-center px-2">
                                      <span className="text-[10px] font-bold text-white drop-shadow-sm">
                                        {percentage.toFixed(0)}%
                                      </span>
                                    </div>
                                  )}
                                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                                    <span className="rounded border border-gray-200 bg-white/90 px-2 py-0.5 text-[10px] font-bold text-gray-700 shadow-sm dark:border-slate-600 dark:bg-slate-800/90 dark:text-gray-200">
                                      {count}
                                    </span>
                                  </div>
                                </div>
                                <span className="w-8 text-right font-medium text-gray-600 dark:text-gray-300">
                                  {count}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-8 py-4 sm:flex-row">
                          <div className="relative h-48 w-48">
                            <svg
                              viewBox="0 0 100 100"
                              className="h-full w-full -rotate-90 transform"
                            >
                              {(() => {
                                const radius = 40;
                                const circumference = 2 * Math.PI * radius;
                                let cumulativeLength = 0;

                                return [5, 4, 3, 2, 1].map((score) => {
                                  const count = question.scores[score] || 0;
                                  if (!question.count || count === 0)
                                    return null;

                                  const segmentLength =
                                    (count / question.count) * circumference;
                                  const strokeDasharray = `${segmentLength} ${circumference - segmentLength}`;
                                  const strokeDashoffset = -cumulativeLength;
                                  cumulativeLength += segmentLength;

                                  return (
                                    <circle
                                      key={score}
                                      cx="50"
                                      cy="50"
                                      r={radius}
                                      fill="transparent"
                                      stroke={getScoreColor(score)}
                                      strokeWidth="20"
                                      strokeDasharray={strokeDasharray}
                                      strokeDashoffset={strokeDashoffset}
                                      className="transition-all duration-700 ease-out"
                                    />
                                  );
                                });
                              })()}
                              <circle cx="50" cy="50" r="30" className="fill-white dark:fill-slate-800" />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-3xl font-bold text-gray-800 dark:text-gray-200">
                                {question.average.toFixed(1)}
                              </span>
                              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                {t("dashboard.average")}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-col">
                            {[5, 4, 3, 2, 1].map((score) => {
                              const count = question.scores[score] || 0;
                              const percentage =
                                question.count > 0
                                  ? (count / question.count) * 100
                                  : 0;
                              return (
                                <div
                                  key={score}
                                  className="flex items-center gap-2 text-xs"
                                >
                                  <div
                                    className="h-3 w-3 flex-shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: getScoreColor(score),
                                    }}
                                  />
                                  <span className="min-w-[50px] text-gray-600 dark:text-gray-400">
                                    {score}:
                                  </span>
                                  <span className="font-bold text-gray-800 dark:text-gray-200">
                                    {count}
                                  </span>
                                  <span className="text-gray-400 dark:text-gray-500">
                                    ({percentage.toFixed(0)}%)
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex-shrink-0 rounded-xl border border-slate-300 bg-white p-6 dark:border-slate-600 dark:bg-slate-900 md:w-64">
                      <div className="flex h-full flex-col items-center justify-center">
                        <span className="mb-1 text-center text-sm font-medium text-gray-500 dark:text-gray-400">
                          {t("dashboard.scoreAverage")}
                        </span>
                        <div className="my-2 text-5xl font-bold text-[#04418b] dark:text-blue-400">
                          {question.average.toFixed(2)}
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {t("dashboard.outOfFive")}
                        </span>
                        <div className="mt-4 h-px w-full bg-slate-300 dark:bg-slate-600" />
                        <div className="mt-4 flex flex-col items-center">
                          <span className="text-2xl font-bold text-gray-700 dark:text-gray-300">
                            {question.count}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {t("dashboard.respondents")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white py-16 text-center shadow dark:border-slate-700 dark:bg-slate-800">
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("dashboard.noData")}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("dashboard.noDataDesc")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function getScoreColor(score: number): string {
  switch (score) {
    case 5:
      return "#4285F4";
    case 4:
      return "#34A853";
    case 3:
      return "#FBBC05";
    case 2:
      return "#FA7B17";
    case 1:
      return "#EA4335";
    default:
      return "#9AA0A6";
  }
}

function BarChartIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.25h14" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 16.25v-4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 16.25V6.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.75 16.25V9.5" />
    </svg>
  );
}

function DonutChartIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="5.75" strokeLinecap="round" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 4.25a5.75 5.75 0 0 1 5.75 5.75H10V4.25Z"
      />
      <circle cx="10" cy="10" r="2.25" />
    </svg>
  );
}
