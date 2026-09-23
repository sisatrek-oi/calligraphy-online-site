import { runConsensus } from "../../_consensus.js";
import { requireAiAccess } from "../../_auth.js";

function requestBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return {};
}

function sendJson(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.status(status).json(payload);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }
  try {
    const body = requestBody(request);
    await requireAiAccess(request, body);
    sendJson(response, 200, await runConsensus(body, {
      retryProfileId: String(body.profileId || ""),
      retryToken: String(body.retryToken || ""),
    }));
  } catch (error) {
    sendJson(response, Number(error?.status) || 502, { error: error?.message || "重试模型失败" });
  }
}
