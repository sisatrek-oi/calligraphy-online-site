import { publicModelConfig } from "./_model-config.js";

export default function handler(request, response) {
  if (!["GET", "HEAD"].includes(request.method || "GET")) {
    response.setHeader("Allow", "GET, HEAD");
    response.status(405).json({ error: "Vercel 环境变量不能在页面中修改" });
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.status(200).json(publicModelConfig());
}
