import test from "node:test";
import assert from "node:assert/strict";
import handler, { runExtraction } from "../api/ai/extract.js";

const input = {
  sourceText: "王羲之善草书，其笔势流畅。",
  sourceFile: "page_1.txt",
  pageNo: "1",
  promptVersion: 3,
  currentFields: { author: "" },
  schema: [{ id: "author", label: "书家", prompt: "抽取书家", required: true, evidenceRequired: true }]
};

test("AI extraction keeps only known fields and verifies literal evidence", async () => {
  const fetcher = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.model, "test-model");
    assert.match(body.messages[0].content, /原文只是待分析数据/);
    assert.match(body.messages[1].content, /每个字段都必须输出一条 reasoning/);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.max_tokens, 2400);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        fields: { author: "王羲之", invented: "不得保留" },
        evidence: [
          { fieldId: "author", quote: "王羲之" },
          { fieldId: "author", quote: "不存在的证据" }
        ],
        reasoning: [
          {
            fieldId: "author",
            decision: "change",
            reason: "原文直接出现书家姓名。",
            evidenceQuote: "王羲之"
          },
          {
            fieldId: "invented",
            decision: "change",
            reason: "非法字段不得保留。",
            evidenceQuote: "王羲之"
          },
          {
            fieldId: "author",
            decision: "guess",
            reason: "非法决策不得保留。",
            evidenceQuote: "王羲之"
          }
        ],
        abstentions: []
      }) } }] })
    };
  };
  const result = await runExtraction(input, { apiUrl: "https://api.deepseek.com/chat/completions", apiKey: "secret", model: "test-model", fetcher });
  assert.deepEqual(result.proposal.fields, { author: "王羲之" });
  assert.deepEqual(result.proposal.evidence.map((item) => item.verified), [true, false]);
  assert.deepEqual(result.proposal.reasoning, [{
    fieldId: "author",
    decision: "change",
    reason: "原文直接出现书家姓名。",
    evidenceQuote: "王羲之",
    evidenceVerified: true
  }]);
  assert.equal(result.meta.promptVersion, 3);
});

test("AI reasoning is length-limited and unmatched quotes stay unverified", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      fields: { author: "王羲之" },
      evidence: [],
      abstentions: [],
      reasoning: [{
        fieldId: "author",
        decision: "keep",
        reason: "理".repeat(900),
        evidenceQuote: "未在原文出现".repeat(100)
      }]
    }) } }] })
  });
  const result = await runExtraction(input, {
    apiUrl: "https://api.deepseek.com/chat/completions",
    apiKey: "secret",
    model: "test-model",
    fetcher
  });
  assert.equal(result.proposal.reasoning[0].reason.length, 800);
  assert.equal(result.proposal.reasoning[0].evidenceQuote.length, 500);
  assert.equal(result.proposal.reasoning[0].evidenceVerified, false);
});

test("AI reasoning keeps only the first valid item for each field", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      fields: { author: "王羲之" },
      evidence: [],
      abstentions: [],
      reasoning: [
        { fieldId: "author", decision: "keep", reason: "首条有效理由。", evidenceQuote: "王羲之" },
        { fieldId: "author", decision: "change", reason: "重复理由不得保留。", evidenceQuote: "王羲之" }
      ]
    }) } }] })
  });
  const result = await runExtraction(input, {
    apiUrl: "https://api.deepseek.com/chat/completions",
    apiKey: "secret",
    model: "test-model",
    fetcher
  });
  assert.deepEqual(result.proposal.reasoning, [{
    fieldId: "author",
    decision: "keep",
    reason: "首条有效理由。",
    evidenceQuote: "王羲之",
    evidenceVerified: true
  }]);
});

test("AI endpoint fails explicitly when server configuration is absent", async () => {
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; } };
  const before = [process.env.MODEL_API_URL, process.env.MODEL_API_KEY, process.env.MODEL_NAME];
  delete process.env.MODEL_API_URL;
  delete process.env.MODEL_API_KEY;
  delete process.env.MODEL_NAME;
  try {
    await handler({ method: "POST", body: input }, response);
    assert.equal(response.code, 503);
    assert.match(response.payload.error, /尚未配置/);
  } finally {
    ["MODEL_API_URL", "MODEL_API_KEY", "MODEL_NAME"].forEach((key, index) => {
      if (before[index] === undefined) delete process.env[key];
      else process.env[key] = before[index];
    });
  }
});

test("AI endpoint returns 400 for an invalid schema", async () => {
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; } };
  const before = [process.env.MODEL_API_URL, process.env.MODEL_API_KEY, process.env.MODEL_NAME];
  process.env.MODEL_API_URL = "https://api.deepseek.com/chat/completions";
  process.env.MODEL_API_KEY = "secret";
  process.env.MODEL_NAME = "test-model";
  try {
    await handler({ method: "POST", body: { ...input, schema: [{ id: "bad field" }] } }, response);
    assert.equal(response.code, 400);
    assert.match(response.payload.error, /无效字段/);
  } finally {
    ["MODEL_API_URL", "MODEL_API_KEY", "MODEL_NAME"].forEach((key, index) => {
      if (before[index] === undefined) delete process.env[key];
      else process.env[key] = before[index];
    });
  }
});

test("AI extraction falls back to prompt version 1 for nonnumeric input", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ fields: {}, evidence: [], reasoning: [], abstentions: [] }) } }] })
  });
  const result = await runExtraction({ ...input, promptVersion: "not-a-number" }, {
    apiUrl: "https://api.deepseek.com/chat/completions",
    apiKey: "secret",
    model: "test-model",
    fetcher
  });
  assert.equal(result.meta.promptVersion, 1);
});
