# 模型 API 设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在项目设置中增加可测试、可切换并由本地服务安全持久化的 OpenAI Chat Completions 兼容模型配置。

**Architecture:** Python 本地服务新增独立的模型配置读取、校验、原子写入和连接测试函数，并通过仅允许本机同源访问的 API 暴露公开状态；现有 AI 抽取统一读取活动配置。前端在现有项目设置模态框内增加“字段模板 / 模型连接”页签，只保留配置草稿，不把 API Key 写入浏览器或工作区存储。

**Tech Stack:** Python `http.server`、`urllib`、原生 JavaScript、HTML/CSS、Python `unittest`、Node.js `node:test`、现有本地静态服务。

---

## 文件结构

- Modify: `.gitignore` - 排除本地运行时模型配置目录。
- Modify: `server.py` - 模型配置存储、校验、公开状态、连接测试和本地 API 路由。
- Modify: `scripts/test_search_service.py` - 后端配置、路由安全与模型切换测试。
- Modify: `src/main.js` - 设置页签、模型连接表单、状态和请求逻辑。
- Modify: `src/styles.css` - 设置页签与模型配置区的响应式样式。
- Modify: `scripts/test-workflow-reliability.mjs` - 前端安全存储、状态和交互测试。
- Modify: `index.html` - 静态资源版本键。
- Modify: `docs/deployment.md` - 记录本地网页配置与静态部署限制。

### Task 1: 本地模型配置存储与校验

**Files:**
- Modify: `.gitignore`
- Modify: `server.py:13-40`
- Test: `scripts/test_search_service.py`

- [x] **Step 1: 写入 URL、优先级和密钥隐藏的失败测试**

在 `scripts/test_search_service.py` 增加：

```python
    def test_model_url_accepts_https_and_loopback_http_only(self):
        self.assertEqual(server.normalize_model_url("https://api.example.com/v1/chat/completions"), "https://api.example.com/v1/chat/completions")
        self.assertEqual(server.normalize_model_url("http://127.0.0.1:11434/v1/chat/completions"), "http://127.0.0.1:11434/v1/chat/completions")
        for value in ["http://example.com/chat", "file:///tmp/key", "https://user:pass@example.com/chat"]:
            with self.subTest(value=value), self.assertRaises(server.ApiError):
                server.normalize_model_url(value)

    def test_local_model_config_overrides_environment_without_exposing_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            path.write_text(json.dumps({
                "apiUrl": "https://local.example/chat",
                "apiKey": "local-secret-1234",
                "model": "local-model",
                "updatedAt": "2026-09-15T00:00:00Z",
            }), encoding="utf-8")
            env = {"MODEL_API_URL": "https://env.example/chat", "MODEL_API_KEY": "env-secret", "MODEL_NAME": "env-model"}
            with patch.dict(os.environ, env, clear=True):
                active = server.active_model_config(path)
            self.assertEqual(active["model"], "local-model")
            public = server.public_model_config(path)
            self.assertEqual(public["keyHint"], "1234")
            self.assertNotIn("apiKey", public)
```

- [x] **Step 2: 运行测试并确认失败**

Run: `python3 -B -m unittest scripts.test_search_service.SearchServiceTest.test_model_url_accepts_https_and_loopback_http_only scripts.test_search_service.SearchServiceTest.test_local_model_config_overrides_environment_without_exposing_key`

Expected: FAIL，提示 `normalize_model_url` 或 `active_model_config` 未定义。

- [x] **Step 3: 实现配置校验、读取和公开状态**

在 `server.py` 增加：

```python
MODEL_CONFIG_DIR = ROOT / ".runtime"
MODEL_CONFIG_PATH = MODEL_CONFIG_DIR / "model-config.json"
MAX_MODEL_URL_LENGTH = 2048
MAX_MODEL_NAME_LENGTH = 200
MAX_MODEL_KEY_LENGTH = 10000


def normalize_model_url(value: object) -> str:
    url = str(value or "").strip()
    if not url or len(url) > MAX_MODEL_URL_LENGTH:
        raise ApiError("接口地址为空或过长")
    parsed = urllib.parse.urlparse(url)
    if parsed.username or parsed.password or not parsed.hostname:
        raise ApiError("接口地址格式无效")
    host = parsed.hostname.lower()
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and host in local_hosts):
        raise ApiError("公网模型接口必须使用 HTTPS")
    return url


def normalize_model_config(payload: dict, existing_key: str = "") -> dict:
    model = str(payload.get("model") or "").strip()
    api_key = str(payload.get("apiKey") or existing_key).strip()
    if not model or len(model) > MAX_MODEL_NAME_LENGTH:
        raise ApiError("模型名为空或过长")
    if not api_key or len(api_key) > MAX_MODEL_KEY_LENGTH:
        raise ApiError("API Key 为空或过长")
    return {"apiUrl": normalize_model_url(payload.get("apiUrl")), "apiKey": api_key, "model": model}


def load_local_model_config(path: Path = MODEL_CONFIG_PATH) -> dict | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        config = normalize_model_config(payload)
        return {**config, "updatedAt": str(payload.get("updatedAt") or "")}
    except (OSError, json.JSONDecodeError, ApiError, TypeError):
        return None


def environment_model_config() -> dict | None:
    payload = {"apiUrl": os.environ.get("MODEL_API_URL"), "apiKey": os.environ.get("MODEL_API_KEY"), "model": os.environ.get("MODEL_NAME")}
    try:
        return normalize_model_config(payload)
    except ApiError:
        return None


def active_model_config(path: Path = MODEL_CONFIG_PATH) -> dict | None:
    return load_local_model_config(path) or environment_model_config()


def public_model_config(path: Path = MODEL_CONFIG_PATH) -> dict:
    local = load_local_model_config(path)
    active = local or environment_model_config()
    return {
        "supported": True,
        "configured": bool(active),
        "source": "local-file" if local else "environment" if active else "none",
        "apiUrl": active["apiUrl"] if active else "",
        "model": active["model"] if active else "",
        "keyHint": active["apiKey"][-4:] if active else "",
    }
```

- [x] **Step 4: 写入保存、沿用密钥、权限和删除的失败测试**

```python
    def test_save_model_config_is_atomic_private_and_can_keep_existing_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".runtime" / "model-config.json"
            saved = server.save_local_model_config({
                "apiUrl": "https://api.example.com/chat",
                "apiKey": "first-secret",
                "model": "model-a",
            }, path)
            self.assertEqual(saved["model"], "model-a")
            saved = server.save_local_model_config({
                "apiUrl": "https://api.example.com/chat",
                "apiKey": "",
                "model": "model-b",
            }, path)
            self.assertEqual(saved["apiKey"], "first-secret")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            server.delete_local_model_config(path)
            self.assertFalse(path.exists())
```

- [x] **Step 5: 实现原子保存和删除**

```python
def save_local_model_config(payload: dict, path: Path = MODEL_CONFIG_PATH) -> dict:
    existing = load_local_model_config(path)
    config = normalize_model_config(payload, existing["apiKey"] if existing else "")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    stored = {**config, "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(json.dumps(stored, ensure_ascii=False, indent=2), encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(path)
        os.chmod(path, 0o600)
    finally:
        if temporary.exists():
            temporary.unlink()
    return stored


def delete_local_model_config(path: Path = MODEL_CONFIG_PATH) -> bool:
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False
```

同时在 `server.py` 导入 `datetime`，在 `.gitignore` 增加：

```gitignore
.runtime/
```

- [x] **Step 6: 运行后端配置测试并提交**

Run: `python3 -B -m unittest scripts.test_search_service`

Expected: 所有 Python 测试 PASS。

```bash
git add .gitignore server.py scripts/test_search_service.py
git commit -m "feat: persist local model configuration"
```

### Task 2: 配置 API、连接测试与抽取切换

**Files:**
- Modify: `server.py:43-90`
- Modify: `server.py:300-370`
- Test: `scripts/test_search_service.py`

- [x] **Step 1: 写入连接测试和统一活动配置的失败测试**

```python
    def test_model_connection_uses_draft_without_saving(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            response = io.BytesIO(json.dumps({"choices": [{"message": {"content": "OK"}}]}).encode())
            with patch.object(server.urllib.request, "urlopen", return_value=response) as urlopen:
                result = server.test_model_connection({
                    "apiUrl": "https://api.example.com/chat",
                    "apiKey": "draft-secret",
                    "model": "draft-model",
                }, path)
            self.assertTrue(result["ok"])
            self.assertEqual(result["model"], "draft-model")
            self.assertFalse(path.exists())
            request = urlopen.call_args.args[0]
            self.assertEqual(request.headers["Authorization"], "Bearer draft-secret")

    def test_ai_extraction_uses_saved_model_config(self):
        provider = io.BytesIO(json.dumps({"choices": [{"message": {"content": '{"fields":{},"evidence":[],"reasoning":[],"abstentions":[]}'}}]}).encode())
        saved = {"apiUrl": "https://saved.example/chat", "apiKey": "saved-secret", "model": "saved-model"}
        with patch.object(server, "active_model_config", return_value=saved), patch.object(server.urllib.request, "urlopen", return_value=provider) as urlopen:
            result = server.run_model_extraction({"sourceText": "原文", "schema": [{"id": "quote"}]})
        self.assertEqual(result["meta"]["model"], "saved-model")
        self.assertEqual(urlopen.call_args.args[0].full_url, "https://saved.example/chat")
```

- [x] **Step 2: 运行测试并确认失败**

Run: `python3 -B -m unittest scripts.test_search_service.SearchServiceTest.test_model_connection_uses_draft_without_saving scripts.test_search_service.SearchServiceTest.test_ai_extraction_uses_saved_model_config`

Expected: FAIL，提示 `test_model_connection` 未定义或抽取仍使用环境变量。

- [x] **Step 3: 实现连接测试并让抽取使用统一配置**

```python
def test_model_connection(payload: dict, path: Path = MODEL_CONFIG_PATH) -> dict:
    existing = load_local_model_config(path)
    config = normalize_model_config(payload, existing["apiKey"] if existing else "")
    request = urllib.request.Request(
        config["apiUrl"],
        data=json.dumps({
            "model": config["model"],
            "messages": [{"role": "user", "content": "只回复 OK"}],
            "temperature": 0,
            "max_tokens": 8,
        }, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {config['apiKey']}", "Content-Type": "application/json"},
        method="POST",
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read(65536)
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403}:
            raise ApiError("认证失败，请检查 API Key", 502) from exc
        if exc.code == 429:
            raise ApiError("模型服务限流，请稍后重试", 502) from exc
        raise ApiError(f"模型服务返回 {exc.code}", 502) from exc
    except Exception as exc:
        raise ApiError("模型服务连接失败", 502) from exc
    return {"ok": True, "model": config["model"], "elapsedMs": round((time.monotonic() - started) * 1000)}
```

在 `run_model_extraction()` 中使用：

```python
    config = active_model_config()
    if not config:
        raise ApiError("模型服务尚未配置", 503)
    api_url, api_key, model = config["apiUrl"], config["apiKey"], config["model"]
```

- [x] **Step 4: 写入本机同源检查和路由分派测试**

```python
    def test_model_config_mutations_require_local_same_origin(self):
        self.assertTrue(server.model_config_request_allowed("127.0.0.1", "http://127.0.0.1:8765"))
        self.assertTrue(server.model_config_request_allowed("::1", ""))
        self.assertFalse(server.model_config_request_allowed("192.168.1.10", "http://127.0.0.1:8765"))
        self.assertFalse(server.model_config_request_allowed("127.0.0.1", "https://evil.example"))
```

- [x] **Step 5: 实现安全检查与四个配置路由**

在 `WorkspaceHandler` 中加入 `GET /api/model-config`、`POST /api/model-config/test`、`PUT /api/model-config` 和 `DELETE /api/model-config`。写操作先调用：

```python
def model_config_request_allowed(client_host: str, origin: str) -> bool:
    if client_host not in {"127.0.0.1", "::1"}:
        return False
    if not origin:
        return True
    parsed = urllib.parse.urlparse(origin)
    return parsed.scheme in {"http", "https"} and (parsed.hostname or "").lower() in {"localhost", "127.0.0.1", "::1"}
```

路由返回只调用 `public_model_config()`，错误统一为 `{ "error": "简洁中文信息" }`。`public_cloud_config()` 的 `aiEnabled` 改为 `bool(active_model_config())`，让保存配置后前端立即识别 AI 能力。

- [x] **Step 6: 运行后端测试并提交**

Run: `python3 -B -m unittest scripts.test_search_service`

Expected: 配置、搜索和 AI 测试全部 PASS，测试输出不包含任何完整密钥。

```bash
git add server.py scripts/test_search_service.py
git commit -m "feat: expose local model configuration API"
```

### Task 3: 项目设置中的模型连接界面

**Files:**
- Modify: `src/main.js:130-180`
- Modify: `src/main.js:1878-1995`
- Modify: `src/main.js:5220-5480`
- Test: `scripts/test-workflow-reliability.mjs`

- [x] **Step 1: 写入页签、安全状态和静态降级的失败测试**

在 `scripts/test-workflow-reliability.mjs` 增加：

```js
test("project settings separates schema and local model connection without storing the key", async () => {
  const a = app();
  a.run("state.templatePanelExpanded = true; state.settingsTab = 'model'; render = () => {}; ");
  a.set("fetch", async (url) => ({ ok: url === "/api/model-config", status: 200, json: async () => ({
    supported: true, configured: true, source: "local-file", apiUrl: "https://api.example.com/chat", model: "model-a", keyHint: "1234"
  }) }));
  await a.run("loadModelConfig()")
  const markup = a.run("templateDetailsModal()");
  assert.match(markup, /data-settings-tab="schema"/);
  assert.match(markup, /data-settings-tab="model"/);
  assert.match(markup, /已保存 · 尾号 1234/);
  assert.doesNotMatch(markup, /local-secret|value="[^\"]*1234/);
  assert.equal(a.disk.has("calligraphy-model-config"), false);
});

test("static deployment disables model persistence without hiding environment AI", async () => {
  const a = app();
  a.set("fetch", async () => ({ ok: false, status: 404, json: async () => ({}) }));
  await a.run("loadModelConfig()");
  assert.equal(a.get("state.modelSettings.supported"), false);
  assert.match(a.run("modelSettingsPanel()"), /当前部署不支持网页配置/);
  assert.match(a.run("modelSettingsPanel()"), /data-model-save disabled/);
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `node --test --test-name-pattern="project settings|static deployment" scripts/test-workflow-reliability.mjs`

Expected: FAIL，提示 `loadModelConfig` 或 `modelSettingsPanel` 未定义。

- [x] **Step 3: 增加设置状态、页签和模型表单**

在 `state` 中增加：

```js
  settingsTab: "schema",
  modelSettings: {
    status: "idle", supported: null, configured: false, source: "none",
    apiUrl: "", model: "", keyHint: "", draftApiUrl: "", draftModel: "",
    draftApiKey: "", message: ""
  },
```

将模态框标题从“字段模板详情”改为“项目设置”，并在 `templateDetailsModal()` 顶部加入：

```html
<div class="settings-tabs" role="tablist" aria-label="项目设置">
  <button type="button" role="tab" data-settings-tab="schema" aria-selected="${String(state.settingsTab === "schema")}">字段模板</button>
  <button type="button" role="tab" data-settings-tab="model" aria-selected="${String(state.settingsTab === "model")}">模型连接</button>
</div>
```

主体按 `state.settingsTab` 渲染 `templateEditorContent()` 或 `modelSettingsPanel()`。模型表单使用：

```html
<form class="model-settings-form" id="modelSettingsForm">
  <label>接口地址<input name="apiUrl" type="url" required value="${escapeHtml(settings.draftApiUrl)}" /></label>
  <label>API Key<input name="apiKey" type="password" autocomplete="off" value="" placeholder="${settings.configured ? "留空则沿用已保存密钥" : "请输入 API Key"}" /></label>
  <label>模型名<input name="model" required value="${escapeHtml(settings.draftModel)}" /></label>
  <p class="model-key-status">${settings.keyHint ? `已保存 · 尾号 ${escapeHtml(settings.keyHint)}` : "尚未保存密钥"}</p>
  <p class="model-settings-message" aria-live="polite">${escapeHtml(settings.message)}</p>
  <div class="model-settings-actions">
    <button type="button" data-model-test ${disabled}>测试连接</button>
    <button type="submit" data-model-save ${disabled}>保存配置</button>
    <button type="button" data-model-delete ${settings.source === "local-file" ? "" : "disabled"}>删除配置</button>
  </div>
</form>
```

- [x] **Step 4: 实现读取、测试、保存和删除请求**

增加 `loadModelConfig()`、`testModelConfig(form)`、`saveModelConfig(form)`、`deleteModelConfig()`。请求体只来自当前表单；成功保存或关闭设置时执行：

```js
function clearModelKeyDraft() {
  state.modelSettings.draftApiKey = "";
  const input = document.querySelector("#modelSettingsForm [name='apiKey']");
  if (input) input.value = "";
}
```

`closeTemplatePanel()` 同样清空 Key 草稿。所有失败保留用户当前表单值，但错误消息不得拼接请求体或密钥。`DELETE` 前沿用现有 `window.confirm()`。

- [x] **Step 5: 绑定页签和表单事件**

在 `attachGlobalEvents()` 中绑定：

```js
document.querySelectorAll("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => {
  state.settingsTab = button.dataset.settingsTab;
  render();
  if (state.settingsTab === "model" && state.modelSettings.status === "idle") loadModelConfig();
}));
document.querySelector("[data-model-test]")?.addEventListener("click", (event) => testModelConfig(event.currentTarget.form));
document.querySelector("#modelSettingsForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveModelConfig(event.currentTarget);
});
document.querySelector("[data-model-delete]")?.addEventListener("click", deleteModelConfig);
```

- [x] **Step 6: 增加前端请求与持久化安全测试并提交**

补充测试，拦截 `fetch`，确认测试使用 `POST`、保存使用 `PUT`、删除使用 `DELETE`；断言 `workspacePayload()`、`localStorage` 和 HTML 均不包含测试 API Key。

Run: `node --test --test-name-pattern="project settings|model configuration|static deployment" scripts/test-workflow-reliability.mjs`

Expected: 新增前端测试全部 PASS。

```bash
git add src/main.js scripts/test-workflow-reliability.mjs
git commit -m "feat: add model connection settings"
```

### Task 4: 响应式样式、文档与完整验收

**Files:**
- Modify: `src/styles.css:3600-4470`
- Modify: `index.html:9-22`
- Modify: `docs/deployment.md`
- Test: `scripts/test-workflow-reliability.mjs`

- [ ] **Step 1: 增加设置布局约束测试**

```js
test("model settings uses the shared modal and bounded responsive controls", () => {
  const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.settings-tabs\s*\{/);
  assert.match(css, /\.model-settings-grid\s*\{/);
  assert.match(css, /minmax\(0,\s*1fr\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
});
```

- [ ] **Step 2: 运行布局测试并确认失败**

Run: `node --test --test-name-pattern="model settings uses" scripts/test-workflow-reliability.mjs`

Expected: FAIL，提示缺少模型设置选择器。

- [ ] **Step 3: 实现与现有工作台一致的响应式样式**

在 `src/styles.css` 增加：

```css
.settings-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid var(--line);
}

.settings-tabs button {
  min-block-size: 42px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
}

.settings-tabs button[aria-selected="true"] {
  border-bottom-color: var(--green);
  color: var(--green-deep);
}

.model-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.model-settings-grid .wide,
.model-settings-actions,
.model-settings-message {
  grid-column: 1 / -1;
}

@media (max-width: 760px) {
  .model-settings-grid { grid-template-columns: minmax(0, 1fr); }
  .model-settings-grid .wide,
  .model-settings-actions,
  .model-settings-message { grid-column: auto; }
  .model-settings-actions { display: grid; grid-template-columns: minmax(0, 1fr); }
}
```

复用现有输入框、按钮、边框和色彩变量，不引入新卡片层级。

- [ ] **Step 4: 更新资源版本和部署文档**

将 `index.html` 中 `src/styles.css` 与 `src/main.js` 的查询版本更新为 `20260915-model-settings`。在 `docs/deployment.md` 记录：本地 `server.py` 支持 `.runtime/model-config.json`；纯静态 GitHub Pages 只能展示设置能力限制；Vercel 继续通过环境变量配置模型。

- [ ] **Step 5: 运行全部自动化验证**

Run: `npm run check && npm test && git diff --check`

Expected: JavaScript/Python 语法、云端隔离、全部 Node/Python 测试和空白检查 PASS。

- [ ] **Step 6: 重启本地服务并完成浏览器验收**

重新启动 `npm start`，打开 `http://127.0.0.1:8765/index.html#home`：

1. 项目设置可在字段模板和模型连接间切换。
2. 当前 DeepSeek 配置只显示 URL、模型和 Key 尾号。
3. 用当前配置执行一次测试连接，成功后不改变保存内容。
4. 临时切换模型名进行表单验证，不保存无效配置。
5. 关闭再打开设置，API Key 输入为空。
6. 在 1280x800 与 390x844 检查无重叠、无横向溢出。
7. 直接请求已带版本的 CSS 和 JS，确认均返回 `200` 且包含新选择器/函数。

- [ ] **Step 7: 检查密钥泄漏并提交**

Run: `rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' 'sk-[A-Za-z0-9]{20,}' index.html src scripts docs || true`

Expected: 无真实密钥命中。

```bash
git add src/styles.css index.html docs/deployment.md scripts/test-workflow-reliability.mjs
git commit -m "style: finish responsive model settings"
```
