import { supabase } from "../lib/supabaseClient";
import { accountingService } from "./accountingService";

export type RubricPayload = {
  [sectionId: string]: {
    [questionId: string]: number | null;
  };
};

export interface EvaluationPayload {
  user_id: string;
  order_number?: string | null;
  subject_name: string;
  overall_suggestion?: string | null;
  rubric: RubricPayload;
  Email?: string | null;
}

type ForwardPayload = EvaluationPayload & {
  evaluation_id: number;
};

export type RubricValue = number | null;

export type Rubric = {
  [sectionId: string]: {
    [questionId: string]: RubricValue;
  };
};

export type EvaluationSubmissionResult = {
  id: number;
  google_doc_id: string | null;
  source_doc_id?: string | null;
  pdf_storage_path?: string | null;
  docx_storage_path?: string | null;
  document_status: "pending" | "ready" | "failed";
  document_error: string | null;
};

function formatPostgrestError(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return String(error);
  }

  const code = Reflect.get(error, "code");
  const message = Reflect.get(error, "message");
  const details = Reflect.get(error, "details");
  const hint = Reflect.get(error, "hint");

  return [code, message, details, hint]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" | ");
}

async function getErrorMessage(error: unknown): Promise<string> {
  const context = typeof error === "object" && error !== null
    ? Reflect.get(error, "context")
    : null;

  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      const responseError =
        typeof payload === "object" && payload !== null
          ? Reflect.get(payload, "error")
          : null;

      if (typeof responseError === "string" && responseError) {
        return responseError;
      }

      return JSON.stringify(payload);
    } catch {
      try {
        const text = await context.clone().text();
        if (text) {
          return text;
        }
      } catch {
        // Fall through to generic handling.
      }
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const maybeMessage = Reflect.get(error, "message");
    if (typeof maybeMessage === "string" && maybeMessage) {
      return maybeMessage;
    }
  }

  return String(error);
}

export async function submitEvaluation(
  payload: EvaluationPayload,
): Promise<EvaluationSubmissionResult> {
  try {
    const { data, error } = await supabase
      .from("evaluations")
      .insert([
        {
          user_id: payload.user_id,
          order_number: payload.order_number ?? null,
          subject_name: payload.subject_name,
          overall_suggestion: payload.overall_suggestion ?? null,
          rubric: payload.rubric,
        },
      ])
      .select("id")
      .single();

    if (error) {
      const message = formatPostgrestError(error);
      console.error("Supabase insert error:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      throw new Error(message || "Failed to save evaluation.");
    }

    void accountingService
      .logActivity({
        user_id: payload.user_id,
        action: "evaluation.submitted",
        resource: "evaluations",
        metadata: {
          evaluation_id: data?.id,
          order_number: payload.order_number ?? null,
        },
      })
      .catch((logError) => {
        console.error("Activity log failed:", logError);
      });

    const forwardPayload: ForwardPayload = {
      ...payload,
      evaluation_id: data.id,
    };

    const { data: functionData, error: forwardError } = await supabase.functions.invoke<{
      ok: boolean;
      status?: "pending" | "ready" | "failed";
      evaluationId?: number | null;
      docId?: string;
      pdfPath?: string | null;
      docxPath?: string | null;
      message?: string;
      error?: string;
    }>("forward-to-n8n", {
      body: forwardPayload,
    });

    if (forwardError) {
      console.error("Edge function forwarding failed:", forwardError);
      throw new Error(`forward-to-n8n failed: ${await getErrorMessage(forwardError)}`);
    }

    if (!functionData?.ok) {
      throw new Error(functionData?.error || "Document generation request failed.");
    }

    if (functionData.status === "ready" && functionData.docId) {
      void accountingService
        .logActivity({
          user_id: payload.user_id,
          action: "GENERATE_DOCUMENT",
          resource: "evaluations",
          metadata: {
            evaluation_id: data.id,
            google_doc_id: functionData.docId,
          },
        })
        .catch((logError) => {
          console.error("Activity log failed:", logError);
        });

      return {
        id: data.id,
        google_doc_id: functionData.docId,
        source_doc_id: functionData.docId,
        pdf_storage_path: functionData.pdfPath ?? null,
        docx_storage_path: functionData.docxPath ?? null,
        document_status: "ready",
        document_error: null,
      };
    }

    void accountingService
      .logActivity({
        user_id: payload.user_id,
        action: "GENERATE_DOCUMENT_REQUESTED",
        resource: "evaluations",
        metadata: {
          evaluation_id: data.id,
          status: functionData.status ?? "pending",
        },
      })
      .catch((logError) => {
        console.error("Activity log failed:", logError);
      });

    return {
      id: data.id,
      google_doc_id: null,
      source_doc_id: null,
      pdf_storage_path: null,
      docx_storage_path: null,
      document_status: functionData.status ?? "pending",
      document_error: null,
    };
  } catch (err) {
    console.error("Error saving evaluation:", err);
    throw err;
  }
}
