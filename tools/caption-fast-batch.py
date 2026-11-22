import base64
import io
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

media_dir = Path(sys.argv[1])
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0
batch_size = max(1, min(6, int(sys.argv[3]) if len(sys.argv) > 3 else 4))
index_path = media_dir / "index.json"
records = json.loads(index_path.read_text(encoding="utf-8"))
pending = [r for r in records if not r.get("meaning")]
if limit:
    pending = pending[:limit]
print(f"pending={len(pending)} batch={batch_size}", flush=True)

API = "http://127.0.0.1:8081/v1/chat/completions"
PROMPT = "请按顺序分别用一句中文描述下面每张图或表情包表达的意思，每行以 1. 2. 3. 4. 开头，每句不超过 40 个字，不要解释。"


def image_data(path: str) -> str | None:
    try:
        with Image.open(path) as img:
            img.seek(0)
            img = img.convert("RGB")
            img.thumbnail((512, 512), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


def request_captions(items: list[dict], batch: bool) -> list[str]:
    contents = []
    text = PROMPT if batch else "用一句中文描述这张图或表情包表达的意思，不超过 40 个字，不要解释。"
    contents.append({"type": "text", "text": text})
    for rec in items:
        data = image_data(rec["path"])
        if not data:
            contents.append({"type": "text", "text": "[这张图读不出来]"})
        else:
            contents.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}})
    body = {
        "model": "qwen3-vl-8b",
        "messages": [{"role": "user", "content": contents}],
        "max_tokens": 64 * len(items),
        "temperature": 0.2,
        "stream": False,
    }
    req = urllib.request.Request(API, data=json.dumps(body).encode("utf-8"), headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    answer = str(payload.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
    if not batch:
        return [answer[:200]]
    found = {}
    for line in answer.splitlines():
        m = re.match(r"^\s*(\d+)[.、)]\s*(.*\S)", line)
        if m:
            index = int(m.group(1)) - 1
            if 0 <= index < len(items):
                found[index] = m.group(2).strip()[:200]
    return [found.get(i, "") for i in range(len(items))]


ok = 0
failed = 0
started = time.time()
for start in range(0, len(pending), batch_size):
    group = pending[start:start + batch_size]
    try:
        answers = request_captions(group, True)
    except Exception as exc:
        answers = [""] * len(group)
        if start < 8:
            print(f"batch error: {exc}", flush=True)
    for rec, answer in zip(group, answers):
        if answer and "?" not in answer:
            rec["meaning"] = answer
            rec["needsMeaning"] = False
            ok += 1
        else:
            failed += 1
    # 个别没有解析出来的，逐张补一次；避免整组丢失。
    missing = [rec for rec, answer in zip(group, answers) if not answer or "?" in answer]
    for rec in missing:
        try:
            single = request_captions([rec], False)[0]
            if single and "?" not in single:
                rec["meaning"] = single
                rec["needsMeaning"] = False
                failed -= 1
                ok += 1
        except Exception:
            pass
    done = min(start + len(group), len(pending))
    if done % 20 < batch_size or done == len(pending):
        tmp = index_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, index_path)
        elapsed = max(1, time.time() - started)
        print(f"{done}/{len(pending)} ok={ok} failed={failed} {done/elapsed*60:.1f}/min", flush=True)

tmp = index_path.with_suffix(".json.tmp")
tmp.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
os.replace(tmp, index_path)
print(f"done ok={ok} failed={failed}", flush=True)
