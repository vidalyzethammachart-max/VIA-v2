const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://vidalyze.app.n8n.cloud/webhook/google-form-hook";

function jsonResponse(status, body) {
  return Response.json(body, { status });
}

async function forwardJson(request) {
  const body = await request.text();
  return fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });
}

async function forwardMultipart(request) {
  const sourceFormData = await request.formData();
  const payload = sourceFormData.get("payload");
  const video = sourceFormData.get("video");

  const formData = new FormData();
  if (typeof payload === "string") {
    formData.append("payload", payload);
  }
  if (video instanceof File) {
    formData.append("video", video, video.name);
  }

  return fetch(WEBHOOK_URL, {
    method: "POST",
    body: formData,
  });
}

export async function POST(request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const response = contentType.includes("multipart/form-data")
      ? await forwardMultipart(request)
      : await forwardJson(request);

    const responseText = await response.text();
    return new Response(responseText, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    console.error("[n8n-webhook] forward failed", error);
    return jsonResponse(502, {
      error: error instanceof Error ? error.message : "Failed to forward webhook request.",
    });
  }
}

export function GET() {
  return jsonResponse(405, { error: "Method not allowed." });
}
