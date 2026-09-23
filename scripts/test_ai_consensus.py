import unittest

from ai_consensus import evaluate_consensus, normalize_field_value, normalize_location, verify_evidence


class AiConsensusTest(unittest.TestCase):
    def test_normalizes_whitespace_punctuation_boolean_null_and_explicit_aliases(self):
        aliases = {"author": {"子瞻": "苏轼"}}
        self.assertEqual(normalize_field_value("author", "  子瞻 ", aliases), "苏轼")
        self.assertEqual(normalize_field_value("quote", "书，  心画也", aliases), "书, 心画也")
        self.assertEqual(normalize_field_value("confirmed", True, aliases), "true")
        self.assertEqual(normalize_field_value("confirmed", False, aliases), "false")
        self.assertEqual(normalize_field_value("missing", None, aliases), "")

    def test_normalizes_page_paragraph_and_item_locations(self):
        self.assertEqual(
            normalize_location({"page": " 12 ", "paragraph": 3, "item": "第２条"}),
            {"page": "12", "paragraph": "3", "item": "第2条"},
        )

    def test_evidence_must_match_the_supplied_source_after_deterministic_normalization(self):
        self.assertTrue(verify_evidence("王羲之善草书。", "王羲之善草书"))
        self.assertTrue(verify_evidence("书，  心画也。", "书, 心画也"))
        self.assertFalse(verify_evidence("王羲之善草书。", "王献之善草书"))
        self.assertFalse(verify_evidence("王羲之善草书。", ""))

    def test_standard_consensus_accepts_three_values_with_one_verified_quote(self):
        outputs = [
            {"profileId": "a", "fields": {"author": "子瞻"}, "evidence": {"author": {"quote": "苏轼", "verified": True}}},
            {"profileId": "b", "fields": {"author": "苏轼"}, "evidence": {"author": {"quote": "", "verified": False}}},
            {"profileId": "c", "fields": {"author": "苏轼"}, "evidence": {"author": {"quote": "", "verified": False}}},
        ]
        result = evaluate_consensus(
            [{"id": "author", "required": True, "evidenceRequired": True}], outputs, "standard", {"author": {"子瞻": "苏轼"}}
        )
        self.assertEqual(result["fields"]["author"]["status"], "unanimous")
        self.assertEqual(result["fields"]["author"]["value"], "苏轼")
        self.assertEqual(result["fields"]["author"]["verifiedEvidence"], 1)

    def test_standard_consensus_requires_evidence_only_for_marked_fields(self):
        outputs = [
            {"profileId": profile_id, "fields": {"author": "苏轼", "note": "需人工复核"}, "evidence": {}}
            for profile_id in ("a", "b", "c")
        ]
        result = evaluate_consensus(
            [
                {"id": "author", "required": True, "evidenceRequired": True},
                {"id": "note", "required": False, "evidenceRequired": False},
            ],
            outputs,
            "standard",
            {},
        )
        self.assertEqual(result["fields"]["author"]["status"], "blocked")
        self.assertEqual(result["fields"]["author"]["reason"], "insufficient_evidence")
        self.assertEqual(result["fields"]["note"]["status"], "unanimous")
        self.assertEqual(result["fields"]["note"]["reason"], "accepted")

    def test_two_of_three_is_a_suggestion_and_never_auto_approves(self):
        outputs = [
            {"profileId": "a", "fields": {"scriptType": "楷书"}, "evidence": {}},
            {"profileId": "b", "fields": {"scriptType": "楷书"}, "evidence": {}},
            {"profileId": "c", "fields": {"scriptType": "行楷"}, "evidence": {}},
        ]
        result = evaluate_consensus(
            [{"id": "scriptType", "required": False}],
            outputs,
            "loose",
            {},
            mode="auto",
            model_families=["a", "b", "c"],
        )
        self.assertEqual(result["fields"]["scriptType"]["status"], "split")
        self.assertEqual(result["fields"]["scriptType"]["value"], "楷书")
        self.assertEqual(result["decision"], "needs_human_review")

    def test_quote_consensus_ignores_punctuation_and_preserves_current_text(self):
        outputs = [
            {"profileId": "a", "fields": {"quote": "落简挥毫，有郢匠乘风之势"}, "evidence": {}},
            {"profileId": "b", "fields": {"quote": "落简挥毫, 有郢匠乘风之势"}, "evidence": {}},
            {"profileId": "c", "fields": {"quote": "落简挥毫，有郢匠乘风之势。"}, "evidence": {}},
        ]
        current = "落简挥毫，有郢匠乘风之势"
        result = evaluate_consensus(
            [{"id": "quote", "required": True, "comparisonMode": "quote"}],
            outputs,
            "loose",
            {},
            current_fields={"quote": current},
        )
        self.assertEqual(result["fields"]["quote"]["status"], "unanimous")
        self.assertEqual(result["fields"]["quote"]["voteCount"], 3)
        self.assertEqual(result["fields"]["quote"]["value"], current)

    def test_script_type_and_confidence_use_field_specific_canonical_values(self):
        outputs = [
            {
                "profileId": "a",
                "fields": {"scriptType": "草书/泛草", "confidence": "中；三轮高"},
                "evidence": {},
            },
            {"profileId": "b", "fields": {"scriptType": "草书", "confidence": "中"}, "evidence": {}},
            {"profileId": "c", "fields": {"scriptType": "草", "confidence": "中；三轮中高"}, "evidence": {}},
        ]
        result = evaluate_consensus(
            [
                {"id": "scriptType", "required": False, "comparisonMode": "script_type"},
                {"id": "confidence", "required": False, "comparisonMode": "confidence"},
            ],
            outputs,
            "loose",
            {},
            current_fields={"scriptType": "草书/泛草", "confidence": "中；三轮高"},
        )
        self.assertEqual(result["fields"]["scriptType"]["status"], "unanimous")
        self.assertEqual(result["fields"]["scriptType"]["value"], "草书/泛草")
        self.assertEqual(result["fields"]["confidence"]["status"], "unanimous")
        self.assertEqual(result["fields"]["confidence"]["value"], "中；三轮高")

    def test_confidence_consensus_does_not_require_its_own_evidence(self):
        outputs = [
            {"profileId": profile_id, "fields": {"confidence": "中"}, "evidence": {}}
            for profile_id in ("a", "b", "c")
        ]
        result = evaluate_consensus(
            [
                {
                    "id": "confidence",
                    "required": False,
                    "evidenceRequired": True,
                    "comparisonMode": "confidence",
                }
            ],
            outputs,
            "strict",
            {},
            mode="auto",
            model_families=["family-a", "family-b", "family-c"],
        )
        self.assertEqual(result["fields"]["confidence"]["status"], "unanimous")
        self.assertFalse(result["fields"]["confidence"]["evidenceRequired"])
        self.assertEqual(result["blockers"], [])
        self.assertEqual(result["decision"], "auto_approve_record")

    def test_gate_compares_checkpoint_tokens_without_order_or_separator_sensitivity(self):
        outputs = [
            {"profileId": "a", "fields": {"gate": "checkpoint-source; checkpoint-final"}, "evidence": {}},
            {"profileId": "b", "fields": {"gate": "checkpoint-final；checkpoint-source"}, "evidence": {}},
            {"profileId": "c", "fields": {"gate": "checkpoint-source,checkpoint-final"}, "evidence": {}},
        ]
        current = "checkpoint-source; checkpoint-final"
        result = evaluate_consensus(
            [{"id": "gate", "required": False, "comparisonMode": "token_set"}],
            outputs,
            "loose",
            {},
            current_fields={"gate": current},
        )
        self.assertEqual(result["fields"]["gate"]["status"], "unanimous")
        self.assertEqual(result["fields"]["gate"]["value"], current)

    def test_advisory_free_text_disagreement_does_not_block_record(self):
        outputs = [
            {"profileId": "a", "fields": {"note": "可直接保留"}, "evidence": {}},
            {"profileId": "b", "fields": {"note": "建议保留"}, "evidence": {}},
            {"profileId": "c", "fields": {"note": "保留即可"}, "evidence": {}},
        ]
        result = evaluate_consensus(
            [{"id": "note", "required": False, "comparisonMode": "advisory"}],
            outputs,
            "loose",
            {},
            mode="auto",
            model_families=["a", "b", "c"],
        )
        self.assertEqual(result["fields"]["note"]["status"], "blocked")
        self.assertFalse(result["fields"]["note"]["blocking"])
        self.assertEqual(result["blockers"], [])
        self.assertEqual(result["decision"], "auto_approve_record")

    def test_strict_consensus_requires_matching_verified_quotes_and_locations(self):
        def output(profile_id, page):
            return {
                "profileId": profile_id,
                "fields": {"author": "苏轼"},
                "evidence": {
                    "author": {
                        "quote": "苏轼论书",
                        "verified": True,
                        "location": {"page": page, "paragraph": 2},
                    }
                },
            }

        accepted = evaluate_consensus(
            [{"id": "author", "required": True, "evidenceRequired": True}],
            [output("a", 12), output("b", "12"), output("c", "１２")],
            "strict",
            {},
        )
        self.assertEqual(accepted["fields"]["author"]["status"], "unanimous")

        blocked = evaluate_consensus(
            [{"id": "author", "required": True, "evidenceRequired": True}],
            [output("a", 12), output("b", 12), output("c", 13)],
            "strict",
            {},
        )
        self.assertEqual(blocked["fields"]["author"]["status"], "blocked")

    def test_abstention_and_manual_override_block_auto_review(self):
        outputs = [
            {
                "profileId": profile_id,
                "fields": {"author": "苏轼"},
                "evidence": {"author": {"quote": "苏轼", "verified": True}},
                "abstentions": ["author"] if profile_id == "c" else [],
            }
            for profile_id in ("a", "b", "c")
        ]
        abstained = evaluate_consensus(
            [{"id": "author", "required": True}],
            outputs,
            "standard",
            {},
            mode="auto",
            model_families=["family-a", "family-b", "family-c"],
        )
        self.assertEqual(abstained["decision"], "needs_human_review")
        self.assertEqual(abstained["fields"]["author"]["status"], "blocked")
        self.assertEqual(abstained["fields"]["author"]["votes"], ["苏轼", "苏轼", ""])
        self.assertEqual(abstained["fields"]["author"]["voteCount"], 2)
        self.assertEqual(abstained["fields"]["author"]["abstentionCount"], 1)
        self.assertEqual(abstained["fields"]["author"]["reason"], "abstention")

        for item in outputs:
            item["abstentions"] = []
        manual_only = evaluate_consensus(
            [{"id": "author", "required": True}],
            outputs,
            "standard",
            {},
            mode="auto",
            field_overrides={"author": {"manualOnly": True}},
            model_families=["family-a", "family-b", "family-c"],
        )
        self.assertEqual(manual_only["fields"]["author"]["status"], "unanimous")
        self.assertEqual(manual_only["fields"]["author"]["voteCount"], 3)
        self.assertEqual(manual_only["fields"]["author"]["abstentionCount"], 0)
        self.assertEqual(manual_only["fields"]["author"]["reason"], "accepted")
        self.assertIn("author:manual_only", manual_only["blockers"])
        self.assertEqual(manual_only["decision"], "needs_human_review")

    def test_auto_review_requires_two_model_families_and_assist_never_auto_approves(self):
        outputs = [
            {
                "profileId": profile_id,
                "fields": {"author": "苏轼"},
                "evidence": {"author": {"quote": "苏轼", "verified": True}},
            }
            for profile_id in ("a", "b", "c")
        ]
        schema = [{"id": "author", "required": True}]
        same_family = evaluate_consensus(
            schema, outputs, "standard", {}, mode="auto", model_families=["gpt", "gpt", "gpt"]
        )
        self.assertEqual(same_family["decision"], "needs_human_review")
        self.assertIn("model_family_diversity", same_family["blockers"])

        auto = evaluate_consensus(
            schema, outputs, "standard", {}, mode="auto", model_families=["gpt", "gpt", "qwen"]
        )
        self.assertEqual(auto["decision"], "auto_approve_record")

        assist = evaluate_consensus(
            schema, outputs, "standard", {}, mode="assist", model_families=["gpt", "gpt", "qwen"]
        )
        self.assertEqual(assist["decision"], "adopt_fields")

    def test_invalid_policy_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_consensus([], [], "unknown", {})


if __name__ == "__main__":
    unittest.main()
