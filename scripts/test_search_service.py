import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class SearchServiceTest(unittest.TestCase):
    def test_model_url_accepts_https_and_loopback_http_only(self):
        self.assertEqual(
            server.normalize_model_url("https://api.example.com/v1/chat/completions"),
            "https://api.example.com/v1/chat/completions",
        )
        self.assertEqual(
            server.normalize_model_url("http://127.0.0.1:11434/v1/chat/completions"),
            "http://127.0.0.1:11434/v1/chat/completions",
        )
        for value in [
            "http://example.com/chat",
            "file:///tmp/key",
            "https://user:pass@example.com/chat",
        ]:
            with self.subTest(value=value), self.assertRaises(server.ApiError):
                server.normalize_model_url(value)

    def test_local_model_config_overrides_environment_without_exposing_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            path.write_text(
                json.dumps(
                    {
                        "apiUrl": "https://local.example/chat",
                        "apiKey": "local-secret-1234",
                        "model": "local-model",
                        "updatedAt": "2026-09-15T00:00:00Z",
                    }
                ),
                encoding="utf-8",
            )
            env = {
                "MODEL_API_URL": "https://env.example/chat",
                "MODEL_API_KEY": "env-secret",
                "MODEL_NAME": "env-model",
            }
            with patch.dict(os.environ, env, clear=True):
                active = server.active_model_config(path)
                public = server.public_model_config(path)
            self.assertEqual(active["model"], "local-model")
            self.assertEqual(public["keyHint"], "1234")
            self.assertNotIn("apiKey", public)

    def test_save_model_config_is_atomic_private_and_can_keep_existing_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".runtime" / "model-config.json"
            saved = server.save_local_model_config(
                {
                    "apiUrl": "https://api.example.com/chat",
                    "apiKey": "first-secret",
                    "model": "model-a",
                },
                path,
            )
            self.assertEqual(saved["model"], "model-a")
            saved = server.save_local_model_config(
                {
                    "apiUrl": "https://api.example.com/chat",
                    "apiKey": "",
                    "model": "model-b",
                },
                path,
            )
            self.assertEqual(saved["apiKey"], "first-secret")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            server.delete_local_model_config(path)
            self.assertFalse(path.exists())

    def test_local_env_loader_preserves_shell_values(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env.local"
            env_path.write_text(
                "# local model configuration\n"
                "MODEL_API_URL=https://example.test/chat\n"
                "MODEL_API_KEY='file-secret'\n"
                "export MODEL_NAME=deepseek-chat\n"
                "INVALID LINE\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"MODEL_API_KEY": "shell-secret"}, clear=True):
                server.load_env_file(env_path)
                self.assertEqual(os.environ["MODEL_API_URL"], "https://example.test/chat")
                self.assertEqual(os.environ["MODEL_API_KEY"], "shell-secret")
                self.assertEqual(os.environ["MODEL_NAME"], "deepseek-chat")

    def test_parsed_results_are_not_replaced_by_fallback(self):
        body = b'<a class="result__a" href="https://example.org/source">Source title</a><a class="result__snippet">Source context</a>'
        with patch.object(server.urllib.request, "urlopen", return_value=io.BytesIO(body)):
            results = server.search_duckduckgo("test")
        self.assertEqual(results, [{"title": "Source title", "url": "https://example.org/source", "snippet": "Source context"}])

    def test_unparsed_response_is_not_a_search_result(self):
        with patch.object(server.urllib.request, "urlopen", return_value=io.BytesIO(b"<html>No results</html>")):
            self.assertEqual(server.search_duckduckgo("test"), [])

    def test_network_failure_has_no_fabricated_results(self):
        handler = object.__new__(server.WorkspaceHandler)
        responses = []
        handler._send_json = lambda payload, status=200: responses.append((payload, status))
        with patch.object(server, "search_duckduckgo", side_effect=TimeoutError("timeout")):
            handler._handle_search("q=test")
        self.assertEqual(responses[0][1], 502)
        self.assertEqual(responses[0][0]["results"], [])

    def test_ai_extraction_filters_unknown_fields_and_verifies_evidence(self):
        provider_body = json.dumps({"choices": [{"message": {"content": json.dumps({
            "fields": {"author": "王羲之", "unknown": "drop"},
            "evidence": [{"fieldId": "author", "quote": "王羲之"}],
            "reasoning": [
                {
                    "fieldId": "author",
                    "decision": "change",
                    "reason": "原文直接出现书家姓名。",
                    "evidenceQuote": "王羲之",
                },
                {
                    "fieldId": "unknown",
                    "decision": "keep",
                    "reason": "未知字段必须丢弃。",
                    "evidenceQuote": "王羲之",
                },
                {
                    "fieldId": "script",
                    "decision": "guess",
                    "reason": "无效决策必须丢弃。",
                    "evidenceQuote": "王羲之",
                },
                {
                    "fieldId": "author",
                    "decision": "keep",
                    "reason": "重复字段必须丢弃。",
                    "evidenceQuote": "王羲之",
                },
            ],
            "abstentions": [],
        }, ensure_ascii=False)}}]}).encode("utf-8")
        payload = {
            "sourceText": "王羲之善草书。",
            "schema": [
                {"id": "author", "label": "书家", "evidenceRequired": True},
                {"id": "script", "label": "书体", "evidenceRequired": True},
            ],
            "promptVersion": 2,
        }
        env = {"MODEL_API_URL": "https://api.deepseek.com/chat/completions", "MODEL_API_KEY": "secret", "MODEL_NAME": "test-model"}
        with patch.dict(os.environ, env, clear=False), patch.object(server.urllib.request, "urlopen", return_value=io.BytesIO(provider_body)) as urlopen:
            result = server.run_model_extraction(payload)
        request_body = json.loads(urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(request_body["thinking"], {"type": "disabled"})
        self.assertEqual(request_body["max_tokens"], 2400)
        user_prompt = request_body["messages"][1]["content"]
        self.assertIn('"reasoning"', user_prompt)
        self.assertIn("每个字段都必须输出一条 reasoning", user_prompt)
        self.assertIn("即使保留当前值，也要说明保留理由", user_prompt)
        self.assertEqual(result["proposal"]["fields"], {"author": "王羲之"})
        self.assertTrue(result["proposal"]["evidence"][0]["verified"])
        self.assertEqual(result["proposal"]["reasoning"], [{
            "fieldId": "author",
            "decision": "change",
            "reason": "原文直接出现书家姓名。",
            "evidenceQuote": "王羲之",
            "evidenceVerified": True,
        }])
        self.assertEqual(result["meta"]["promptVersion"], 2)

    def test_ai_reasoning_limits_text_and_marks_unmatched_evidence(self):
        schema = [{"id": "author", "label": "书家"}]
        result = server.normalize_ai_proposal({
            "reasoning": [{
                "fieldId": "author",
                "decision": "keep",
                "reason": "理" * 900,
                "evidenceQuote": "未" * 600,
            }],
        }, schema, "王羲之善草书。")

        reasoning = result["reasoning"][0]
        self.assertEqual(len(reasoning["reason"]), 800)
        self.assertEqual(len(reasoning["evidenceQuote"]), 500)
        self.assertFalse(reasoning["evidenceVerified"])

    def test_ai_extraction_requires_server_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(server.ApiError) as error:
                server.run_model_extraction({"sourceText": "原文", "schema": [{"id": "quote"}]})
        self.assertEqual(error.exception.status, 503)

    def test_ai_extraction_rejects_invalid_schema_with_400(self):
        env = {"MODEL_API_URL": "https://api.deepseek.com/chat/completions", "MODEL_API_KEY": "secret", "MODEL_NAME": "test-model"}
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaises(server.ApiError) as error:
                server.run_model_extraction({"sourceText": "原文", "schema": [{"id": "bad field"}]})
        self.assertEqual(error.exception.status, 400)
        self.assertIn("无效字段", str(error.exception))

    def test_ai_extraction_falls_back_to_prompt_version_1_for_nonnumeric_input(self):
        provider_body = json.dumps({"choices": [{"message": {"content": json.dumps({
            "fields": {}, "evidence": [], "reasoning": [], "abstentions": []
        })}}]}).encode("utf-8")
        payload = {"sourceText": "原文", "schema": [{"id": "author", "label": "书家"}], "promptVersion": "not-a-number"}
        env = {"MODEL_API_URL": "https://api.deepseek.com/chat/completions", "MODEL_API_KEY": "secret", "MODEL_NAME": "test-model"}
        with patch.dict(os.environ, env, clear=False), patch.object(server.urllib.request, "urlopen", return_value=io.BytesIO(provider_body)):
            result = server.run_model_extraction(payload)
        self.assertEqual(result["meta"]["promptVersion"], 1)

    def test_public_config_exposes_ai_capability_for_legacy_local_config(self):
        with patch.object(server.Path, "exists", return_value=True), patch.object(server.Path, "read_text", return_value='{"enabled": false}'), patch.dict(os.environ, {}, clear=True):
            self.assertEqual(server.public_cloud_config(), {"enabled": False, "aiEnabled": False})


if __name__ == "__main__":
    unittest.main()
