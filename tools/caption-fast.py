import base64
import io
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

media_dir = Path(sys.argv[1])
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0
index_path = media_dir / "index.json"
records = json.loads(index_path.read_text(encoding="utf-8"))
pending = [r for r in records if not r.get("meaning")]
if limit:
    pending = pending[:limit]
print(f"pending={len(pending)}", flush=True)

API = "http://127.0.0.1:8081/v1/chat/completions"
PROMPT = "用一句中文描述这张图或表情包表达的意思，不超过 40 个字，不要解释。"


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


def caption(record: dict) -> str:
    data = image_data(record["path"])
    if not data:
        return ""
    body = {
        "model": "qwen3-vl-8b",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}},
            ],
        }],
        "max_tokens": 64,
        "temperature": 0.2,
        "stream": False,
    }
    req = urllib.request.Request(
        API,
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    text = str(payload.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
    return text[:200]


ok = 0
failed = 0
started = time.time()
for i, record in enumerate(pending, 1):
    try:
        meaning = caption(record)
        if meaning and "?" not in meaning:
            record["meaning"] = meaning
            record["needsMeaning"] = False
            ok += 1
        else:
            failed += 1
    except Exception as exc:
        failed += 1
        if i <= 3:
            print(f"error: {exc}", flush=True)
    if i % 20 == 0:
        tmp = index_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, index_path)
        elapsed = max(1, time.time() - started)
        print(f"{i}/{len(pending)} ok={ok} failed={failed} {i/elapsed*60:.1f}/min", flush=True)

tmp = index_path.with_suffix(".json.tmp")
tmp.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
os.replace(tmp, index_path)
print(f"done ok={ok} failed={failed}", flush=True)
