#!/usr/bin/env python3
"""Fresh QR login flow for Buyin using CloakBrowser persistent profiles.

Creates a brand-new CloakBrowser profile, opens the Buyin login page, captures
the QR code, optionally sends it to Lark, and saves both Playwright-compatible
JSON state plus the persistent profile directory for future runs.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from cloakbrowser import launch_persistent_context


LOGIN_URL = "https://buyin.jinritemai.com/mpa/account/login?type=24"


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parent
    output_dir = root / "output"
    profile_dir = root / "profiles" / "douyin-buyin"
    parser = argparse.ArgumentParser(description="QR login with CloakBrowser")
    parser.add_argument("--profile-dir", type=Path, default=profile_dir)
    parser.add_argument("--output-dir", type=Path, default=output_dir)
    parser.add_argument("--cookie-out", type=Path, default=output_dir / "fresh_cookies.json")
    parser.add_argument("--state-out", type=Path, default=output_dir / "full_storage_state.json")
    parser.add_argument("--session-out", type=Path, default=output_dir / "session_state.json")
    parser.add_argument("--qr-out", type=Path, default=output_dir / "qr_login.png")
    parser.add_argument("--chat-id", default="")
    parser.add_argument("--headless", action="store_true", help="Run headless and use QR screenshot")
    parser.add_argument("--timeout-sec", type=int, default=240)
    parser.add_argument("--humanize", action="store_true")
    return parser.parse_args()


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def atomic_write_json(path: Path, data: object) -> None:
    ensure_parent(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def run_lark(chat_id: str, *args: str, cwd: Path | None = None) -> bool:
    if not chat_id or not shutil.which("lark-cli"):
        return False
    try:
        subprocess.run(
            ["lark-cli", "im", "+messages-send", "--chat-id", chat_id, *args, "--as", "bot"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            cwd=str(cwd) if cwd else None,
        )
        return True
    except Exception as exc:  # pragma: no cover - best effort notification
        print(f"[WARN] lark send failed: {exc}", flush=True)
        return False


def send_qr_to_lark(chat_id: str, qr_path: Path) -> None:
    if not run_lark(chat_id, "--image", f"./{qr_path.name}", cwd=qr_path.parent):
        return
    run_lark(
        chat_id,
        "--text",
        "📡 CloakBrowser 新环境请求登录授权\n请用抖音 APP 扫描二维码\n扫码成功后会保存新的持久化 profile 与 storage state",
    )


def capture_qr(page, qr_path: Path) -> None:
    selectors = [
        "canvas",
        "[class*=qrcode]",
        "[class*=qr-code]",
        "[class*=QrCode]",
        "img[src*='qr']",
        "[class*=scan]",
    ]
    try:
        page.wait_for_selector("canvas", timeout=15000)
    except Exception:
        print("[QR] canvas not found, falling back to generic selectors", flush=True)
    page.wait_for_timeout(2000)
    qr_el = None
    for selector in selectors:
        try:
            page.wait_for_selector(selector, timeout=5000)
            qr_el = page.locator(selector).first
            if qr_el.count():
                print(f"[QR] element found: {selector}", flush=True)
                break
        except Exception:
            continue

    ensure_parent(qr_path)
    if qr_el is not None:
        qr_el.screenshot(path=str(qr_path))
    else:
        page.screenshot(path=str(qr_path), full_page=False)
    print(f"[QR] saved to {qr_path}", flush=True)


def refresh_qr_if_needed(page, qr_path: Path, chat_id: str, refresh_count: int) -> int:
    if refresh_count >= 2:
        return refresh_count
    refresh_selectors = [
        "[class*=expire]",
        "[class*=expired]",
        "[class*=refresh]",
        "text=刷新",
        "text=二维码已过期",
    ]
    for selector in refresh_selectors:
        try:
            locator = page.locator(selector).first
            if locator.count():
                locator.click(timeout=2000)
                time.sleep(2)
                capture_qr(page, qr_path)
                run_lark(chat_id, "--image", f"./{qr_path.name}", cwd=qr_path.parent)
                run_lark(chat_id, "--text", "🔄 二维码已刷新，请重新扫码")
                print("[QR] refreshed", flush=True)
                return refresh_count + 1
        except Exception:
            continue
    return refresh_count


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.profile_dir.mkdir(parents=True, exist_ok=True)

    print("[BOOT] Launching CloakBrowser persistent context...", flush=True)
    context = launch_persistent_context(
        str(args.profile_dir),
        headless=args.headless,
        humanize=args.humanize,
    )

    try:
        page = context.new_page()
        print("[1] Opening login page...", flush=True)
        page.goto(LOGIN_URL, wait_until="networkidle", timeout=30000)
        time.sleep(2.5)

        print("[1] Reloading to force QR render...", flush=True)
        page.reload(wait_until="networkidle", timeout=20000)
        time.sleep(2)

        print("[2] Capturing QR...", flush=True)
        capture_qr(page, args.qr_out)
        send_qr_to_lark(args.chat_id, args.qr_out)

        print(f"[3] Waiting for scan, timeout={args.timeout_sec}s", flush=True)
        deadline = time.time() + args.timeout_sec
        refresh_count = 0

        while time.time() < deadline:
            current_url = page.url
            if "/account/login" not in current_url and "buyin.jinritemai.com" in current_url:
                print(f"[OK] Login success: {current_url}", flush=True)
                break

            refresh_count = refresh_qr_if_needed(page, args.qr_out, args.chat_id, refresh_count)
            time.sleep(3)
        else:
            run_lark(args.chat_id, "--text", "❌ CloakBrowser 扫码登录超时，请重新执行")
            print("[FATAL] QR scan timeout", flush=True)
            return 1

        # Login navigation happens before all auth cookies and storage settle.
        # Give the browser a few extra seconds before persisting state.
        time.sleep(8)

        print("[4] Saving cookies + storage state...", flush=True)
        cookies = context.cookies()
        atomic_write_json(args.cookie_out, cookies)
        ensure_parent(args.state_out)
        tmp_state = args.state_out.with_suffix(args.state_out.suffix + ".tmp")
        context.storage_state(path=str(tmp_state))
        tmp_state.replace(args.state_out)
        atomic_write_json(
            args.session_out,
            {
                "dashboardUrl": page.url,
                "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "profileDir": str(args.profile_dir),
            },
        )

        run_lark(args.chat_id, "--text", "✅ CloakBrowser 扫码成功，新的持久化 profile 与状态文件已保存")
        print("[DONE] Saved new profile and state files.", flush=True)
        print(f"[DONE] profile_dir={args.profile_dir}", flush=True)
        print(f"[DONE] cookie_out={args.cookie_out}", flush=True)
        print(f"[DONE] state_out={args.state_out}", flush=True)
        return 0
    finally:
        context.close()


if __name__ == "__main__":
    sys.exit(main())
