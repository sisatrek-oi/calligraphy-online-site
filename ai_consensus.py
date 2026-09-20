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
LOCATION_KEYS = ("page", "paragraph", "item")


def normalize_text(value: object) -> str:
    """Return the stable text representation used for deterministic comparisons."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    text = unicodedata.normalize("NFKC", str(value)).translate(PUNCTUATION)
    return re.sub(r"\s+", " ", text).strip()


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
    normalized_quote = normalize_text(quote)
    return bool(normalized_quote) and normalized_quote in normalize_text(source_text)


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
) -> dict[str, Any]:
    """Evaluate field-level consensus and route the record-level decision."""
    if default_policy not in POLICIES:
        raise ValueError("invalid consensus policy")
    if mode not in REVIEW_MODES:
        raise ValueError("invalid review mode")

    overrides = field_overrides or {}
    fields: dict[str, dict[str, Any]] = {}
    blockers: list[str] = []

    if len(outputs) != 3:
        blockers.append("model_count")

    for raw_field in schema:
        field_id = str(raw_field["id"])
        policy, manual_only = _field_policy(default_policy, overrides.get(field_id))
        if manual_only:
            blockers.append(f"{field_id}:manual_only")

        values = [
            normalize_field_value(
                field_id,
                item.get("fields", {}).get(field_id)
                if isinstance(item.get("fields"), dict)
                else None,
                aliases,
            )
            for item in outputs
        ]
        counts = Counter(value for value in values if value)
        winner, winner_count = counts.most_common(1)[0] if counts else ("", 0)
        evidence = [_evidence_for(item, field_id) for item in outputs]
        verified = sum(bool(item.get("verified")) for item in evidence)
        normalized_quotes = [normalize_text(item.get("quote")) for item in evidence]
        normalized_locations = [normalize_location(item.get("location")) for item in evidence]
        abstained = any(_abstains_on(item, field_id) for item in outputs)

        unanimous_value = (
            len(outputs) == 3
            and bool(winner)
            and winner_count == 3
            and not abstained
        )
        evidence_passes = policy == "loose" or (
            policy == "standard" and verified >= 2
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

        if not accepted and (bool(raw_field.get("required")) or bool(winner)):
            blockers.append(f"{field_id}:{status}")

        fields[field_id] = {
            "status": status,
            "value": winner,
            "votes": values,
            "verifiedEvidence": verified,
            "policy": policy,
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
