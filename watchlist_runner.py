"""
watchlist_runner.py
Lightweight local agent — run this once on your machine before clicking
"Fyers Watchlist Import" in the browser.

What it does:
  1. Polls the Render backend every 3 seconds for a pending watchlist job.
  2. When a job arrives, launches fyers_watchlist_sync.py with the symbols.
  3. Marks the job done on Render.
  4. Exits automatically.

Usage:
  python watchlist_runner.py

Put a shortcut to this on your desktop. Double-click it before you click
the button in the browser. It uses almost no memory while waiting and
closes itself after the sync completes.
"""

import sys
import time
import subprocess
import requests
from pathlib import Path

RENDER_BASE = "https://algo-scanner-lnck.onrender.com"
POLL_INTERVAL = 3        # seconds between polls
WAIT_TIMEOUT  = 300      # give up waiting for a job after 5 min

SCRIPT = Path(__file__).parent / "fyers_watchlist_sync.py"


def poll_for_job():
    print("Watchlist Runner ready — waiting for job from browser (up to 5 min)...")
    deadline = time.time() + WAIT_TIMEOUT
    while time.time() < deadline:
        try:
            r = requests.get(f"{RENDER_BASE}/api/fyers-watchlist-job", timeout=10)
            data = r.json()
            if data.get("status") == "ok":
                return data["job_id"], data["symbols"]
            if data.get("status") not in ("none", "ok"):
                print(f"Unexpected response: {data}")
        except Exception as e:
            print(f"Poll error: {e}")
        time.sleep(POLL_INTERVAL)
    return None, None


def mark_done(job_id: int, result: str):
    try:
        requests.post(
            f"{RENDER_BASE}/api/fyers-watchlist-done",
            json={"job_id": job_id, "result": result},
            timeout=10
        )
    except Exception as e:
        print(f"Could not mark job done: {e}")


def main():
    job_id, symbols = poll_for_job()

    if not job_id:
        print("No job received within 5 minutes. Exiting.")
        sys.exit(0)

    print(f"Job {job_id} received — {len(symbols)} symbols. Launching Fyers sync...")

    symbols_arg = ",".join(symbols)
    result = "failed"
    try:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--symbols", symbols_arg],
            timeout=1800   # 30 min max for login + import
        )
        result = "done" if proc.returncode == 0 else "failed"
    except subprocess.TimeoutExpired:
        print("Sync timed out after 30 minutes.")
        result = "failed"
    except Exception as e:
        print(f"Sync error: {e}")
        result = "failed"

    mark_done(job_id, result)
    print(f"Job {job_id} marked as '{result}'. Exiting.")
    sys.exit(0)


if __name__ == "__main__":
    main()
