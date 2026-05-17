import {
  isAllowedVideo,
  MAX_FILE_SIZE_BYTES,
  processVideoUpload,
} from "../server/videoUploadCore.js";

function jsonResponse(status, body) {
  return Response.json(body, { status });
}

async function parseVideoFile(request) {
  const formData = await request.formData();
  const file = formData.get("video");

  if (!(file instanceof File)) {
    return { error: jsonResponse(400, { error: "No video file was uploaded." }) };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: jsonResponse(413, { error: "Video file must be 1GB or smaller." }) };
  }

  if (!isAllowedVideo(file.name, file.type)) {
    return {
      error: jsonResponse(400, {
        error: "Only .mp4, .mov, .webm, and .m4v video files are allowed.",
      }),
    };
  }

  return {
    file: {
      name: file.name,
      mimeType: file.type,
      size: file.size,
    },
    video: file,
    fields: {
      subjectName: String(formData.get("subject_name") || ""),
      orderNumber: String(formData.get("order_number") || ""),
      email: String(formData.get("email") || ""),
      userId: String(formData.get("user_id") || ""),
      evaluationId: String(formData.get("evaluation_id") || ""),
      submissionId: String(formData.get("submission_id") || ""),
      overallSuggestion: String(formData.get("overall_suggestion") || ""),
      rubric: String(formData.get("rubric") || ""),
      payload: String(formData.get("payload") || ""),
    },
  };
}

export async function POST(request) {
  try {
    const parsed = await parseVideoFile(request);

    if (parsed.error) {
      return parsed.error;
    }

    return jsonResponse(200, await processVideoUpload(parsed));
  } catch (error) {
    console.error("[upload-video] upload failed", error);
    return jsonResponse(502, {
      error: error.publicMessage || (error instanceof Error ? error.message : "Video upload failed."),
      detail: error.publicMessage && error instanceof Error ? error.message : undefined,
    });
  }
}

export function GET() {
  return jsonResponse(405, { error: "Method not allowed." });
}
