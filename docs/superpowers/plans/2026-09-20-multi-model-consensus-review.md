# 多模型共识审核 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有审校工作区结构的前提下，将单模型 AI 理由升级为三模型并行、字段级共识、A/B 审核模式和可撤销审计记录。

**Architecture:** 新增纯 Python 共识引擎，用确定性规则完成字段规范化、证据命中和决策路由；`server.py` 负责三模型配置、并行调用和 API 兼容。前端通过一个纯 JavaScript 帮助模块解析共识响应，只扩展已有设置模态框和 AI 助手面板，并复用现有 `row.history`、`saveWorkspace()` 和撤销通道持久化自动决策。

**Tech Stack:** Python 3 `http.server` / `urllib` / `concurrent.futures`、原生 JavaScript / HTML / CSS、Python `unittest`、Node.js `node:test`、现有 localStorage / Supabase 工作区持久化。

---

## 文件结构

- Create: `ai_consensus.py` - 纯函数字段规范化、证据校验、三档共识和 A/B 决策路由。
- Create: `scripts/test_ai_consensus.py` - 共识引擎单元测试。
- Modify: `server.py` - 三槽位模型配置、旧配置迁移、并行调用、共识 API 和单槽位重试。
- Modify: `scripts/test_search_service.py` - 模型配置兼容、并发、错误隔离和路由测试。
- Create: `src/ai-consensus.js` - 前端响应规范化、共识摘要和操作资格计算。
- Create: `scripts/test-ai-consensus.mjs` - 前端共识帮助模块单元测试。
- Modify: `src/main.js` - 三模型设置、共识请求、现有 AI 面板增量渲染、A/B 操作和审计历史。
- Modify: `src/styles.css` - 三槽位设置表、共识标识、折叠详情和窄视口内部滚动。
- Modify: `scripts/test-workflow-reliability.mjs` - 设置与审校工作流回归测试。
- Modify: `index.html` - 加载 `src/ai-consensus.js` 并更新静态资源版本键。
- Modify: `package.json` - 将新脚本纳入语法检查。
- Modify: `docs/deployment.md` - 记录三模型环境变量、密钥边界和 B 模式启用门槛。

### Task 1: 纯共识引擎

**Files:**
- Create: `ai_consensus.py`
- Create: `scripts/test_ai_consensus.py`

- [ ] **Step 1: 写入字段规范化和证据校验的失败测试**

```python
import unittest

from ai_consensus import normalize_field_value, verify_evidence


class AiConsensusTest(unittest.TestCase):
    def test_normalizes_whitespace_punctuation_boolean_and_explicit_aliases(self):
        aliases = {"author": {"子瞻": "苏轼"}}
        self.assertEqual(normalize_field_value("author", "  子瞻 ", aliases), "苏轼")
        self.assertEqual(normalize_field_value("quote", "书，  心画也", aliases), "书, 心画也")
        self.assertEqual(normalize_field_value("confirmed", True, aliases), "true")

    def test_evidence_must_match_the_supplied_source_after_deterministic_normalization(self):
        self.assertTrue(verify_evidence("王羲之善草书。", "王羲之善草书"))
        self.assertFalse(verify_evidence("王羲之善草书。", "王献之善草书"))
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `python3 -B -m unittest scripts.test_ai_consensus.AiConsensusTest -v`

Expected: FAIL，提示 `ai_consensus` 模块不存在。

- [ ] **Step 3: 实现确定性规范化和证据命中**

```python
import re
import unicodedata


PUNCTUATION = str.maketrans({"，": ",", "：": ":", "；": ";", "（": "(", "）": ")"})


def normalize_text(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    text = unicodedata.normalize("NFKC", str(value or "")).translate(PUNCTUATION)
    return re.sub(r"\s+", " ", text).strip()


def normalize_field_value(field_id: str, value: object, aliases: dict[str, dict[str, str]] | None = None) -> str:
    normalized = normalize_text(value)
    return (aliases or {}).get(field_id, {}).get(normalized, normalized)


def verify_evidence(source_text: str, quote: object) -> bool:
    normalized_quote = normalize_text(quote)
    return bool(normalized_quote) and normalized_quote in normalize_text(source_text)
```

- [ ] **Step 4: 写入三档共识和 `2/3` 禁止自动判过的失败测试**

```python
from ai_consensus import evaluate_consensus

    def test_standard_consensus_requires_three_values_and_two_verified_quotes(self):
        outputs = [
            {"profileId": "a", "fields": {"author": "子瞻"}, "evidence": {"author": {"quote": "苏轼", "verified": True}}},
            {"profileId": "b", "fields": {"author": "苏轼"}, "evidence": {"author": {"quote": "苏轼", "verified": True}}},
            {"profileId": "c", "fields": {"author": "苏轼"}, "evidence": {"author": {"quote": "", "verified": False}}},
        ]
        result = evaluate_consensus(
            [{"id": "author", "required": True}], outputs, "standard", {"author": {"子瞻": "苏轼"}}
        )
        self.assertEqual(result["fields"]["author"]["status"], "unanimous")
        self.assertEqual(result["fields"]["author"]["value"], "苏轼")

    def test_two_of_three_is_a_suggestion_and_never_auto_approves(self):
        outputs = [
            {"profileId": "a", "fields": {"scriptType": "楷书"}, "evidence": {}},
            {"profileId": "b", "fields": {"scriptType": "楷书"}, "evidence": {}},
            {"profileId": "c", "fields": {"scriptType": "行楷"}, "evidence": {}},
        ]
        result = evaluate_consensus([{"id": "scriptType", "required": False}], outputs, "loose", {})
        self.assertEqual(result["fields"]["scriptType"]["status"], "split")
        self.assertEqual(result["decision"], "needs_human_review")
```

- [ ] **Step 5: 实现字段共识与 A/B 决策路由**

```python
POLICIES = {"loose", "standard", "strict"}


def evaluate_consensus(schema, outputs, default_policy, aliases, *, mode="assist", field_overrides=None, model_families=None):
    if default_policy not in POLICIES:
        raise ValueError("无效共识策略")
    field_overrides = field_overrides or {}
    fields = {}
    blockers = []
    for field in schema:
        field_id = str(field["id"])
        policy = field_overrides.get(field_id, {}).get("policy", default_policy)
        if field_overrides.get(field_id, {}).get("manualOnly"):
            blockers.append(f"{field_id}:manual_only")
        values = [normalize_field_value(field_id, item.get("fields", {}).get(field_id), aliases) for item in outputs]
        counts = {value: values.count(value) for value in set(values) if value}
        winner = max(counts, key=counts.get) if counts else ""
        verified = sum(bool(item.get("evidence", {}).get(field_id, {}).get("verified")) for item in outputs)
        quotes = {normalize_text(item.get("evidence", {}).get(field_id, {}).get("quote")) for item in outputs}
        unanimous = len(outputs) == 3 and bool(winner) and counts.get(winner) == 3
        accepted = unanimous and (policy == "loose" or (policy == "standard" and verified >= 2) or (policy == "strict" and verified == 3 and len(quotes) == 1))
        status = "unanimous" if accepted else "split" if counts and max(counts.values()) == 2 else "blocked"
        if not accepted and (field.get("required") or winner):
            blockers.append(f"{field_id}:{status}")
        fields[field_id] = {"status": status, "value": winner, "votes": values, "verifiedEvidence": verified, "policy": policy}
    families = {str(value) for value in (model_families or []) if value}
    can_auto_approve = mode == "auto" and not blockers and len(outputs) == 3 and len(families) >= 2
    return {"fields": fields, "blockers": blockers, "decision": "auto_approve_record" if can_auto_approve else "adopt_fields" if mode == "assist" and any(item["status"] == "unanimous" for item in fields.values()) else "needs_human_review"}
```

- [ ] **Step 6: 运行共识引擎测试并提交**

Run: `python3 -B -m unittest scripts.test_ai_consensus -v`

Expected: 规范化、证据命中、宽松/标准/严格、`2/3`、字段覆盖、家族限制和 A/B 决策测试全部 PASS。

```bash
git add ai_consensus.py scripts/test_ai_consensus.py
git commit -m "feat: add deterministic consensus engine"
```

### Task 2: 三槽位模型配置与旧格式兼容

**Files:**
- Modify: `server.py:20-176`
- Modify: `scripts/test_search_service.py:14-171`

- [ ] **Step 1: 写入旧配置迁移和三 profile 公开状态的失败测试**

```python
    def test_legacy_model_config_becomes_primary_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            path.write_text(json.dumps({"apiUrl": "https://one.test/chat", "apiKey": "secret-1234", "model": "deepseek-chat"}), encoding="utf-8")
            bundle = server.load_model_config_bundle(path)
            self.assertEqual(bundle["profiles"][0]["id"], "primary")
            self.assertEqual(bundle["profiles"][0]["modelFamily"], "deepseek")
            public = server.public_model_config(path)
            self.assertEqual(len(public["profiles"]), 1)
            self.assertNotIn("apiKey", public["profiles"][0])
            self.assertEqual(public["profiles"][0]["keyHint"], "1234")

    def test_three_profiles_preserve_existing_keys_independently(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            first = server.save_model_config_bundle({"profiles": [
                {"id": "primary", "displayName": "DeepSeek", "apiUrl": "https://a.test/chat", "apiKey": "key-a", "model": "deepseek-chat", "modelFamily": "deepseek", "enabled": True},
                {"id": "secondary", "displayName": "Qwen", "apiUrl": "https://b.test/chat", "apiKey": "key-b", "model": "qwen-max", "modelFamily": "qwen", "enabled": True},
            ]}, path)
            updated = server.save_model_config_bundle({"profiles": [{**first["profiles"][0], "apiKey": ""}, {**first["profiles"][1], "apiKey": ""}]}, path)
            self.assertEqual([item["apiKey"] for item in updated["profiles"]], ["key-a", "key-b"])
```

- [ ] **Step 2: 运行配置测试并确认失败**

Run: `python3 -B -m unittest scripts.test_search_service.SearchServiceTest.test_legacy_model_config_becomes_primary_profile scripts.test_search_service.SearchServiceTest.test_three_profiles_preserve_existing_keys_independently -v`

Expected: FAIL，提示 bundle 读写函数未定义。

- [ ] **Step 3: 实现 version 2 配置 bundle 和旧格式迁移**

```python
MODEL_PROFILE_IDS = {"primary", "secondary", "tertiary"}
DEFAULT_REVIEW_POLICY = {"reviewMode": "assist", "defaultConsensus": "standard", "fieldOverrides": {}}


def infer_model_family(model: str) -> str:
    lowered = model.lower()
    for family in ("deepseek", "qwen", "gpt", "claude", "gemini"):
        if family in lowered:
            return family
    return lowered.split("-")[0] or "unknown"


def normalize_review_policy(value: object) -> dict:
    payload = value if isinstance(value, dict) else {}
    mode = str(payload.get("reviewMode") or "assist")
    consensus = str(payload.get("defaultConsensus") or "standard")
    overrides = payload.get("fieldOverrides") if isinstance(payload.get("fieldOverrides"), dict) else {}
    if mode not in {"assist", "auto"} or consensus not in {"loose", "standard", "strict"}:
        raise ApiError("审核策略无效")
    return {"reviewMode": mode, "defaultConsensus": consensus, "fieldOverrides": overrides}


def normalize_model_profile(payload: dict, existing_key: str = "") -> dict:
    profile_id = str(payload.get("id") or "").strip()
    if profile_id not in MODEL_PROFILE_IDS:
        raise ApiError("模型槽位无效")
    base = normalize_model_config(payload, existing_key)
    return {**base, "id": profile_id, "displayName": str(payload.get("displayName") or base["model"])[:80], "modelFamily": str(payload.get("modelFamily") or infer_model_family(base["model"]))[:80], "enabled": payload.get("enabled") is not False}


def load_model_config_bundle(path: Path = MODEL_CONFIG_PATH) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload.get("profiles"), list):
        profiles = [normalize_model_profile(item) for item in payload["profiles"]]
        return {"version": 2, "profiles": profiles, "policy": normalize_review_policy(payload.get("policy"))}
    legacy = normalize_model_config(payload)
    return {"version": 2, "profiles": [{**legacy, "id": "primary", "displayName": legacy["model"], "modelFamily": infer_model_family(legacy["model"]), "enabled": True}], "policy": DEFAULT_REVIEW_POLICY.copy()}


def save_model_config_bundle(payload: dict, path: Path = MODEL_CONFIG_PATH) -> dict:
    if not isinstance(payload, dict) or not isinstance(payload.get("profiles"), list):
        raise ApiError("模型配置格式无效")
    try:
        existing = load_model_config_bundle(path)
    except (OSError, json.JSONDecodeError, ApiError, TypeError):
        existing = {"profiles": []}
    existing_keys = {item["id"]: item["apiKey"] for item in existing.get("profiles", [])}
    profiles = [normalize_model_profile(item, existing_keys.get(str(item.get("id") or ""), "")) for item in payload["profiles"]]
    if len(profiles) > 3 or len({item["id"] for item in profiles}) != len(profiles):
        raise ApiError("模型槽位重复或过多")
    stored = {"version": 2, "profiles": profiles, "policy": normalize_review_policy(payload.get("policy")), "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}-{time.time_ns()}")
    try:
        temporary.write_text(json.dumps(stored, ensure_ascii=False, indent=2), encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(path)
        os.chmod(path, 0o600)
    finally:
        if temporary.exists():
            temporary.unlink()
    return stored


def active_model_profiles(path: Path = MODEL_CONFIG_PATH) -> list[dict]:
    try:
        bundle = load_model_config_bundle(path)
        return [profile for profile in bundle["profiles"] if profile["enabled"]]
    except (OSError, json.JSONDecodeError, ApiError, TypeError):
        legacy = environment_model_config()
        return [{**legacy, "id": "primary", "displayName": legacy["model"], "modelFamily": infer_model_family(legacy["model"]), "enabled": True}] if legacy else []
```

`save_model_config_bundle()` 以 profile `id` 查找旧密钥，仅对本 profile 的空 `apiKey` 沿用旧值。

- [ ] **Step 4: 扩展配置 API，保留旧请求兼容**

`GET /api/model-config` 返回：

```json
{
  "supported": true,
  "configured": true,
  "profiles": [{"id":"primary","displayName":"DeepSeek","apiUrl":"https://api.deepseek.com/chat/completions","model":"deepseek-chat","modelFamily":"deepseek","enabled":true,"source":"local-file","keyHint":"1234"}],
  "policy": {"reviewMode":"assist","defaultConsensus":"standard","fieldOverrides":{}}
}
```

`PUT /api/model-config` 接受 bundle；若请求仍是旧的 `apiUrl/apiKey/model` 格式，则只更新 `primary` profile。`POST /api/model-config/test` 根据 `id` 沿用对应密钥。`DELETE /api/model-config?id=secondary` 只删除相应槽位；无 `id` 时保持删除整个本地配置的旧行为。

- [ ] **Step 5: 运行配置回归测试并提交**

Run: `python3 -B -m unittest scripts.test_search_service -v`

Expected: 旧配置、三 profile、密钥隔离、本机同源、原子写入和单模型抽取测试全部 PASS。

```bash
git add server.py scripts/test_search_service.py
git commit -m "feat: support three model profiles"
```

### Task 3: 三模型并行运行与共识 API

**Files:**
- Modify: `server.py:218-260`
- Modify: `server.py:411-550`
- Modify: `scripts/test_search_service.py`

- [ ] **Step 1: 写入并行、部分失败和幂等的失败测试**

```python
    def test_consensus_runs_three_profiles_and_isolates_one_failure(self):
        profiles = [
            {"id": "primary", "displayName": "A", "apiUrl": "https://a.test/chat", "apiKey": "a", "model": "a-model", "modelFamily": "family-a", "enabled": True},
            {"id": "secondary", "displayName": "B", "apiUrl": "https://b.test/chat", "apiKey": "b", "model": "b-model", "modelFamily": "family-b", "enabled": True},
            {"id": "tertiary", "displayName": "C", "apiUrl": "https://c.test/chat", "apiKey": "c", "model": "c-model", "modelFamily": "family-c", "enabled": True},
        ]
        proposal = {"fields": {"author": "苏轼"}, "evidence": [{"fieldId": "author", "quote": "苏轼", "verified": True}], "reasoning": [], "abstentions": []}
        def fake_runner(_payload, profile):
            if profile["id"] == "secondary":
                raise server.ApiError("模型服务限流", 502)
            return {"profileId": profile["id"], "profile": {"id": profile["id"], "model": profile["model"], "modelFamily": profile["modelFamily"]}, "proposal": proposal, "elapsedMs": 10}
        with patch.object(server, "active_model_profiles", return_value=profiles), patch.object(server, "run_model_with_profile", side_effect=fake_runner):
            result = server.run_model_consensus({"runId": "run-1", "sourceText": "苏轼论书", "schema": [{"id": "author", "required": True}]})
        self.assertEqual(len(result["models"]), 3)
        self.assertEqual(result["decision"], "needs_human_review")
        self.assertEqual(result["models"][1]["status"], "error")
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run: `python3 -B -m unittest scripts.test_search_service.SearchServiceTest.test_consensus_runs_three_profiles_and_isolates_one_failure -v`

Expected: FAIL，提示 `run_model_consensus` 未定义。

- [ ] **Step 3: 抽出单 profile 调用并用线程池并发执行**

```python
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
import uuid

from ai_consensus import evaluate_consensus


CONSENSUS_RUNS: OrderedDict[str, dict] = OrderedDict()


def normalize_run_id(value: object) -> str:
    run_id = str(value or "").strip() or f"run-{uuid.uuid4().hex}"
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", run_id):
        raise ApiError("运行标识无效")
    return run_id


def public_model_profile(profile: dict) -> dict:
    return {key: profile[key] for key in ("id", "displayName", "apiUrl", "model", "modelFamily", "enabled") if key in profile}


def request_model_proposal(payload: dict, profile: dict) -> dict:
    source_text = str(payload.get("sourceText") or "")
    if not source_text.strip():
        raise ApiError("当前条目没有可用原文")
    if len(source_text) > MAX_AI_SOURCE_LENGTH:
        raise ApiError("原文过长，请先缩小处理范围", 413)
    schema = normalize_ai_schema(payload.get("schema"))
    provider_payload = {"model": profile["model"], "messages": build_ai_messages(payload, schema), "temperature": 0, "max_tokens": 2400, "response_format": {"type": "json_object"}}
    if re.match(r"^https://api\.deepseek\.com(?:/|$)", profile["apiUrl"], flags=re.IGNORECASE):
        provider_payload["thinking"] = {"type": "disabled"}
    request = urllib.request.Request(profile["apiUrl"], data=json.dumps(provider_payload, ensure_ascii=False).encode("utf-8"), headers={"Authorization": f"Bearer {profile['apiKey']}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            provider_response = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403}:
            raise ApiError("模型认证失败", 502) from exc
        if exc.code == 429:
            raise ApiError("模型服务限流", 502) from exc
        raise ApiError(f"模型服务返回 {exc.code}", 502) from exc
    except Exception as exc:
        raise ApiError("模型服务不可用", 502) from exc
    return normalize_ai_proposal(parse_model_json(model_response_text(provider_response)), schema, source_text)


def run_model_with_profile(payload: dict, profile: dict) -> dict:
    started = time.monotonic()
    proposal = request_model_proposal(payload, profile)
    return {"profileId": profile["id"], "status": "success", "profile": public_model_profile(profile), "proposal": proposal, "elapsedMs": round((time.monotonic() - started) * 1000)}


def consensus_input(item: dict) -> dict:
    proposal = item["proposal"]
    evidence = {}
    for entry in proposal.get("evidence", []):
        evidence.setdefault(entry["fieldId"], {"quote": entry["quote"], "verified": bool(entry.get("verified"))})
    return {"profileId": item["profileId"], "fields": proposal.get("fields", {}), "evidence": evidence}


def finalize_consensus(payload: dict, ordered: list[dict]) -> dict:
    successful = [consensus_input(item) for item in ordered if item["status"] == "success"]
    families = [item["profile"]["modelFamily"] for item in ordered if item["status"] == "success"]
    consensus = evaluate_consensus(payload["schema"], successful, payload.get("defaultConsensus", "standard"), payload.get("aliases", {}), mode=payload.get("reviewMode", "assist"), field_overrides=payload.get("fieldOverrides", {}), model_families=families)
    if len(successful) != 3:
        consensus["decision"] = "needs_human_review"
        consensus["blockers"] = [*consensus["blockers"], "model_failure"]
    return {"status": "complete", "models": ordered, **consensus}


def run_model_consensus(payload: dict) -> dict:
    run_id = normalize_run_id(payload.get("runId"))
    if run_id in CONSENSUS_RUNS:
        return CONSENSUS_RUNS[run_id]["response"]
    profiles = active_model_profiles()
    if len(profiles) != 3:
        raise ApiError("共识审核需要启用三个模型", 503)
    indexed = {profile["id"]: profile for profile in profiles}
    results = {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(run_model_with_profile, payload, profile): profile["id"] for profile in profiles}
        for future in as_completed(futures):
            profile_id = futures[future]
            try:
                results[profile_id] = future.result()
            except ApiError as exc:
                results[profile_id] = {"profileId": profile_id, "status": "error", "profile": public_model_profile(indexed[profile_id]), "error": str(exc)}
    ordered = [results[profile["id"]] for profile in profiles]
    response = {"runId": run_id, **finalize_consensus(payload, ordered)}
    CONSENSUS_RUNS[run_id] = {"payload": payload, "profiles": profiles, "response": response}
    while len(CONSENSUS_RUNS) > 50:
        CONSENSUS_RUNS.popitem(last=False)
    return response
```

`run_model_extraction()` 改为调用 `request_model_proposal(payload, active_model_profiles()[0])`，并继续包装为现有 `/api/ai/extract` 响应格式。

- [ ] **Step 4: 新增共识和单槽位重试路由**

`WorkspaceHandler.do_POST()` 增加：

```python
if parsed.path == "/api/ai/consensus":
    self._handle_api_action(run_model_consensus)
    return
retry_match = re.fullmatch(r"/api/ai/consensus/([A-Za-z0-9_-]{1,80})/retry/(primary|secondary|tertiary)", parsed.path)
if retry_match:
    self._handle_api_action(lambda payload: retry_consensus_model(retry_match.group(1), retry_match.group(2), payload))
    return
```

服务端用有界内存缓存保留最近 50 个 `runId` 的运行输入和结果。重试函数完整行为为：

```python
def retry_consensus_model(run_id: str, profile_id: str, _payload: dict) -> dict:
    cached = CONSENSUS_RUNS.get(normalize_run_id(run_id))
    if not cached:
        raise ApiError("原共识运行已失效，请重新生成", 404)
    profile = next((item for item in cached["profiles"] if item["id"] == profile_id), None)
    if not profile:
        raise ApiError("模型槽位不存在", 404)
    replacement = run_model_with_profile(cached["payload"], profile)
    ordered = [replacement if item["profileId"] == profile_id else item for item in cached["response"]["models"]]
    response = {"runId": run_id, **finalize_consensus(cached["payload"], ordered)}
    cached["response"] = response
    return response
```

服务重启后缓存清空，不把原文和模型输出另外写入磁盘。

- [ ] **Step 5: 运行后端全量测试并提交**

Run: `python3 -B -m unittest discover -s scripts -p 'test_*.py' -v`

Expected: 三模型并发、失败隔离、幂等、单槽位重试、单模型兼容和原有搜索测试全部 PASS。

```bash
git add server.py scripts/test_search_service.py
git commit -m "feat: run three-model consensus reviews"
```

### Task 4: 前端共识响应模型

**Files:**
- Create: `src/ai-consensus.js`
- Create: `scripts/test-ai-consensus.mjs`
- Modify: `scripts/test-workflow-reliability.mjs`
- Modify: `index.html:19-27`
- Modify: `package.json:7-8`

- [ ] **Step 1: 写入前端响应规范化和操作资格的失败测试**

```javascript
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(new URL("../src/ai-consensus.js", import.meta.url), "utf8"), context);
const api = context.window.CalligraphyAiConsensus;

test("normalizes consensus response and exposes unanimous fields", () => {
  const result = api.normalizeConsensusResponse({
    runId: "run-1",
    status: "complete",
    decision: "adopt_fields",
    fields: { author: { status: "unanimous", value: "苏轼", policy: "standard", verifiedEvidence: 3, votes: ["苏轼", "苏轼", "苏轼"] } },
    models: []
  });
  assert.equal(result.fields.author.value, "苏轼");
  assert.deepEqual(api.adoptableFieldIds(result), ["author"]);
});

test("never treats split fields as adoptable", () => {
  const result = api.normalizeConsensusResponse({ runId: "run-2", status: "complete", decision: "needs_human_review", fields: { scriptType: { status: "split", value: "楷书", votes: ["楷书", "楷书", "行楷"] } }, models: [] });
  assert.deepEqual(api.adoptableFieldIds(result), []);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test scripts/test-ai-consensus.mjs`

Expected: FAIL，提示 `src/ai-consensus.js` 不存在。

- [ ] **Step 3: 实现无 DOM 依赖的前端帮助模块**

```javascript
(function () {
  const text = (value) => String(value ?? "");

  function normalizeConsensusResponse(payload = {}) {
    const models = Array.isArray(payload.models) ? payload.models.map((item) => ({
      profileId: text(item?.profileId), status: item?.status === "success" ? "success" : "error",
      profile: { id: text(item?.profile?.id), displayName: text(item?.profile?.displayName || item?.profileId), model: text(item?.profile?.model), modelFamily: text(item?.profile?.modelFamily) },
      proposal: item?.proposal && typeof item.proposal === "object" ? item.proposal : null,
      error: text(item?.error), elapsedMs: Number(item?.elapsedMs) || 0
    })) : [];
    const fields = Object.fromEntries(Object.entries(payload.fields && typeof payload.fields === "object" ? payload.fields : {}).map(([id, field]) => [id, {
      status: ["unanimous", "split", "blocked"].includes(field?.status) ? field.status : "blocked",
      value: text(field?.value), votes: Array.isArray(field?.votes) ? field.votes.map(text) : [],
      policy: ["loose", "standard", "strict"].includes(field?.policy) ? field.policy : "standard",
      verifiedEvidence: Number(field?.verifiedEvidence) || 0
    }]));
    return { runId: text(payload.runId), status: text(payload.status), decision: ["adopt_fields", "needs_human_review", "auto_approve_record"].includes(payload.decision) ? payload.decision : "needs_human_review", fields, models, blockers: Array.isArray(payload.blockers) ? payload.blockers.map(text) : [] };
  }

  const adoptableFieldIds = (result) => Object.entries(result?.fields || {}).filter(([, field]) => field.status === "unanimous").map(([id]) => id);
  window.CalligraphyAiConsensus = { adoptableFieldIds, normalizeConsensusResponse };
})();
```

- [ ] **Step 4: 加载脚本并纳入检查**

在 `index.html` 中将以下脚本放在 `src/main.js` 之前：

```html
<script defer src="./src/ai-consensus.js?v=20260920-consensus-v1"></script>
```

在 `package.json` 的 `check` 脚本中增加 `node --check src/ai-consensus.js`。

同时将 `scripts/test-workflow-reliability.mjs` 测试容器的模块列表改为：

```javascript
for (const module of ["schema", "import-workflow", "review-workflow", "export-workflow", "ai-consensus"]) {
  vm.runInContext(fs.readFileSync(new URL("../src/" + module + ".js", import.meta.url), "utf8"), context);
}
```

- [ ] **Step 5: 运行 Node 测试并提交**

Run: `node --test scripts/test-ai-consensus.mjs && npm run check`

Expected: 新模块测试和全量语法检查 PASS。

```bash
git add src/ai-consensus.js scripts/test-ai-consensus.mjs scripts/test-workflow-reliability.mjs index.html package.json
git commit -m "feat: add consensus response model"
```

### Task 5: 现有设置页的三模型增量升级

**Files:**
- Modify: `src/main.js:186-198`
- Modify: `src/main.js:1965-2157`
- Modify: `src/main.js:2159-2195`
- Modify: `src/main.js:5710-5900`
- Modify: `src/styles.css:3674-3765`
- Modify: `src/styles.css:4621-4660`
- Modify: `scripts/test-workflow-reliability.mjs`

- [ ] **Step 1: 写入三槽位、策略和密钥不回显的失败测试**

```javascript
test("model settings renders three independent profiles and project policy without exposing keys", async () => {
  const a = app();
  a.run("state.templatePanelExpanded = true; state.settingsTab = 'model'; render = () => {}; ");
  a.set("fetch", async () => ({ ok: true, status: 200, json: async () => ({ supported: true, configured: true, profiles: [
    { id: "primary", displayName: "DeepSeek", apiUrl: "https://a.test/chat", model: "deepseek-chat", modelFamily: "deepseek", enabled: true, source: "local-file", keyHint: "1111" },
    { id: "secondary", displayName: "GPT", apiUrl: "https://b.test/chat", model: "gpt-5.1", modelFamily: "gpt", enabled: true, source: "local-file", keyHint: "2222" },
    { id: "tertiary", displayName: "Qwen", apiUrl: "https://c.test/chat", model: "qwen-max", modelFamily: "qwen", enabled: true, source: "local-file", keyHint: "3333" }
  ], policy: { reviewMode: "assist", defaultConsensus: "standard", fieldOverrides: {} } }) }));
  await a.run("loadModelConfig()");
  const markup = a.run("modelSettingsPanel()");
  assert.match(markup, /data-model-profile="primary"/);
  assert.match(markup, /data-model-profile="secondary"/);
  assert.match(markup, /data-model-profile="tertiary"/);
  assert.match(markup, /A 辅助审核/);
  assert.doesNotMatch(markup, /value="[^"]*(1111|2222|3333)/);
});
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run: `node --test --test-name-pattern="three independent profiles" scripts/test-workflow-reliability.mjs`

Expected: FAIL，当前设置面板只有单槽位。

- [ ] **Step 3: 将 `state.modelSettings` 替换为 profiles 与 policy 状态**

```javascript
modelSettings: {
  status: "idle", supported: null, configured: false, profiles: [],
  policy: { reviewMode: "assist", defaultConsensus: "standard", fieldOverrides: {} },
  activeProfileId: "primary", message: ""
}
```

`applyPublicModelConfig()` 只保留后端公开字段，为缺少的 `secondary` 和 `tertiary` 补空槽位，不将 API Key 写入 state。`state.cloud.config.aiEnabled` 在至少一个模型可用时为真，`consensusEnabled` 在三个槽位全部启用时为真。

- [ ] **Step 4: 扩展原设置面板，不增加新导航层级**

`modelSettingsPanel()` 使用表格式三行 profile，每行显示名称、URL、模型、家族、状态与图标操作。点击编辑只展开当前行的内联表单。图标按钮使用已有 tooltip 机制，并同时设置 `aria-label` 和 `title`。

策略区仅保留三个控件：

```html
<select name="reviewMode"><option value="assist">A 辅助审核</option><option value="auto">B 自动审核</option></select>
<select name="defaultConsensus"><option value="loose">宽松</option><option value="standard">标准</option><option value="strict">严格</option></select>
<span class="model-family-lock">至少 2 个模型家族</span>
```

高风险字段只显示有覆盖的项目，编辑入口复用已有字段模板数据。

- [ ] **Step 5: 更新请求与交互分派**

- `testModelConfig(form)` 发送当前 form 的 `id` 和草稿。
- `saveModelConfig(form)` 将三个公开 profile 草稿与当前表单的 API Key 组合为 bundle。
- `deleteModelConfig(profileId)` 请求 `/api/model-config?id=${encodeURIComponent(profileId)}`。
- 单槽位忙碌时只禁用该行，不冻结其他模型。

- [ ] **Step 6: 增加紧凑样式和响应式退化**

桌面端 profile 用表格行，不使用嵌套卡片。小于 `760px` 时隐藏 URL 的非主机部分和独立家族列，但保留名称、模型、状态和操作。最小宽度下表格内滚动，设置模态框本身不横向溢出。

- [ ] **Step 7: 运行前端回归测试并提交**

Run: `node --test scripts/test-workflow-reliability.mjs && npm run check`

Expected: 三槽位、密钥不回显、单行测试/保存/删除、策略保存、旧单槽位响应兼容和原字段模板测试全部 PASS。

```bash
git add src/main.js src/styles.css scripts/test-workflow-reliability.mjs
git commit -m "feat: configure three review models"
```

### Task 6: 现有 AI 面板的共识摘要与三模型详情

**Files:**
- Modify: `src/main.js:206-218`
- Modify: `src/main.js:2800-3256`
- Modify: `src/main.js:5800-5890`
- Modify: `src/styles.css:5267-5585`
- Modify: `src/styles.css:6549-6575`
- Modify: `scripts/test-workflow-reliability.mjs`

- [ ] **Step 1: 写入布局不变、共识摘要常驻和详情折叠的失败测试**

```javascript
test("consensus panel keeps the existing aside and collapses individual model details", () => {
  const a = app();
  a.run(`state.aiPanelOpen = true; state.aiStatus = "ready"; state.aiRowId = state.selectedId; state.aiWorkspaceId = state.workspaceId; state.aiInputSignature = aiInputSignature(selectedRow()); state.aiProposal = window.CalligraphyAiConsensus.normalizeConsensusResponse({ runId: "r1", decision: "adopt_fields", fields: { author: { status: "unanimous", value: "苏轼", votes: ["苏轼", "苏轼", "苏轼"], policy: "standard", verifiedEvidence: 3 } }, models: [{ profileId: "primary", status: "success", profile: { displayName: "DeepSeek" }, proposal: { reasoning: [{ fieldId: "author", reason: "原文直指", evidenceQuote: "苏轼", evidenceVerified: true }] } }] });`);
  const markup = a.run("aiReviewPanel(selectedRow())");
  assert.match(markup, /class="ai-review-panel/);
  assert.match(markup, /3\/3/);
  assert.match(markup, /<details[^>]*class="ai-model-details"/);
  assert.doesNotMatch(markup, /modal-backdrop|drawer-backdrop/);
});
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run: `node --test --test-name-pattern="consensus panel keeps" scripts/test-workflow-reliability.mjs`

Expected: FAIL，当前面板只支持单模型 `proposal`。

- [ ] **Step 3: 将 AI 请求增量升级为共识请求**

`performAiExtraction()` 在 `state.cloud.config.consensusEnabled` 为真时请求 `./api/ai/consensus`，否则保持 `./api/ai/extract` 单模型降级。共识请求增加：

```javascript
function consensusRequestPayload(row, sourceText) {
  return {
    runId: `${state.workspaceId}-${row.id}-${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, "_"),
    workspaceId: state.workspaceId,
    rowId: row.id,
    sourceText,
    sourceFile: row.sourceFile,
    pageNo: row.pageNo,
    promptVersion: state.promptVersion,
    reviewMode: state.modelSettings.policy.reviewMode,
    defaultConsensus: state.modelSettings.policy.defaultConsensus,
    fieldOverrides: state.modelSettings.policy.fieldOverrides,
    aliases: state.modelSettings.policy.aliases || {},
    currentFields: Object.fromEntries(orderedSchema().map((field) => [field.id, String(fieldValue(row, field.id) || "")])),
    schema: orderedSchema().map(({ id, label, prompt, required, evidenceRequired }) => ({ id, label, prompt, required, evidenceRequired }))
  };
}
```

共识响应使用 `CalligraphyAiConsensus.normalizeConsensusResponse()`；单模型响应继续使用现有 `normalizedAiResponse()`。请求期间的 row/workspace/input signature 过期保护保持不变。

- [ ] **Step 4: 在原 AI aside 内渲染共识优先内容**

`aiSuggestionContent()` 先渲染：

- 本条决策：可采纳字段数、需人工字段数、当前 A/B 模式和共识档位。
- 字段行：字段名、建议值、`3/3`、`2/3` 或异常、证据命中数。
- 阻断原因：仅在存在 blocker 时显示。
- `<details class="ai-model-details">`：按模型显示理由、证据原句、命中状态、耗时和单独重试图标。

现有人工认可/驳回/存疑控件保留，但 `3/3` 可采纳字段在 A 模式下默认设为 `accept`；`2/3`、阻断和异常字段不预选。

- [ ] **Step 5: 增加内部滚动和折叠样式，不修改工作区网格**

只修改 `.ai-review-panel`、`.ai-panel-scroll` 及新增 `.ai-consensus-summary`、`.ai-consensus-field`、`.ai-model-details` 的内部样式。不修改 `.review-screen` 的 grid columns、主表宽度、原文区宽度或队列位置。长理由用 `overflow-wrap:anywhere`，面板内容用 `overflow:auto`。

- [ ] **Step 6: 实现单模型重试交互**

`data-ai-retry-profile` 只请求 `/api/ai/consensus/{runId}/retry/{profileId}`，保留当前面板内容并将该模型行标记为重试中。成功后用新响应整体替换 `state.aiProposal`，再重算预选字段。

- [ ] **Step 7: 运行前端测试并提交**

Run: `node --test scripts/test-ai-consensus.mjs scripts/test-workflow-reliability.mjs && npm run check`

Expected: 共识摘要、详情折叠、失败模型重试、A 模式预选、单模型降级和现有 AI 面板交互测试全部 PASS。

```bash
git add src/main.js src/styles.css scripts/test-workflow-reliability.mjs
git commit -m "feat: show multi-model consensus in AI panel"
```

### Task 7: A/B 审核动作、审计历史与撤销

**Files:**
- Modify: `src/main.js:400-485`
- Modify: `src/main.js:3201-3256`
- Modify: `src/main.js:3570-3735`
- Modify: `src/main.js:2568-2605`
- Modify: `scripts/test-workflow-reliability.mjs`

- [ ] **Step 1: 写入 A 模式保留整条确认和 B 模式自动判过的失败测试**

```javascript
function consensusReadyApp({ decision, reviewMode }) {
  const a = app();
  a.run(`state.modelSettings.policy.reviewMode = ${JSON.stringify(reviewMode)}; state.aiStatus = "ready"; state.aiRowId = state.selectedId; state.aiWorkspaceId = state.workspaceId; state.aiInputSignature = aiInputSignature(selectedRow());`);
  a.set("consensusFixture", {
    runId: "run-test", decision, blockers: [],
    fields: { author: { status: "unanimous", value: "苏轼", policy: "standard", verifiedEvidence: 3, votes: ["苏轼", "苏轼", "苏轼"] } },
    models: [{ profileId: "primary", status: "success", profile: { id: "primary", displayName: "A", model: "a", modelFamily: "family-a" }, proposal: { reasoning: [], evidence: [] } }]
  });
  a.run("state.aiProposal = consensusFixture");
  return a;
}

test("assist mode adopts unanimous fields but leaves the record unreviewed", () => {
  const a = consensusReadyApp({ decision: "adopt_fields", reviewMode: "assist" });
  assert.equal(a.run("applyAiProposal(state.selectedId)"), true);
  assert.equal(a.run("selectedRow().reviewed"), false);
  assert.equal(a.run("selectedRow().fields.author"), "苏轼");
});

test("auto mode approves only a server-qualified unanimous record", () => {
  const a = consensusReadyApp({ decision: "auto_approve_record", reviewMode: "auto" });
  assert.equal(a.run("applyConsensusDecision(state.selectedId)"), true);
  assert.equal(a.run("selectedRow().reviewed"), true);
  assert.match(a.run("selectedRow().history.at(-1).type"), /ai-consensus-auto-approve/);
  assert.equal(a.run("Boolean(selectedRow().history.at(-1).consensusRun.runId)"), true);
});
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run: `node --test --test-name-pattern="assist mode adopts|auto mode approves" scripts/test-workflow-reliability.mjs`

Expected: FAIL，现有应用不理解共识 decision 或自动审计事件。

- [ ] **Step 3: 扩展 `applyAiProposal()` 处理 A 模式共识**

`applyAiProposal()` 对共识响应仅写入 `status === "unanimous"` 且人工裁定为 `accept` 的改动。历史事件使用：

```javascript
{
  type: "ai-consensus-assist",
  actor: "human",
  reason: `人工采纳三模型共识：${acceptedChanges.length} 项。`,
  consensusRun: consensusAuditSnapshot(state.aiProposal),
  decisions,
  changes: acceptedChanges
}
```

写入后 `row.reviewed = false`，保持现有整条人工确认。

- [ ] **Step 4: 实现 B 模式自动判过和保存失败回滚**

```javascript
function applyConsensusDecision(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row || state.aiProposal?.decision !== "auto_approve_record" || state.modelSettings.policy.reviewMode !== "auto") return false;
  const checkpoint = rememberUndo(row, "撤销 AI 自动判过");
  const changes = applyUnanimousConsensusFields(row, state.aiProposal);
  row.reviewed = true;
  row.reviewedAt = new Date().toISOString();
  row.problemResolution = { status: "resolved", at: row.reviewedAt, reason: "三模型共识自动判过。" };
  addHistory(row, { type: "ai-consensus-auto-approve", actor: "system", reason: "三模型共识自动判过。", consensusRun: consensusAuditSnapshot(state.aiProposal), changes });
  if (!finishReviewChange(row, "ai-consensus-auto-approve", "三模型共识自动判过。", changes, checkpoint)) return false;
  return true;
}
```

在 `applyConsensusDecision()` 之前增加完整帮助函数：

```javascript
function applyUnanimousConsensusFields(row, consensus) {
  const changes = [];
  for (const [fieldId, result] of Object.entries(consensus?.fields || {})) {
    if (result.status !== "unanimous" || !schemaField(fieldId)) continue;
    const before = String(fieldValue(row, fieldId) || "");
    const after = String(result.value || "");
    if (before === after) continue;
    setFieldValue(row, fieldId, after);
    changes.push({ fieldId, before, after });
  }
  syncLegacyFields(row);
  return changes;
}

function consensusAuditSnapshot(consensus) {
  const fields = Object.fromEntries(Object.entries(consensus?.fields || {}).map(([fieldId, result]) => [fieldId, {
    status: result.status, value: result.value, policy: result.policy,
    verifiedEvidence: result.verifiedEvidence, votes: [...(result.votes || [])]
  }]));
  const models = (consensus?.models || []).map((item) => ({
    profileId: item.profileId, status: item.status, elapsedMs: item.elapsedMs || 0,
    profile: { id: item.profile?.id || "", displayName: item.profile?.displayName || "", model: item.profile?.model || "", modelFamily: item.profile?.modelFamily || "" },
    reasoning: Array.isArray(item.proposal?.reasoning) ? item.proposal.reasoning : [],
    evidence: Array.isArray(item.proposal?.evidence) ? item.proposal.evidence : []
  }));
  return { runId: consensus?.runId || "", decision: consensus?.decision || "needs_human_review", blockers: [...(consensus?.blockers || [])], fields, models };
}
```

快照不保留 API Key，只保留当前 schema 字段的理由和证据原句。

- [ ] **Step 5: 将自动判过事件接入现有历史和撤销**

`historyPanel()` 将 `ai-consensus-assist` 标记为“共识辅助”，将 `ai-consensus-auto-approve` 标记为“共识自动判过”，并提供可展开的判定依据。现有 `rememberUndo()` / `undoLastAction()` 能够将记录恢复到判过前的待审状态，撤销后新增 `ai-consensus-reverted` 历史事件，不删除原共识快照。

- [ ] **Step 6: 运行工作流测试并提交**

Run: `node --test scripts/test-workflow-reliability.mjs`

Expected: A 模式保留整条确认，B 模式仅对服务端 `auto_approve_record` 判过，保存失败回滚，撤销恢复待审，快照不含密钥，全部 PASS。

```bash
git add src/main.js scripts/test-workflow-reliability.mjs
git commit -m "feat: apply auditable consensus decisions"
```

### Task 8: 部署文档、全量回归与视觉验收

**Files:**
- Modify: `docs/deployment.md`
- Modify: `index.html`
- Verify: `server.py`
- Verify: `src/main.js`
- Verify: `src/styles.css`

- [ ] **Step 1: 记录配置与上线门槛**

在 `docs/deployment.md` 增加：

```markdown
## 多模型共识审核

本地可在“项目设置 > 模型连接”配置 primary、secondary 和 tertiary 三个槽位。密钥只保存在 `.runtime/model-config.json`，不进入浏览器存储或 Git。

环境变量 `MODEL_API_URL` / `MODEL_API_KEY` / `MODEL_NAME` 仍作为 primary 单模型兼容配置。三模型审核需要通过服务端配置 bundle 或部署平台的受保护密钥管理提供三个 profile。GitHub Pages 不能安全保存或直接调用这些密钥。

B 自动审核默认关闭。启用前必须对至少 200 条已人工审核记录回放，自动可判过子集的整条精确率不低于 99.5%，且书家、出处和页码定位无错误通过。
```

- [ ] **Step 2: 更新静态资源版本键**

将 `src/styles.css` 和 `src/main.js` 的 query version 更新为 `20260920-consensus-v1`，避免外部浏览器继续使用旧缓存。

- [ ] **Step 3: 运行全量自动化验证**

Run: `npm test && npm run check`

Expected: 所有 Node 和 Python 测试 PASS，所有 JavaScript 语法检查、Python 编译和云隔离验证 PASS。

- [ ] **Step 4: 启动本地服务并完成功能验收**

Run: `python3 server.py --host 127.0.0.1 --port 8765`

在浏览器验证：

1. 旧单模型配置仍可生成 AI 理由。
2. 三个槽位可分别测试，API Key 不回显。
3. 共识请求显示 `3/3`、`2/3`、证据状态和阻断原因。
4. 展开单模型理由不遮挡主表或原文字段。
5. A 模式采纳后仍需整条确认。
6. B 模式对有分歧或模型失败的记录不自动判过。
7. 自动判过记录可撤销，历史中保留共识快照。

- [ ] **Step 5: 完成桌面与窄视口视觉验收**

使用 1440x900、1280x800 和 390x844 视口截图并检查：

- 工作区主体 grid 与改造前一致。
- AI 面板边框、顶部和底部操作区均在视口内。
- 原文、字段值、共识状态和主操作无重叠。
- 内容超长时只在 AI 面板内滚动。
- 所有图标按钮悬停时显示提示，键盘聚焦可见。

- [ ] **Step 6: 提交文档、版本键与验收截图**

```bash
git add docs/deployment.md index.html docs/superpowers
git commit -m "docs: verify multi-model consensus review"
```

Run: `git status --short`

Expected: 没有未追踪或未提交的实现文件；本地 `.runtime/` 和 `.superpowers/brainstorm/` 不出现在提交中。
