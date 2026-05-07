"""
fyers_watchlist_sync.py
Syncs today's active-uptrend stocks from Neon DB into a Fyers watchlist.

Opens trade.fyers.in in a browser window — you log in manually.
Once you land on the trading home page, the script takes over:
  1. Imports a timestamped UPTREND watchlist from today's scan results.
  2. Cleans up any old date-named watchlists from previous runs.

Session is saved to fyers_session/ so subsequent runs on the same day
skip the login entirely (unless the session has expired).

Run standalone:
    python fyers_watchlist_sync.py
"""

import time
import datetime
import logging
from pathlib import Path

import psycopg2
from config import NEON_URL

BASE_DIR      = Path(__file__).parent
WATCHLIST_DIR = BASE_DIR / "watchlists"
SESSION_DIR   = BASE_DIR / "fyers_session"
SNAPSHOT_DIR  = BASE_DIR / "watchlist_snapshots"

for d in (WATCHLIST_DIR, SESSION_DIR, SNAPSHOT_DIR):
    d.mkdir(exist_ok=True)

FYERS_URL = "https://trade.fyers.in"

logging.basicConfig(level=logging.INFO, format="[watchlist] %(message)s")
log = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _ist_now() -> datetime.datetime:
    tz = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    return datetime.datetime.now(tz)


def _today_str() -> str:
    return _ist_now().strftime("%Y-%m-%d")


def _is_logged_in(page) -> bool:
    try:
        from urllib.parse import urlparse
        return urlparse(page.url).netloc == "trade.fyers.in"
    except Exception:
        return False


# ── Database ─────────────────────────────────────────────────────────────────

def _get_uptrend_symbols() -> list[str]:
    """Return fyers_symbol values where daily_cross_active is True."""
    conn = psycopg2.connect(NEON_URL)
    cur = conn.cursor()
    cur.execute("SELECT fyers_symbol FROM stocks WHERE daily_cross_active = TRUE ORDER BY rs_score DESC NULLS LAST")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [r[0] for r in rows if r[0]]


# ── Watchlist file ────────────────────────────────────────────────────────────

def _write_watchlist_file(name: str, symbols: list[str]) -> Path:
    path = WATCHLIST_DIR / f"{name}.txt"
    path.write_text(",".join(symbols) if symbols else "")
    return path


# ── Browser helpers ───────────────────────────────────────────────────────────

def _get_app_frame(page):
    """Return the frame with the most buttons (TradingView app frame)."""
    best_frame = page.main_frame
    best_count = 0
    for f in page.frames:
        try:
            count = f.evaluate("() => document.querySelectorAll('button').length")
            if count > best_count:
                best_count = count
                best_frame = f
        except Exception:
            pass
    log.info("App frame: url=%s buttons=%d", best_frame.url[:60], best_count)
    return best_frame


def _find_el_any_frame(page, selectors: list):
    for f in page.frames:
        for sel in selectors:
            try:
                el = f.query_selector(sel)
                if el and el.is_visible():
                    return f, el
            except Exception:
                pass
    return None, None


def _open_dropdown_any_tab(frame) -> bool:
    result = frame.evaluate("""
        () => {
            const tab = document.querySelector('button[data-name="watchlists-button"]');
            if (!tab) return false;
            const arrow = tab.querySelector('.arrow-merBkM5y');
            (arrow || tab).click();
            return true;
        }
    """)
    if result:
        time.sleep(0.8)
    return bool(result)


def _confirm_dialog(page) -> bool:
    for f in page.frames:
        try:
            result = f.evaluate("""
                () => {
                    const btn = document.querySelector('button[name="yes"]');
                    if (btn) { btn.click(); return true; }
                    return null;
                }
            """)
            if result:
                log.info("Confirmed dialog")
                time.sleep(0.6)
                return True
        except Exception:
            pass
    return False


def _do_import(page, frame, file_path: Path) -> bool:
    if not _open_dropdown_any_tab(frame):
        return False

    _, el = _find_el_any_frame(page, ['text=Import list', 'text=Import List'])
    if not el:
        log.warning("'Import list' not found in dropdown")
        return False

    try:
        with page.expect_file_chooser(timeout=5000) as fc:
            el.click()
        fc.value.set_files(str(file_path))
        log.info("File set: %s (%d symbols)", file_path.name,
                 len(file_path.read_text().strip().split(",")))
        return True
    except Exception as e:
        log.warning("File chooser failed: %s", e)
        return False


def _import_watchlist(page, name: str, file_path: Path) -> bool:
    content = file_path.read_text().strip()
    if not content:
        log.warning("Empty watchlist — skipping '%s'", name)
        return False
    log.info("Importing '%s' (%d symbols)", name, len(content.split(",")))

    frame = _get_app_frame(page)
    if not _do_import(page, frame, file_path):
        page.screenshot(path=str(SNAPSHOT_DIR / f"{name}_fail.png"))
        return False

    time.sleep(1)
    page.screenshot(path=str(SNAPSHOT_DIR / f"{name}_done.png"))
    log.info("✓ '%s' imported.", name)
    return True


def _delete_old_watchlists(page, keep: set):
    """Delete all YYYY-MM-DD_* watchlists except those in `keep`."""
    import re
    DATE_PAT = re.compile(r'^\d{4}-\d{2}-\d{2}_')

    for _ in range(30):
        try:
            frame = _get_app_frame(page)
            time.sleep(0.3)

            if not _open_dropdown_any_tab(frame):
                log.warning("Could not open dropdown during cleanup")
                break

            # Wait for menuitem rows to appear
            found_rows = False
            deadline = time.time() + 5.0
            while time.time() < deadline:
                for f in page.frames:
                    try:
                        count = f.evaluate("() => document.querySelectorAll('div[data-role=\"menuitem\"]').length")
                        if count > 0:
                            found_rows = True
                            break
                    except Exception:
                        pass
                if found_rows:
                    break
                time.sleep(0.3)

            if not found_rows:
                _open_dropdown_any_tab(frame)
                time.sleep(2.0)

            time.sleep(0.3)

            # Find first old watchlist name
            name = None
            for f in page.frames:
                try:
                    result = f.evaluate(f"""
                        () => {{
                            const keep = {repr(list(keep))};
                            const rows = [...document.querySelectorAll('div[data-role="menuitem"]')];
                            const names = rows.map(r => {{
                                const el = r.querySelector('.title-Pho75f2H');
                                return el ? el.textContent.trim() : '';
                            }}).filter(n => n);
                            const old = names.filter(n => /^\\d{{4}}-\\d{{2}}-\\d{{2}}_/.test(n) && !keep.includes(n));
                            return old[0] || null;
                        }}
                    """)
                    if result:
                        name = result
                        break
                except Exception:
                    pass

            if not name:
                log.info("No more old watchlists to delete.")
                try:
                    _get_app_frame(page).press("body", "Escape")
                except Exception:
                    pass
                break

            # Click X on that row
            clicked = False
            for f in page.frames:
                try:
                    clicked = f.evaluate(f"""
                        () => {{
                            for (const row of document.querySelectorAll('div[data-role="menuitem"]')) {{
                                const el = row.querySelector('.title-Pho75f2H');
                                if (el && el.textContent.trim() === {repr(name)}) {{
                                    const xBtn = row.querySelector('[data-name="remove-button"]');
                                    if (xBtn) {{ xBtn.click(); return true; }}
                                }}
                            }}
                            return false;
                        }}
                    """)
                    if clicked:
                        break
                except Exception:
                    pass

            if clicked:
                time.sleep(0.5)
                _confirm_dialog(page)
                log.info("Deleted: '%s'", name)
                time.sleep(0.8)
            else:
                log.warning("X button not found for '%s' — skipping", name)
                try:
                    _get_app_frame(page).press("body", "Escape")
                except Exception:
                    pass

        except Exception as e:
            log.warning("Cleanup iteration error: %s", e)
            break

    log.info("Cleanup done.")


# ── Session lock ──────────────────────────────────────────────────────────────

def _clear_session_lock():
    SESSION_DIR.mkdir(exist_ok=True)
    for lock in ("SingletonLock", "SingletonCookie", "lockfile"):
        p = SESSION_DIR / lock
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass
    log.info("Session lock files cleared.")


# ── Main ──────────────────────────────────────────────────────────────────────

def sync_watchlists():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.error("playwright not installed. Run: pip install playwright && python -m playwright install chromium")
        return

    # Fetch symbols from DB
    symbols = _get_uptrend_symbols()
    if not symbols:
        log.info("No active uptrend stocks found in DB — nothing to sync.")
        return
    log.info("Found %d active uptrend stocks.", len(symbols))

    # Build timestamped watchlist name and file
    today = _today_str()
    ts = _ist_now().strftime("%H%M")
    wl_name = f"{today}_UPTREND_{ts}"
    wl_path = _write_watchlist_file(wl_name, symbols)
    log.info("Watchlist file written: %s", wl_path)

    _clear_session_lock()

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(SESSION_DIR),
            headless=False,
            no_viewport=True,
            args=[
                "--start-maximized",
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-infobars",
                "--disable-dev-shm-usage",
            ],
            ignore_default_args=["--enable-automation"],
        )
        ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(FYERS_URL, timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        time.sleep(2)

        if not _is_logged_in(page):
            log.info("=" * 60)
            log.info("Please log in to Fyers in the browser window.")
            log.info("Waiting up to 10 minutes for you to reach trade.fyers.in ...")
            log.info("=" * 60)

            deadline = time.time() + 600
            while time.time() < deadline:
                for pg in ctx.pages:
                    try:
                        if _is_logged_in(pg):
                            page = pg
                            log.info("Logged in — detected on: %s", page.url)
                            break
                    except Exception:
                        pass
                else:
                    time.sleep(2)
                    continue
                break
            else:
                log.error("Login wait timed out (10 min). Exiting.")
                page.screenshot(path=str(SNAPSHOT_DIR / "login_timeout.png"))
                ctx.close()
                return

        if not _is_logged_in(page):
            log.error("Not on trade.fyers.in after wait. URL: %s", page.url)
            ctx.close()
            return

        log.info("On trade.fyers.in — starting watchlist sync.")
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        time.sleep(4)

        _import_watchlist(page, wl_name, wl_path)
        time.sleep(1)

        try:
            _delete_old_watchlists(page, keep={wl_name})
        except Exception as e:
            log.warning("Cleanup error (non-fatal): %s", e)

        ctx.close()
        log.info("Done — watchlist '%s' synced with %d symbols.", wl_name, len(symbols))


if __name__ == "__main__":
    sync_watchlists()
