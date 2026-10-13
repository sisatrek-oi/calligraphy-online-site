#!/usr/bin/env python3
"""批量生成 OCR 纠错候选；模型无权改写正文，候选必须看图复核。

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
from ocr_integrity import validate_batch, source_hash, PIPELINE_VERSION


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
    return """你为古籍 OCR 提供待人工看图复核的短语纠错候选。你只收到 OCR 和前后页文本，没有扫描图。
不得返回重写后的正文；不得依据书法史常识声称高度确定；不得省略、补写、合并原文。
有疑点可以不给建议。每个 before 必须逐字复制当前页中唯一出现的短原文（包括空格），最多12个非空白字符；after 最多12字。
reason 解释疑点并注明需看图，不作确定性裁决。不要返回正文、总结或 Markdown。
只返回 JSON：{"pages":[{"source_page":5,"suggestions":[{"before":"原 OCR 短语","after":"候选","reason":"需看图复核的原因"}]}]}
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


def read_done(path: Path, pages: list[dict]) -> set[int]:
    if not path.exists():
        return set()
    sources = {int(item['page']): str(item['ocr']) for item in pages}
    done = set()
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        number = item.get('source_page')
        if (item.get('pipeline_version') != PIPELINE_VERSION or number not in sources
            or item.get('source_sha256') != source_hash(sources[number])
            or item.get('conservative') != sources[number] or item.get('normalized') != sources[number]
            or number in done):
            raise ValueError('旧版、重复或来源已变化的结果不能续写；请使用新的输出文件，原文件保留')
        done.add(number)
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
    try:
        done = read_done(args.output, pages)
    except (ValueError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    pending = [item for item in pages if int(item["page"]) not in done]
    with args.output.open("a", encoding="utf-8") as output:
        for start in range(0, len(pending), max(1, args.batch_size)):
            batch = pending[start:start + max(1, args.batch_size)]
            returned = None
            last_error = None
            for attempt in range(1, max(1, args.retries) + 1):
                try:
                    result = request_model(prompt_for(batch, pages), url, key, model, args.timeout)
                    validated = validate_batch(result, batch)
                    returned = validated
                    break
                except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, urllib.error.URLError) as error:
                    last_error = error
                    if attempt < max(1, args.retries):
                        print(f"第 {batch[0]['page']} 页批次第 {attempt} 次失败，准备重试：{error}", file=sys.stderr, flush=True)
                        time.sleep(min(10, max(1, args.sleep * 2)))
            if returned is None:
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
