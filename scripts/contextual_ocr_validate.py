#!/usr/bin/env python3
"""批量用语言模型校验书论 OCR；原始 OCR 永不覆盖。

运行前设置 MODEL_API_URL、MODEL_API_KEY、MODEL_NAME；也可以直接读取本地 .runtime/model-config.json。
脚本支持 OpenAI-compatible /chat/completions 和 Anthropic /v1/messages，
以 JSONL 断点文件保存结果，便于长任务中断后续跑。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


PAGE_RE = re.compile(r"^===== 原 PDF 物理页 (\d+)｜分册第 (\d+) 页 =====\s*$", re.M)


def load_pages(paths: list[Path]) -> list[dict[str, object]]:
    pages: list[dict[str, object]] = []
    for path in paths:
        text = path.read_text(encoding="utf-8")
        headings = list(PAGE_RE.finditer(text))
        for index, heading in enumerate(headings):
            end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
            pages.append({
                "page": int(heading.group(1)),
                "local": int(heading.group(2)),
                "source": path.name,
                "ocr": text[heading.end():end].strip(),
            })
    pages.sort(key=lambda item: int(item["page"]))
    return pages


def prompt_for(batch: list[dict[str, object]], all_pages: list[dict[str, object]]) -> str:
    by_page = {int(item["page"]): item for item in all_pages}
    blocks = []
    for item in batch:
        number = int(item["page"])
        previous = by_page.get(number - 1, {}).get("ocr", "")
        following = by_page.get(number + 1, {}).get("ocr", "")
        blocks.append(json.dumps({
            "page": number,
            "local": item["local"],
            "previous_page_context": previous,
            "ocr": item["ocr"],
            "next_page_context": following,
        }, ensure_ascii=False))
    return """你是古籍书法论文 OCR 校勘员。请根据 OCR 文本、前后页上下文和现代汉语／书法史语境，校验下面的页段。

硬性规则：
1. 不凭空补写原文；无法确认的字放入 uncertainties，并在正文保留“□”或“【待核：候选】”。
2. 保持每页阅读顺序和原有栏号；不要把标题、页眉、页脚偷偷删除。
3. conservative 保守版只改高度确定的 OCR 错字、标点和明显断行。
4. normalized 语义版可合并跨栏句子、补正常标点，但仍不能把推测当成确定文字。
5. 每页必须返回 source_page、conservative、normalized、uncertainties；正文用纯文本。

只返回 JSON，不要 Markdown：
{"pages":[{"source_page":5,"conservative":"...","normalized":"...","uncertainties":[{"text":"...","reason":"..."}]}]}

待校验页段：
""" + "\n".join(blocks)


def request_model(prompt: str, url: str, key: str, model: str, timeout: int) -> dict:
    is_anthropic = "/messages" in url or "anthropic" in url.lower()
    if is_anthropic:
        body = {"model": model, "max_tokens": 12000, "temperature": 0, "messages": [{"role": "user", "content": prompt}]}
        headers = {"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"}
    else:
        body = {"model": model, "temperature": 0, "messages": [{"role": "user", "content": prompt}], "response_format": {"type": "json_object"}}
        headers = {"content-type": "application/json", "authorization": f"Bearer {key}"}
    request = urllib.request.Request(url, json.dumps(body, ensure_ascii=False).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if is_anthropic:
        content = "".join(part.get("text", "") for part in payload.get("content", []) if part.get("type") == "text")
    else:
        content = payload["choices"][0]["message"]["content"]
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.I)
    return json.loads(content)


def read_done(path: Path) -> set[int]:
    if not path.exists():
        return set()
    done = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            done.add(int(json.loads(line)["source_page"]))
        except (ValueError, KeyError, json.JSONDecodeError):
            continue
    return done


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", nargs="+", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=3)
    parser.add_argument("--max-pages", type=int)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--sleep", type=float, default=0.5)
    parser.add_argument("--retries", type=int, default=3, help="单批失败后的自动重试次数")
    parser.add_argument("--config", type=Path, default=Path(".runtime/model-config.json"))
    parser.add_argument("--profile", default="primary", help="本地模型配置里的 profile id，默认 primary")
    args = parser.parse_args()
    url = os.environ.get("MODEL_API_URL", "").strip()
    key = os.environ.get("MODEL_API_KEY", "").strip()
    model = os.environ.get("MODEL_NAME", "").strip()
    if not all((url, key, model)) and args.config.exists():
        config = json.loads(args.config.read_text(encoding="utf-8"))
        profile = next((item for item in config.get("profiles", []) if item.get("id") == args.profile and item.get("enabled", True)), None)
        if profile:
            url = str(profile.get("apiUrl") or "").strip()
            key = str(profile.get("apiKey") or "").strip()
            model = str(profile.get("model") or "").strip()
    if not all((url, key, model)):
        print("缺少模型配置；请设置 MODEL_API_URL、MODEL_API_KEY、MODEL_NAME，或提供 .runtime/model-config.json。未开始处理。", file=sys.stderr)
        return 2
    pages = load_pages(args.source)
    if args.max_pages:
        pages = pages[:args.max_pages]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    done = read_done(args.output)
    pending = [item for item in pages if int(item["page"]) not in done]
    with args.output.open("a", encoding="utf-8") as output:
        for start in range(0, len(pending), max(1, args.batch_size)):
            batch = pending[start:start + max(1, args.batch_size)]
            result = None
            last_error = None
            for attempt in range(1, max(1, args.retries) + 1):
                try:
                    result = request_model(prompt_for(batch, pages), url, key, model, args.timeout)
                    returned = {int(item["source_page"]): item for item in result.get("pages", [])}
                    expected = {int(item["page"]) for item in batch}
                    if set(returned) != expected:
                        raise ValueError(f"模型返回页码不完整：期望 {sorted(expected)}，实际 {sorted(returned)}")
                    for number in sorted(returned):
                        item = returned[number]
                        if not isinstance(item.get("conservative"), str) or not isinstance(item.get("normalized"), str) or not isinstance(item.get("uncertainties"), list):
                            raise ValueError(f"第 {number} 页返回结构不完整")
                    break
                except (OSError, ValueError, KeyError, json.JSONDecodeError, urllib.error.URLError) as error:
                    last_error = error
                    if attempt < max(1, args.retries):
                        print(f"第 {batch[0]['page']} 页批次第 {attempt} 次失败，准备重试：{error}", file=sys.stderr, flush=True)
                        time.sleep(min(10, max(1, args.sleep * 2)))
            if result is None:
                print(f"第 {batch[0]['page']} 页批次失败：{last_error}", file=sys.stderr)
                return 1
            for number in sorted(returned):
                output.write(json.dumps(returned[number], ensure_ascii=False) + "\n")
            output.flush()
            print(f"已处理 {start + len(batch)}/{len(pending)} 页", flush=True)
            time.sleep(max(0, args.sleep))
    print(f"完成：{len(pages)} 页；结果写入 {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
