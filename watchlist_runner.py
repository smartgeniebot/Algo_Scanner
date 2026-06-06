"""
watchlist_runner.py
Lightweight local agent — run this once on your machine before clicking
"Fyers Watchlist Import" in the browser.

What it does:
  1. Polls the Render backend every 3 seconds for a pending watchlist job.
  2. When a job arrives, launches fyers_watchlist_sync.py with the symbols.
  3. Marks the job done on Render.
  4. Loops back and waits for the next job — stays active until you close the window.

Usage:
  python watchlist_runner.py   (or double-click the bat file)

Keep the window open for the whole session. You can import as many times
as you want without restarting. Press Ctrl+C or close the window to stop.
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


def run_job(job_id: int, symbols: list):
    symbols_arg = ",".join(symbols)
    result = "failed"
    try:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--symbols", symbols_arg],
            timeout=1800
        )
        result = "done" if proc.returncode == 0 else "failed"
    except subprocess.TimeoutExpired:
        print("Sync timed out after 30 minutes.")
    except Exception as e:
        print(f"Sync error: {e}")
    mark_done(job_id, result)
    print(f"Job {job_id} marked as '{result}'.")


def main():
    print("Watchlist Runner started — will stay active until you close this window.")
    print("=" * 60)
    while True:
        job_id, symbols = poll_for_job()

        if not job_id:
            print("No job received within 5 minutes — still watching, press Ctrl+C to exit.")
            continue  # loop back and wait again

        print(f"Job {job_id} received — {len(symbols)} symbols. Launching Fyers sync...")
        run_job(job_id, symbols)
        print("Ready for next import. Waiting for next job...")
        print("-" * 60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nWatchlist Runner stopped by user.")
        sys.exit(0)
