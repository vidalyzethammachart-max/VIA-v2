import "./server/loadEnv.js";
import axios from "axios";
import cors from "cors";
import express from "express";
import FormData from "form-data";
import multer from "multer";

const PORT = Number(process.env.PORT || 8080);
const MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

const app = express();

function resolveCorsOrigin(origin, callback) {
  const allowedOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`Origin not allowed by CORS: ${origin}`));
}

// Restrict browser access to the configured frontend origin while still
// supporting Render health checks and non-browser server-to-server requests.
app.use(
  cors({
    origin: resolveCorsOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
);

// Store uploads in memory so the relay can stream the exact incoming file to n8n
// without relying on Render's ephemeral filesystem.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
  },
});

app.get("/", (_req, res) => {
  res.status(200).send("Upload API running");
});

app.post("/api/upload-video", upload.single("video"), async (req, res) => {
  try {
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    const payload = req.body?.payload;
    const video = req.file;

    if (!webhookUrl) {
      res.status(500).json({
        success: false,
        message: "Missing required environment variable: N8N_WEBHOOK_URL",
      });
      return;
    }

    if (!payload) {
      res.status(400).json({
        success: false,
        message: "Missing required multipart field: payload",
      });
      return;
    }

    if (!video) {
      res.status(400).json({
        success: false,
        message: "Missing required multipart field: video",
      });
      return;
    }

    const formData = new FormData();
    formData.append("payload", payload);
    formData.append("video", video.buffer, {
      filename: video.originalname,
      contentType: video.mimetype,
      knownLength: video.size,
    });

    // Forward the multipart request server-to-server. Axios body limits are
    // disabled so large video files can pass through this relay to n8n.
    const response = await axios.post(webhookUrl, formData, {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: REQUEST_TIMEOUT_MS,
    });

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data
      ? typeof error.response.data === "string"
        ? error.response.data
        : JSON.stringify(error.response.data)
      : error.message;

    console.error("[upload-api] failed to relay upload", {
      status,
      message,
    });

    res.status(status).json({
      success: false,
      message,
    });
  }
});

// Return consistent JSON errors for Multer parsing failures, including files
// larger than the configured upload limit.
app.use((error, _req, res, next) => {
  if (!error) {
    next();
    return;
  }

  const status = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
    ? 413
    : 500;

  res.status(status).json({
    success: false,
    message: error.message,
  });
});

const server = app.listen(PORT, () => {
  console.log(`[upload-api] listening on port ${PORT}`);
});

// Keep long-running video uploads open long enough for Render -> n8n transfer.
server.timeout = REQUEST_TIMEOUT_MS;
