import io
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class SearchServiceTest(unittest.TestCase):
    def setUp(self):
        runs = getattr(server, "CONSENSUS_RUNS", None)
        if runs is not None:
            runs.clear()

    @staticmethod
    def consensus_profiles():
        return [
            {
                "id": profile_id,
                "displayName": profile_id.title(),
                "apiUrl": f"https://{profile_id}.test/chat",
                "apiKey": f"key-{profile_id}",
                "model": f"{family}-model",
                "modelFamily": family,
                "enabled": True,
            }
            for profile_id, family in (
                ("primary", "family-a"),
                ("secondary", "family-b"),
                ("tertiary", "family-c"),
            )
        ]

    @staticmethod
    def consensus_proposal(value="苏轼"):
        return {
            "fields": {"author": value},
            "evidence": [
                {
                    "fieldId": "author",
                    "quote": "苏轼",
                    "verified": True,
                    "location": {"page": 12, "paragraph": 2},
                }
            ],
            "reasoning": [],
            "abstentions": [],
        }

    def test_consensus_runs_three_profiles_concurrently_and_isolates_one_failure(self):
        profiles = self.consensus_profiles()
        barrier = threading.Barrier(3, timeout=2)

        def fake_runner(_payload, profile):
            barrier.wait()
            if profile["id"] == "secondary":
                raise server.ApiError("模型服务限流", 502)
            return {
                "profileId": profile["id"],
                "status": "success",
                "profile": server.public_model_profile(profile),
                "proposal": self.consensus_proposal(),
                "elapsedMs": 10,
            }

        payload = {
            "runId": "run-1",
            "sourceText": "苏轼论书",
            "schema": [{"id": "author", "required": True}],
            "reviewMode": "auto",
            "defaultConsensus": "standard",
        }
        with (
            patch.object(server, "active_model_profiles", return_value=profiles),
            patch.object(server, "run_model_with_profile", side_effect=fake_runner),
        ):
            result = server.run_model_consensus(payload)
        self.assertEqual([item["profileId"] for item in result["models"]], ["primary", "secondary", "tertiary"])
        self.assertEqual(result["models"][1]["status"], "error")
        self.assertEqual(result["models"][1]["error"], "模型服务限流")
        self.assertEqual(result["decision"], "needs_human_review")
        self.assertIn("model_failure", result["blockers"])

    def test_consensus_run_id_is_idempotent(self):
        profiles = self.consensus_profiles()

        def fake_runner(_payload, profile):
            return {
                "profileId": profile["id"],
                "status": "success",
                "profile": server.public_model_profile(profile),
                "proposal": self.consensus_proposal(),
                "elapsedMs": 1,
            }

        payload = {
            "runId": "same-run",
            "sourceText": "苏轼论书",
            "schema": [{"id": "author", "required": True}],
            "reviewMode": "auto",
            "defaultConsensus": "standard",
        }
        with (
            patch.object(server, "active_model_profiles", return_value=profiles),
            patch.object(server, "run_model_with_profile", side_effect=fake_runner) as runner,
        ):
            first = server.run_model_consensus(payload)
            second = server.run_model_consensus({**payload, "sourceText": "被重放的不同输入"})
        self.assertIs(first, second)
        self.assertEqual(runner.call_count, 3)
        self.assertEqual(first["decision"], "auto_approve_record")
        self.assertEqual(first["snapshotVersion"], 1)

    def test_consensus_validates_source_metadata_without_model_votes(self):
        profiles = self.consensus_profiles()

        def fake_runner(_payload, profile):
            return {
                "profileId": profile["id"],
                "status": "success",
                "profile": server.public_model_profile(profile),
                "proposal": self.consensus_proposal(),
                "elapsedMs": 1,
            }

        payload = {
            "runId": "system-fields-run",
            "sourceText": "苏轼论书",
            "sourceFile": "page_12.txt",
            "pageNo": "12",
            "currentFields": {
                "author": "苏轼",
                "pageNo": "12",
                "sourceFile": "page_12.txt",
            },
            "schema": [
                {"id": "author", "required": True, "evidenceRequired": True},
                {"id": "pageNo", "required": True, "validationMode": "system"},
                {"id": "sourceFile", "required": True, "validationMode": "system"},
            ],
            "reviewMode": "auto",
            "defaultConsensus": "standard",
        }
        with (
            patch.object(server, "active_model_profiles", return_value=profiles),
            patch.object(server, "run_model_with_profile", side_effect=fake_runner),
        ):
            result = server.run_model_consensus(payload)

        self.assertEqual(result["decision"], "auto_approve_record")
        self.assertEqual(result["fields"]["pageNo"]["status"], "unanimous")
        self.assertEqual(result["fields"]["pageNo"]["validationSource"], "system")
        self.assertEqual(result["fields"]["pageNo"]["voteCount"], 0)
        self.assertEqual(result["fields"]["sourceFile"]["value"], "page_12.txt")

    def test_missing_source_metadata_is_reported_as_a_system_blocker(self):
        payload = {
            "sourceText": "苏轼论书",
            "sourceFile": "page_12.txt",
            "pageNo": "",
            "currentFields": {"pageNo": ""},
            "schema": [{"id": "pageNo", "required": True, "validationMode": "system"}],
            "reviewMode": "assist",
            "defaultConsensus": "standard",
            "fieldOverrides": {},
            "aliases": {},
        }
        result = server.finalize_consensus(payload, [])
        self.assertEqual(result["fields"]["pageNo"]["status"], "blocked")
        self.assertEqual(result["fields"]["pageNo"]["reason"], "missing_value")
        self.assertEqual(result["fields"]["pageNo"]["validationSource"], "system")
        self.assertIn("pageNo:blocked", result["blockers"])

    def test_schema_assigns_field_specific_comparison_modes(self):
        schema = server.normalize_ai_schema([
            {"id": "quote"},
            {"id": "scriptType"},
            {"id": "confidence"},
            {"id": "gate"},
            {"id": "issue"},
            {"id": "note"},
            {"id": "author"},
        ])
        modes = {field["id"]: field["comparisonMode"] for field in schema}
        self.assertEqual(modes, {
            "quote": "quote",
            "scriptType": "script_type",
            "confidence": "confidence",
            "gate": "token_set",
            "issue": "advisory",
            "note": "advisory",
            "author": "exact",
        })

    def test_finalize_uses_semantic_comparison_and_ignores_advisory_wording(self):
        current_quote = "落简挥毫，有郢匠乘风之势"
        payload = server.normalize_consensus_payload({
            "sourceText": current_quote,
            "currentFields": {"quote": current_quote, "note": "原备注"},
            "schema": [{"id": "quote", "required": True}, {"id": "note"}],
            "reviewMode": "auto",
            "defaultConsensus": "loose",
        }, "semantic-run")
        profiles = self.consensus_profiles()
        quotes = [current_quote, "落简挥毫, 有郢匠乘风之势", current_quote + "。"]
        notes = ["可直接保留", "建议保留", "保留即可"]
        ordered = [{
            "profileId": profile["id"],
            "status": "success",
            "profile": server.public_model_profile(profile),
            "proposal": {
                "fields": {"quote": quotes[index], "note": notes[index]},
                "evidence": [],
                "reasoning": [],
                "abstentions": [],
            },
            "elapsedMs": 1,
        } for index, profile in enumerate(profiles)]
        result = server.finalize_consensus(payload, ordered)
        self.assertEqual(result["fields"]["quote"]["status"], "unanimous")
        self.assertEqual(result["fields"]["quote"]["value"], current_quote)
        self.assertEqual(result["fields"]["note"]["status"], "blocked")
        self.assertFalse(result["fields"]["note"]["blocking"])
        self.assertEqual(result["blockers"], [])
        self.assertEqual(result["decision"], "auto_approve_record")

    def test_retry_replaces_only_one_model_and_appends_snapshot(self):
        profiles = self.consensus_profiles()

        def initial_runner(_payload, profile):
            if profile["id"] == "secondary":
                raise server.ApiError("模型服务超时", 502)
            return {
                "profileId": profile["id"],
                "status": "success",
                "profile": server.public_model_profile(profile),
                "proposal": self.consensus_proposal(),
                "elapsedMs": 1,
            }

        payload = {
            "runId": "retry-run",
            "sourceText": "苏轼论书",
            "schema": [{"id": "author", "required": True}],
            "reviewMode": "auto",
            "defaultConsensus": "standard",
        }
        with (
            patch.object(server, "active_model_profiles", return_value=profiles),
            patch.object(server, "run_model_with_profile", side_effect=initial_runner),
        ):
            first = server.run_model_consensus(payload)

        retried = {
            "profileId": "secondary",
            "status": "success",
            "profile": server.public_model_profile(profiles[1]),
            "proposal": self.consensus_proposal(),
            "elapsedMs": 5,
        }
        with patch.object(server, "run_model_with_profile", return_value=retried) as runner:
            second = server.retry_consensus_model("retry-run", "secondary", {})
        runner.assert_called_once()
        self.assertEqual(second["snapshotVersion"], 2)
        self.assertEqual(second["decision"], "auto_approve_record")
        self.assertEqual(first["models"][1]["status"], "error")
        self.assertEqual(second["models"][0], first["models"][0])
        self.assertEqual(second["models"][2], first["models"][2])
        self.assertEqual(len(server.CONSENSUS_RUNS["retry-run"]["snapshots"]), 2)

    def test_model_proposal_rejects_json_with_invalid_schema(self):
        profile = self.consensus_profiles()[0]
        provider = io.BytesIO(
            json.dumps(
                {"choices": [{"message": {"content": json.dumps({"fields": []})}}]}
            ).encode()
        )
        with patch.object(server.urllib.request, "urlopen", return_value=provider):
            with self.assertRaises(server.ApiError) as error:
                server.request_model_proposal(
                    {
                        "sourceText": "苏轼论书",
                        "schema": [{"id": "author", "required": True}],
                    },
                    profile,
                )
        self.assertEqual(error.exception.status, 502)
        self.assertIn("格式", str(error.exception))

    def test_model_proposal_uses_kimi_non_thinking_mode(self):
        profile = {
            **self.consensus_profiles()[0],
            "model": "kimi-k2.6",
            "modelFamily": "kimi",
        }
        provider = io.BytesIO(
            json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "fields": {"author": "苏轼"},
                                        "evidence": [],
                                        "reasoning": {"author": "原文直指"},
                                        "abstentions": [],
                                    }
                                )
                            }
                        }
                    ]
                }
            ).encode()
        )
        with patch.object(server.urllib.request, "urlopen", return_value=provider) as urlopen:
            server.request_model_proposal(
                {
                    "sourceText": "苏轼论书",
                    "schema": [{"id": "author", "required": True}],
                },
                profile,
            )
        request_body = json.loads(urlopen.call_args.args[0].data)
        self.assertNotIn("temperature", request_body)
        self.assertEqual(request_body["thinking"], {"type": "disabled"})
        self.assertEqual(request_body["max_tokens"], 1200)

    def test_model_proposal_repairs_missing_fields_once(self):
        profile = self.consensus_profiles()[0]
        first = io.BytesIO(json.dumps({"choices": [{"message": {"content": json.dumps({
            "fields": {},
            "evidence": {},
            "reasoning": {},
            "abstentions": [{"fieldId": "author", "reason": "证据不足"}],
        }, ensure_ascii=False)}}]}).encode())
        second = io.BytesIO(json.dumps({"choices": [{"message": {"content": json.dumps({
            "fields": {"author": "苏轼"},
            "evidence": {"author": "苏轼"},
            "reasoning": {"author": "原文直指"},
            "abstentions": [],
        }, ensure_ascii=False)}}]}).encode())

        with patch.object(server.urllib.request, "urlopen", side_effect=[first, second]) as urlopen:
            result = server.request_model_proposal({
                "sourceText": "苏轼论书",
                "currentFields": {"author": "王羲之"},
                "schema": [{"id": "author", "label": "书家", "required": True}],
            }, profile)

        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(result["fields"], {"author": "苏轼"})
        self.assertEqual(result["answerSources"], {"author": "repair"})
        self.assertEqual(result["abstentions"], [])
        repair_body = json.loads(urlopen.call_args_list[1].args[0].data.decode("utf-8"))
        self.assertEqual(repair_body["max_tokens"], 400)
        self.assertIn("只补答以下字段", repair_body["messages"][1]["content"])

    def test_model_proposal_fails_when_repair_still_omits_a_field(self):
        profile = self.consensus_profiles()[0]
        incomplete = lambda: io.BytesIO(json.dumps({"choices": [{"message": {"content": json.dumps({
            "fields": {}, "evidence": {}, "reasoning": {}, "abstentions": [],
        })}}]}).encode())

        with patch.object(server.urllib.request, "urlopen", side_effect=[incomplete(), incomplete()]):
            with self.assertRaises(server.ApiError) as error:
                server.request_model_proposal({
                    "sourceText": "苏轼论书",
                    "currentFields": {"author": "王羲之"},
                    "schema": [{"id": "author", "label": "书家", "required": True}],
                }, profile)

        self.assertEqual(str(error.exception), "模型补答后仍缺少字段：书家")

    def test_model_proposal_maps_provider_errors_to_safe_messages(self):
        profile = self.consensus_profiles()[0]
        payload = {
            "sourceText": "苏轼论书",
            "schema": [{"id": "author", "required": True}],
        }
        cases = [
            (
                server.urllib.error.HTTPError(
                    profile["apiUrl"], 401, "secret provider body", {}, None
                ),
                "模型认证失败",
            ),
            (
                server.urllib.error.HTTPError(
                    profile["apiUrl"], 429, "secret provider body", {}, None
                ),
                "模型服务限流",
            ),
            (TimeoutError("private timeout detail"), "模型服务超时"),
        ]
        for provider_error, expected in cases:
            with self.subTest(expected=expected), patch.object(
                server.urllib.request, "urlopen", side_effect=provider_error
            ):
                with self.assertRaises(server.ApiError) as error:
                    server.request_model_proposal(payload, profile)
                self.assertEqual(str(error.exception), expected)

    def test_legacy_model_config_becomes_primary_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            path.write_text(
                json.dumps(
                    {
                        "apiUrl": "https://one.test/chat",
                        "apiKey": "secret-1234",
                        "model": "deepseek-chat",
                    }
                ),
                encoding="utf-8",
            )
            bundle = server.load_model_config_bundle(path)
            self.assertEqual(bundle["profiles"][0]["id"], "primary")
            self.assertEqual(bundle["profiles"][0]["modelFamily"], "deepseek")
            public = server.public_model_config(path)
            self.assertEqual(len(public["profiles"]), 1)
            self.assertNotIn("apiKey", public["profiles"][0])
            self.assertEqual(public["profiles"][0]["keyHint"], "1234")
            self.assertEqual(public["model"], "deepseek-chat")

    def test_three_profiles_preserve_existing_keys_independently(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            first = server.save_model_config_bundle(
                {
                    "profiles": [
                        {
                            "id": "primary",
                            "displayName": "DeepSeek",
                            "apiUrl": "https://a.test/chat",
                            "apiKey": "key-a",
                            "model": "deepseek-chat",
                            "modelFamily": "deepseek",
                            "enabled": True,
                        },
                        {
                            "id": "secondary",
                            "displayName": "Qwen",
                            "apiUrl": "https://b.test/chat",
                            "apiKey": "key-b",
                            "model": "qwen-max",
                            "modelFamily": "qwen",
                            "enabled": True,
                        },
                        {
                            "id": "tertiary",
                            "displayName": "GPT",
                            "apiUrl": "https://c.test/chat",
                            "apiKey": "key-c",
                            "model": "gpt-5",
                            "modelFamily": "gpt",
                            "enabled": False,
                        },
                    ],
                    "policy": {
                        "reviewMode": "auto",
                        "defaultConsensus": "strict",
                        "fieldOverrides": {"author": {"manualOnly": True}},
                    },
                },
                path,
            )
            updated = server.save_model_config_bundle(
                {
                    "profiles": [
                        {**first["profiles"][0], "apiKey": ""},
                        {**first["profiles"][1], "apiKey": ""},
                        {**first["profiles"][2], "apiKey": "replacement-c"},
                    ],
                    "policy": first["policy"],
                },
                path,
            )
            self.assertEqual(
                [item["apiKey"] for item in updated["profiles"]],
                ["key-a", "key-b", "replacement-c"],
            )
            self.assertEqual([item["id"] for item in server.active_model_profiles(path)], ["primary", "secondary"])
            public = server.public_model_config(path)
            self.assertEqual(public["policy"]["reviewMode"], "auto")
            self.assertNotIn("apiKey", json.dumps(public))

    def test_bundle_rejects_duplicate_or_unknown_profile_slots(self):
        base = {
            "displayName": "A",
            "apiUrl": "https://a.test/chat",
            "apiKey": "key-a",
            "model": "model-a",
            "modelFamily": "family-a",
            "enabled": True,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            with self.assertRaises(server.ApiError):
                server.save_model_config_bundle(
                    {"profiles": [{**base, "id": "primary"}, {**base, "id": "primary"}]},
                    path,
                )
            with self.assertRaises(server.ApiError):
                server.save_model_config_bundle(
                    {"profiles": [{**base, "id": "fourth"}]}, path
                )

    def test_legacy_single_profile_save_does_not_delete_other_slots(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            server.save_model_config_bundle(
                {
                    "profiles": [
                        {
                            "id": profile_id,
                            "displayName": profile_id,
                            "apiUrl": f"https://{profile_id}.test/chat",
                            "apiKey": f"key-{profile_id}",
                            "model": f"model-{profile_id}",
                            "modelFamily": profile_id,
                            "enabled": True,
                        }
                        for profile_id in ("primary", "secondary")
                    ]
                },
                path,
            )
            server.save_local_model_config(
                {
                    "apiUrl": "https://updated.test/chat",
                    "apiKey": "",
                    "model": "updated-model",
                },
                path,
            )
            bundle = server.load_model_config_bundle(path)
            self.assertEqual([item["id"] for item in bundle["profiles"]], ["primary", "secondary"])
            self.assertEqual(bundle["profiles"][0]["apiKey"], "key-primary")
            self.assertEqual(bundle["profiles"][1]["apiKey"], "key-secondary")

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

    def test_model_connection_uses_draft_without_saving(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            response = io.BytesIO(
                json.dumps({"choices": [{"message": {"content": "OK"}}]}).encode()
            )
            with patch.object(server.urllib.request, "urlopen", return_value=response) as urlopen:
                result = server.test_model_connection(
                    {
                        "apiUrl": "https://api.example.com/chat",
                        "apiKey": "draft-secret",
                        "model": "draft-model",
                    },
                    path,
                )
            self.assertTrue(result["ok"])
            self.assertEqual(result["model"], "draft-model")
            self.assertFalse(path.exists())
            request = urlopen.call_args.args[0]
            self.assertEqual(request.get_header("Authorization"), "Bearer draft-secret")

    def test_model_connection_uses_kimi_non_thinking_mode(self):
        response = io.BytesIO(
            json.dumps({"choices": [{"message": {"content": "OK"}}]}).encode()
        )
        with patch.object(server.urllib.request, "urlopen", return_value=response) as urlopen:
            server.test_model_connection(
                {
                    "apiUrl": "https://api.moonshot.cn/v1/chat/completions",
                    "apiKey": "draft-secret",
                    "model": "kimi-k2.6",
                    "modelFamily": "kimi",
                }
            )
        request_body = json.loads(urlopen.call_args.args[0].data)
        self.assertNotIn("temperature", request_body)
        self.assertEqual(request_body["thinking"], {"type": "disabled"})

    def test_qwen_requests_disable_thinking_mode(self):
        options = server.model_request_options({
            "model": "qwen-plus",
            "modelFamily": "qwen",
        })
        self.assertEqual(options, {"temperature": 0, "enable_thinking": False})

    def test_ai_extraction_uses_saved_model_config(self):
        provider = io.BytesIO(
            json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "fields": {"quote": "原文"},
                                        "evidence": {"quote": "原文"},
                                        "reasoning": {"quote": "原文直接命中"},
                                        "abstentions": [],
                                    }
                                )
                            }
                        }
                    ]
                }
            ).encode()
        )
        saved = {
            "apiUrl": "https://saved.example/chat",
            "apiKey": "saved-secret",
            "model": "saved-model",
        }
        with (
            patch.object(server, "active_model_config", return_value=saved),
            patch.object(server.urllib.request, "urlopen", return_value=provider) as urlopen,
        ):
            result = server.run_model_extraction(
                {"sourceText": "原文", "schema": [{"id": "quote"}]}
            )
        self.assertEqual(result["meta"]["model"], "saved-model")
        self.assertEqual(urlopen.call_args.args[0].full_url, "https://saved.example/chat")

    def test_model_config_mutations_require_local_same_origin(self):
        self.assertTrue(
            server.model_config_request_allowed(
                "127.0.0.1", "http://127.0.0.1:8765"
            )
        )
        self.assertTrue(server.model_config_request_allowed("::1", ""))
        self.assertFalse(
            server.model_config_request_allowed(
                "192.168.1.10", "http://127.0.0.1:8765"
            )
        )
        self.assertFalse(
            server.model_config_request_allowed("127.0.0.1", "https://evil.example")
        )

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
            "fields": {"author": "王羲之", "script": "草书", "unknown": "drop"},
            "evidence": [
                {"fieldId": "author", "quote": "王羲之"},
                {"fieldId": "script", "quote": "草书"},
            ],
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
                    "decision": "change",
                    "reason": "原文直接出现书体。",
                    "evidenceQuote": "草书",
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
        self.assertEqual(request_body["max_tokens"], 1200)
        user_prompt = request_body["messages"][1]["content"]
        self.assertIn('"reasoning"', user_prompt)
        self.assertIn("20字内理由", user_prompt)
        self.assertIn("不得使用 abstain", user_prompt)
        self.assertEqual(result["proposal"]["fields"], {"author": "王羲之", "script": "草书"})
        self.assertTrue(result["proposal"]["evidence"][0]["verified"])
        self.assertEqual(result["proposal"]["reasoning"][0], {
            "fieldId": "author",
            "decision": "change",
            "reason": "原文直接出现书家姓名。",
            "evidenceQuote": "王羲之",
            "evidenceVerified": True,
        })
        self.assertEqual(result["proposal"]["reasoning"][1], {
            "fieldId": "script",
            "decision": "change",
            "reason": "原文直接出现书体。",
            "evidenceQuote": "草书",
            "evidenceVerified": True,
        })
        self.assertEqual(result["proposal"]["abstentions"], [])
        self.assertEqual(result["proposal"]["answerSources"], {"author": "direct", "script": "direct"})
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

    def test_ai_normalization_ignores_abstention_when_model_already_gave_a_value(self):
        schema = [{"id": "author", "label": "书家"}]
        result = server.normalize_ai_proposal({
            "fields": {"author": "王羲之"},
            "evidence": [{"fieldId": "author", "quote": "王羲之"}],
            "reasoning": [{
                "fieldId": "author",
                "decision": "keep",
                "reason": "当前值看起来合理。",
                "evidenceQuote": "王羲之",
            }],
            "abstentions": [{"fieldId": "author", "reason": "归属证据不足。"}],
        }, schema, "王羲之善草书。")

        self.assertEqual(result["fields"], {"author": "王羲之"})
        self.assertTrue(result["evidence"][0]["verified"])
        self.assertEqual(result["reasoning"], [{
            "fieldId": "author",
            "decision": "keep",
            "reason": "当前值看起来合理。",
            "evidenceQuote": "王羲之",
            "evidenceVerified": True,
        }])
        self.assertEqual(result["abstentions"], [])

    def test_ai_normalization_does_not_turn_abstention_into_a_vote(self):
        schema = [{"id": "author", "label": "书家"}]
        result = server.normalize_ai_proposal({
            "fields": {},
            "evidence": [],
            "reasoning": [{
                "fieldId": "author",
                "decision": "abstain",
                "reason": "归属证据不足。",
                "evidenceQuote": "",
            }],
            "abstentions": [{"fieldId": "author", "reason": "归属证据不足。"}],
        }, schema, "王羲之善草书。", {"author": "王羲之"})

        self.assertEqual(result["fields"], {})
        self.assertEqual(result["reasoning"], [])
        self.assertEqual(result["answerSources"], {})
        self.assertEqual(result["abstentions"], [])

    def test_ai_normalization_accepts_compact_evidence_and_reasoning_maps(self):
        result = server.normalize_ai_proposal({
            "fields": {"author": "王羲之"},
            "evidence": {"author": "王羲之"},
            "reasoning": {"author": "原文直指"},
            "abstentions": [],
        }, [{"id": "author", "label": "书家"}], "王羲之善草书。", {"author": "王羲之"})

        self.assertEqual(result["fields"], {"author": "王羲之"})
        self.assertEqual(result["evidence"][0]["quote"], "王羲之")
        self.assertTrue(result["evidence"][0]["verified"])
        self.assertEqual(result["reasoning"][0]["decision"], "keep")
        self.assertEqual(result["reasoning"][0]["reason"], "原文直指")
        self.assertEqual(result["answerSources"], {"author": "direct"})

    def test_ai_schema_accepts_an_omitted_legacy_abstentions_array(self):
        result = server.validate_ai_proposal_schema({
            "fields": {"author": "王羲之"},
            "evidence": [],
            "reasoning": [],
        })

        self.assertEqual(result["abstentions"], [])

    def test_ai_evidence_uses_the_consensus_normalization_rule(self):
        schema = [{"id": "quote", "label": "原文"}]
        result = server.normalize_ai_proposal(
            {
                "fields": {"quote": "书, 心画也"},
                "evidence": [
                    {
                        "fieldId": "quote",
                        "quote": "书, 心画也",
                        "location": {"page": "１２", "paragraph": 2},
                    }
                ],
                "reasoning": [
                    {
                        "fieldId": "quote",
                        "decision": "change",
                        "reason": "原文直接命中。",
                        "evidenceQuote": "书, 心画也",
                    }
                ],
                "abstentions": [],
            },
            schema,
            "书，  心画也。",
        )
        self.assertTrue(result["evidence"][0]["verified"])
        self.assertEqual(
            result["evidence"][0]["location"], {"page": "12", "paragraph": "2"}
        )
        self.assertTrue(result["reasoning"][0]["evidenceVerified"])

    def test_ai_prompt_uses_compact_evidence_map_and_keeps_source_page(self):
        messages = server.build_ai_messages(
            {"sourceText": "苏轼论书", "pageNo": "12"},
            [{"id": "author", "label": "书家", "prompt": "", "required": True, "evidenceRequired": True}],
        )
        self.assertIn('"evidence":{"字段ID":"原文最短逐字证据或空串"}', messages[1]["content"])
        self.assertIn("页码：12", messages[1]["content"])

    def test_ai_prompt_preserves_checkpoint_gate_for_legacy_workspace_schema(self):
        payload = {
            "sourceText": "苏轼论书",
            "currentFields": {"gate": "checkpoint-source; checkpoint-final"},
        }
        schema = [{
            "id": "gate",
            "label": "门禁",
            "prompt": "判断该条是否可入主表、需补证、或应排除。",
            "required": False,
            "evidenceRequired": False,
        }]
        messages = server.build_ai_messages(payload, schema)
        repair = server.build_ai_repair_messages(payload, schema)
        for content in (messages[1]["content"], repair[1]["content"]):
            self.assertIn("必须沿用当前值中的 checkpoint-* 标签", content)

    def test_ai_extraction_requires_server_configuration(self):
        with patch.object(server, "active_model_config", return_value=None):
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
            "fields": {"author": "作者"}, "evidence": {"author": ""},
            "reasoning": {"author": "根据原文判断"}, "abstentions": []
        })}}]}).encode("utf-8")
        payload = {"sourceText": "原文", "schema": [{"id": "author", "label": "书家"}], "promptVersion": "not-a-number"}
        env = {"MODEL_API_URL": "https://api.deepseek.com/chat/completions", "MODEL_API_KEY": "secret", "MODEL_NAME": "test-model"}
        with patch.dict(os.environ, env, clear=False), patch.object(server.urllib.request, "urlopen", return_value=io.BytesIO(provider_body)):
            result = server.run_model_extraction(payload)
        self.assertEqual(result["meta"]["promptVersion"], 1)

    def test_public_config_exposes_ai_capability_for_legacy_local_config(self):
        with patch.object(server.Path, "exists", return_value=True), patch.object(server.Path, "read_text", return_value='{"enabled": false}'), patch.dict(os.environ, {}, clear=True):
            self.assertEqual(server.public_cloud_config(), {"enabled": False, "aiEnabled": False})

    def test_ancient_ingest_extraction_keeps_only_literal_style_evidence(self):
        profile = self.consensus_profiles()[0]
        model_output = {
            "records": [
                {"author": "王羲之", "scriptType": "草书", "quote": "剖析张公之草", "confidence": "强", "issue": "", "note": "草书比较"},
                {"author": "王献之", "scriptType": "行草", "quote": "模型改写而非原文", "confidence": "中", "issue": "", "note": ""},
            ]
        }
        with (
            patch.object(server, "active_model_config", return_value=profile),
            patch.object(server, "request_raw_model_json", return_value=model_output),
        ):
            rows = server.extract_ingest_evidence(
                "王羲之剖析张公之草，而浓纤折衷。",
                {"printedPage": 192, "sourceFile": "page_192.txt"},
                {"id": "abcdef123456", "sourceName": "书论.pdf"},
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["书家"], "王羲之")
        self.assertEqual(rows[0]["原文命中"], "exact")
        self.assertEqual(rows[0]["page_no"], "192")


if __name__ == "__main__":
    unittest.main()
