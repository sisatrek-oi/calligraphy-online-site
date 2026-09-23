"""Deterministic field normalization and multi-model consensus decisions."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from typing import Any


PUNCTUATION = str.maketrans(
    {
        "，": ",",
        "：": ":",
        "；": ";",
        "（": "(",
        "）": ")",
        "。": ".",
        "！": "!",
        "？": "?",
        "【": "[",
        "】": "]",
    }
)
POLICIES = {"loose", "standard", "strict"}
REVIEW_MODES = {"assist", "auto"}
COMPARISON_MODES = {"exact", "quote", "script_type", "confidence", "token_set", "advisory"}
LOCATION_KEYS = ("page", "paragraph", "item")


def normalize_text(value: object) -> str:
    """Return the stable text representation used for deterministic comparisons."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    text = unicodedata.normalize("NFKC", str(value)).translate(PUNCTUATION)
    return re.sub(r"\s+", " ", text).strip()


def normalize_display_text(value: object) -> str:
    """Normalize width and whitespace while preserving the user's punctuation."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(value))).strip()


def normalize_field_value(
    field_id: str,
    value: object,
    aliases: dict[str, dict[str, str]] | None = None,
) -> str:
    """Normalize a field and apply only its explicit alias mapping."""
    normalized = normalize_text(value)
    field_aliases = (aliases or {}).get(field_id, {})
    if not isinstance(field_aliases, dict):
        return normalized
    return normalize_text(field_aliases.get(normalized, normalized))


def _quote_key(value: object) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or ""))
    return "".join(
        character
        for character in normalized
        if not character.isspace() and not unicodedata.category(character).startswith("P")
    )


def _script_type_key(value: str) -> str:
    compact = re.sub(r"\s+", "", value)
    compact = {
        "草": "草书",
        "行": "行书",
        "楷": "楷书",
        "真": "真书",
        "隶": "隶书",
        "篆": "篆书",
    }.get(compact, compact)
    generic_suffix = re.fullmatch(r"(草书|行书|隶书|篆书)/(泛草|泛行|泛隶|泛篆)", compact)
    return generic_suffix.group(1) if generic_suffix else compact


def _confidence_key(value: str) -> str:
    compact = re.sub(r"\s+", "", value)
    match = re.match(r"^(待复核|高|中|低)(?:$|[;,/|])", compact)
    return match.group(1) if match else compact


def _token_set_key(value: str) -> str:
    tokens = {
        token.strip().lower()
        for token in re.split(r"[,;|/、\s]+", value)
        if token.strip()
    }
    return ";".join(sorted(tokens))


def comparison_key(
    field_id: str,
    value: object,
    aliases: dict[str, dict[str, str]] | None,
    mode: str,
) -> str:
    """Return a field-aware key used only for consensus voting."""
    normalized = normalize_field_value(field_id, value, aliases)
    if mode == "quote":
        return _quote_key(normalized)
    if mode == "script_type":
        return _script_type_key(normalized)
    if mode == "confidence":
        return _confidence_key(normalized)
    if mode == "token_set":
        return _token_set_key(normalized)
    return normalized


def normalize_location(value: object) -> dict[str, str]:
    """Normalize supported source location components without fuzzy parsing."""
    if not isinstance(value, dict):
        return {}
    return {
        key: normalized
        for key in LOCATION_KEYS
        if (normalized := normalize_text(value.get(key)))
    }


def verify_evidence(source_text: str, quote: object) -> bool:
    """Check whether a non-empty normalized quote occurs in the supplied source."""
    normalized_quote = _quote_key(quote)
    return bool(normalized_quote) and normalized_quote in _quote_key(source_text)


def _abstains_on(item: dict[str, Any], field_id: str) -> bool:
    for raw in item.get("abstentions", []) if isinstance(item.get("abstentions"), list) else []:
        abstained_field = raw.get("fieldId") if isinstance(raw, dict) else raw
        if str(abstained_field or "") == field_id:
            return True
    return False


def _evidence_for(item: dict[str, Any], field_id: str) -> dict[str, Any]:
    evidence = item.get("evidence")
    if not isinstance(evidence, dict):
        return {}
    entry = evidence.get(field_id)
    return entry if isinstance(entry, dict) else {}


def _field_policy(default_policy: str, override: object) -> tuple[str, bool]:
    value = override if isinstance(override, dict) else {}
    policy = str(value.get("policy") or default_policy)
    if policy not in POLICIES:
        raise ValueError(f"invalid consensus policy for field: {policy}")
    return policy, bool(value.get("manualOnly"))


def evaluate_consensus(
    schema: list[dict[str, Any]],
    outputs: list[dict[str, Any]],
    default_policy: str,
    aliases: dict[str, dict[str, str]],
    *,
    mode: str = "assist",
    field_overrides: dict[str, dict[str, Any]] | None = None,
    model_families: list[str] | None = None,
    current_fields: dict[str, object] | None = None,
) -> dict[str, Any]:
    """Evaluate field-level consensus and route the record-level decision."""
    if default_policy not in POLICIES:
        raise ValueError("invalid consensus policy")
    if mode not in REVIEW_MODES:
        raise ValueError("invalid review mode")

    overrides = field_overrides or {}
    current = current_fields or {}
    fields: dict[str, dict[str, Any]] = {}
    blockers: list[str] = []

    if len(outputs) != 3:
        blockers.append("model_count")

    for raw_field in schema:
        field_id = str(raw_field["id"])
        comparison_mode = str(raw_field.get("comparisonMode") or "exact")
        if comparison_mode not in COMPARISON_MODES:
            raise ValueError(f"invalid comparison mode for field: {comparison_mode}")
        blocking = comparison_mode != "advisory"
        policy, manual_only = _field_policy(default_policy, overrides.get(field_id))
        if manual_only:
            blockers.append(f"{field_id}:manual_only")

        abstention_flags = [_abstains_on(item, field_id) for item in outputs]
        display_values = [
            "" if abstention_flags[index] else normalize_display_text(
                item.get("fields", {}).get(field_id)
                if isinstance(item.get("fields"), dict)
                else None
            )
            for index, item in enumerate(outputs)
        ]
        values = [
            "" if abstention_flags[index] else comparison_key(
                field_id,
                item.get("fields", {}).get(field_id)
                if isinstance(item.get("fields"), dict)
                else None,
                aliases,
                comparison_mode,
            )
            for index, item in enumerate(outputs)
        ]
        counts = Counter(value for value in values if value)
        winner, winner_count = counts.most_common(1)[0] if counts else ("", 0)
        winner_displays = [
            display_values[index]
            for index, value in enumerate(values)
            if value == winner and display_values[index]
        ]
        winner_display = Counter(winner_displays).most_common(1)[0][0] if winner_displays else winner
        current_display = normalize_display_text(current.get(field_id))
        if comparison_mode != "exact" and current_display and comparison_key(
            field_id, current_display, aliases, comparison_mode
        ) == winner:
            winner_display = current_display
        evidence = [
            {} if abstention_flags[index] else _evidence_for(item, field_id)
            for index, item in enumerate(outputs)
        ]
        verified = sum(bool(item.get("verified")) for item in evidence)
        normalized_quotes = [_quote_key(item.get("quote")) for item in evidence]
        normalized_locations = [normalize_location(item.get("location")) for item in evidence]
        abstention_count = sum(abstention_flags)
        abstained = abstention_count > 0

        unanimous_value = (
            len(outputs) == 3
            and bool(winner)
            and winner_count == 3
            and not abstained
        )
        # Confidence is itself an assessment of the supporting quote. Requiring
        # a second quote to prove that assessment creates a circular blocker.
        evidence_required = bool(raw_field.get("evidenceRequired")) and (
            field_id != "confidence" and comparison_mode != "confidence"
        )
        evidence_passes = not evidence_required or policy == "loose" or (
            policy == "standard" and verified >= 1
        ) or (
            policy == "strict"
            and verified == 3
            and all(normalized_quotes)
            and len(set(normalized_quotes)) == 1
            and all(normalized_locations)
            and all(location == normalized_locations[0] for location in normalized_locations)
        )
        accepted = unanimous_value and evidence_passes

        if accepted:
            status = "unanimous"
        elif winner_count == 2 and not abstained:
            status = "split"
        else:
            status = "blocked"

        if accepted:
            reason = "accepted"
        elif abstained:
            reason = "abstention"
        elif len(outputs) != 3:
            reason = "model_count"
        elif not winner:
            reason = "missing_value"
        elif winner_count < 3:
            reason = "disagreement"
        elif not evidence_passes:
            reason = "insufficient_evidence"
        else:
            reason = "rule_failure"

        if not accepted and blocking and (bool(raw_field.get("required")) or bool(winner)):
            blockers.append(f"{field_id}:{status}")

        fields[field_id] = {
            "status": status,
            "value": winner_display,
            "votes": display_values,
            "voteCount": winner_count,
            "abstentionCount": abstention_count,
            "verifiedEvidence": verified,
            "evidenceRequired": evidence_required,
            "policy": policy,
            "reason": reason,
            "comparisonMode": comparison_mode,
            "blocking": blocking,
        }

    families = {normalize_text(value) for value in (model_families or []) if normalize_text(value)}
    if mode == "auto" and len(families) < 2:
        blockers.append("model_family_diversity")

    if mode == "auto" and not blockers and len(outputs) == 3:
        decision = "auto_approve_record"
    elif mode == "assist" and any(item["status"] == "unanimous" for item in fields.values()):
        decision = "adopt_fields"
    else:
        decision = "needs_human_review"

    return {"fields": fields, "blockers": blockers, "decision": decision}
