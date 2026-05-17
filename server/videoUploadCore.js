export const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
export const ALLOWED_MIME_TYPES = new Set([
  "video/mp4",
  "video/x-m4v",
  "video/quicktime",
  "video/webm",
]);

export function getExtension(fileName) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

export function isAllowedVideo(fileName, mimeType) {
  const extension = getExtension(fileName);
  return ALLOWED_EXTENSIONS.has(extension) || String(mimeType || "").startsWith("video/");
}

export function sanitizeFileName(fileName) {
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  const extension = getExtension(fileName);
  const safeBaseName = baseName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return `${safeBaseName || "video"}${extension}`;
}

export function getRequiredEnv() {
  const required = ["N8N_WEBHOOK_URL"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    webhookUrl: process.env.N8N_WEBHOOK_URL,
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function postWebhookWithRetry(webhookUrl, formData) {
  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(webhookUrl, {
        method: "POST",
        body: formData,
      });
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await wait(500 * attempt);
    }
  }

  throw lastError;
}

export async function notifyN8n(webhookUrl, { file, video, fields, metadata }) {
  const formData = new FormData();
  formData.append("video", video, file.name);

  if (fields.payload) {
    formData.append("payload", fields.payload);
    const webhookResponse = await postWebhookWithRetry(webhookUrl, formData);

    if (!webhookResponse.ok) {
      const responseText = await webhookResponse.text().catch(() => "");
      const error = new Error(responseText || webhookResponse.statusText);
      error.status = webhookResponse.status;
      throw error;
    }

    return;
  }

  formData.append("evaluation_id", fields.evaluationId || "");
  formData.append("submission_id", fields.submissionId || "");
  formData.append("subject_name", fields.subjectName || "");
  formData.append("order_number", fields.orderNumber || "");
  formData.append("email", fields.email || "");
  formData.append("user_id", fields.userId || "");
  formData.append("overall_suggestion", fields.overallSuggestion || "");
  formData.append("rubric", fields.rubric || "");
  formData.append("fileName", metadata.fileName);
  formData.append("safeFileName", metadata.safeFileName);
  formData.append("mimeType", metadata.mimeType);
  formData.append("fileSize", String(metadata.fileSize));
  formData.append("receivedAt", metadata.receivedAt);
  formData.append("status", metadata.status);

  const webhookResponse = await postWebhookWithRetry(webhookUrl, formData);

  if (!webhookResponse.ok) {
    const responseText = await webhookResponse.text().catch(() => "");
    const error = new Error(responseText || webhookResponse.statusText);
    error.status = webhookResponse.status;
    throw error;
  }
}

export async function processVideoUpload({ file, video, fields = {} }) {
  const env = getRequiredEnv();
  const receivedAt = new Date().toISOString();

  if (!video) {
    throw new Error("No video file was uploaded.");
  }

  const metadata = {
    fileName: file.name,
    safeFileName: sanitizeFileName(file.name),
    mimeType: file.mimeType,
    fileSize: file.size,
    receivedAt,
    subjectName: fields.subjectName || "",
    orderNumber: fields.orderNumber || "",
    email: fields.email || "",
    userId: fields.userId || "",
    evaluationId: fields.evaluationId || "",
    submissionId: fields.submissionId || "",
    status: "sent",
  };

  try {
    await notifyN8n(env.webhookUrl, {
      file,
      video,
      fields,
      metadata,
    });
  } catch (error) {
    const causeCode = error?.cause?.code || error?.code;
    error.publicMessage =
      causeCode === "EAI_AGAIN" || causeCode === "ENOTFOUND"
        ? "Could not resolve the n8n webhook domain. Check internet/DNS access and the webhook URL."
        : "The n8n webhook returned an error.";
    throw error;
  }

  return metadata;
}
