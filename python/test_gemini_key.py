from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_PROMPT = "Bạn là ai?"
DEFAULT_MODEL = "gemini-2.5-flash"
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = REPO_ROOT / ".env"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Chat test Gemini API.")
    parser.add_argument("--api-key", help="Gemini API key.")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE))
    parser.add_argument("--model", default=None)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--timeout", type=int, default=20)
    return parser.parse_args()


def load_env_file(env_path: Path) -> dict[str, str]:
    if not env_path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")

    return values


def mask_key(api_key: str) -> str:
    if len(api_key) <= 10:
        return "*" * len(api_key)
    return f"{api_key[:6]}***{api_key[-4:]}"


def extract_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""

    parts = candidates[0].get("content", {}).get("parts") or []
    return "\n".join(
        part.get("text", "").strip()
        for part in parts
        if isinstance(part, dict) and part.get("text")
    ).strip()


def call_gemini(api_key: str, model: str, prompt: str, timeout: int) -> tuple[int, dict]:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{urllib.parse.quote(model)}:generateContent?key={urllib.parse.quote(api_key)}"
    )

    request_payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1000,
            "thinkingConfig": {
                "thinkingBudget": 0
            }
        }
    }

    print("\n===== REQUEST URL =====")
    print(url.replace(api_key, mask_key(api_key)))

    print("\n===== REQUEST BODY =====")
    print(json.dumps(request_payload, indent=2, ensure_ascii=False))

    request = urllib.request.Request(
        url,
        data=json.dumps(request_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_text = response.read().decode("utf-8")

            print("\n===== RESPONSE RAW =====")
            print(response_text)

            return response.status, json.loads(response_text)

    except urllib.error.HTTPError as error:
        body_text = error.read().decode("utf-8", errors="replace")

        print("\n===== ERROR RESPONSE =====")
        print(body_text)

        try:
            payload = json.loads(body_text)
        except json.JSONDecodeError:
            payload = {"error": {"message": body_text}}

        return error.code, payload


def main() -> int:
    args = parse_args()
    env_values = load_env_file(Path(args.env_file))

    api_key = (
        args.api_key
        or os.getenv("GEMINI_API_KEY")
        or env_values.get("GEMINI_API_KEY")
        or ""
    ).strip()

    model = (
        args.model
        or os.getenv("GEMINI_MODEL")
        or env_values.get("GEMINI_MODEL")
        or DEFAULT_MODEL
    ).strip()

    if not api_key:
        print("Không tìm thấy GEMINI_API_KEY.", file=sys.stderr)
        print("Thêm vào file .env:", file=sys.stderr)
        print("GEMINI_API_KEY=your_api_key_here", file=sys.stderr)
        return 1

    print(f"Env file : {args.env_file}")
    print(f"Model    : {model}")
    print(f"API key  : {mask_key(api_key)}")
    print(f"Prompt   : {args.prompt}")
    print("Đang gọi Gemini API...")

    status_code, payload = call_gemini(
        api_key=api_key,
        model=model,
        prompt=args.prompt,
        timeout=args.timeout
    )

    print("\n===== RESULT =====")
    print(f"HTTP     : {status_code}")

    answer = extract_text(payload)
    error_message = payload.get("error", {}).get("message", "").strip()

    if answer:
        print(f"Kết quả  : {answer}")
    elif error_message:
        print(f"Lỗi API  : {error_message}")
    else:
        print("Không lấy được text. Full response:")
        print(json.dumps(payload, indent=2, ensure_ascii=False))

    return 0 if 200 <= status_code < 300 else 1


if __name__ == "__main__":
    raise SystemExit(main())