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
            [{"id": "author", "required": True}],
            [output("a", 12), output("b", "12"), output("c", "１２")],
            "strict",
            {},
        )
        self.assertEqual(accepted["fields"]["author"]["status"], "unanimous")

        blocked = evaluate_consensus(
            [{"id": "author", "required": True}],
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
