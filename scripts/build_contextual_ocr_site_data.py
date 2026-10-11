#!/usr/bin/env python3
"""Build per-part contextual OCR payloads and a comparison report for screening.html."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def compact(value: str) -> str:
    return re.sub(r"\s+", "", value or "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("tasks/2026-10-11-ocr-cleaning/full-book-contextual.jsonl"))
    parser.add_argument("--screening-data", type=Path, default=Path("screening-data"))
    parser.add_argument("--report", type=Path, default=Path("tasks/2026-10-11-ocr-cleaning/full-book-comparison.md"))
    args = parser.parse_args()

    records = [json.loads(line) for line in args.input.read_text(encoding="utf-8").splitlines() if line.strip()]
    records.sort(key=lambda item: int(item["source_page"]))
    by_page = {int(item["source_page"]): item for item in records}
    if sorted(by_page) != list(range(1, 1053)):
        raise SystemExit("contextual OCR must cover physical pages 1–1052 exactly")

    summaries = []
    for part in range(1, 5):
        index = json.loads((args.screening_data / f"part-{part}.json").read_text(encoding="utf-8"))
        pages = []
        for entry in index["pages"]:
            item = by_page[int(entry["page"])]
            pages.append({
                "page": int(entry["page"]),
                "local": int(entry["local"]),
                "conservative": item["conservative"],
                "normalized": item["normalized"],
                "uncertainties": item.get("uncertainties", []),
            })
        payload = {
            "version": 1,
            "part": part,
            "start": int(index["start"]),
            "end": int(index["end"]),
            "pages": pages,
        }
        (args.screening_data / f"part-{part}-contextual.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
        )
        summaries.extend({"part": part, **summary(entry, by_page[int(entry["page"])] )} for entry in index["pages"])

    same = [item for item in summaries if item["sameIgnoringWhitespace"]]
    different = [item for item in summaries if not item["sameIgnoringWhitespace"]]
    uncertain = [item for item in summaries if item["uncertaintyCount"]]
    largest = sorted(different, key=lambda item: abs(item["lengthDelta"]), reverse=True)[:20]
    report = [
        "# 《历代书法论文选》两版清洗结果比对",
        "",
        "本报告比较保守校验版与语义整理版；空白和换行差异已在‘忽略空白’统计中消除。原始 OCR 未参与覆盖。",
        "",
        f"- 物理页：{len(summaries)}",
        f"- 忽略空白后相同：{len(same)} 页",
        f"- 忽略空白后有差异：{len(different)} 页（{len(different) / len(summaries):.1%}）",
        f"- 含不确定项：{len(uncertain)} 页，共 {sum(item['uncertaintyCount'] for item in summaries)} 条",
        "",
        "## 使用建议",
        "",
        "网站保留原始 OCR、保守校验版和语义整理版三个版本。保守版适合逐字回看；语义版适合连续阅读，但含不确定项的页面仍需对照扫描图。",
        "",
        "## 差异最大的页面（按去空白后的字数变化排序）",
        "",
        "| 物理页 | 保守版字数 | 语义版字数 | 差值 | 不确定项 |",
        "| ---: | ---: | ---: | ---: | ---: |",
    ]
    report.extend(
        f"| {item['page']} | {item['conservativeChars']} | {item['normalizedChars']} | {item['lengthDelta']:+d} | {item['uncertaintyCount']} |"
        for item in largest
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text("\n".join(report) + "\n", encoding="utf-8")
    print(f"built {len(summaries)} pages; same={len(same)} different={len(different)}")
    return 0


def summary(entry: dict, item: dict) -> dict:
    conservative = compact(item["conservative"])
    normalized = compact(item["normalized"])
    return {
        "page": int(entry["page"]),
        "conservativeChars": len(conservative),
        "normalizedChars": len(normalized),
        "lengthDelta": len(normalized) - len(conservative),
        "uncertaintyCount": len(item.get("uncertainties", [])),
        "sameIgnoringWhitespace": conservative == normalized,
    }


if __name__ == "__main__":
    raise SystemExit(main())
