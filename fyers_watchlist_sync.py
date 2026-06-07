"""
fyers_watchlist_sync.py
Opens trade.fyers.in, waits for the user to log in manually, then imports
the supplied symbols as one or more watchlists (max 250 symbols each).

Called by main.py via subprocess:
    python fyers_watchlist_sync.py --symbols "NSE:RELIANCE-EQ,NSE:TCS-EQ,..."

Standalone (imports all active-uptrend stocks from DB):
    python fyers_watchlist_sync.py
"""

import sys
import time
import datetime
import logging
import argparse
from pathlib import Path

BASE_DIR      = Path(__file__).parent
WATCHLIST_DIR = BASE_DIR / "watchlists"
SESSION_DIR   = BASE_DIR / "fyers_session"
SNAPSHOT_DIR  = BASE_DIR / "watchlist_snapshots"

for d in (WATCHLIST_DIR, SESSION_DIR, SNAPSHOT_DIR):
    d.mkdir(exist_ok=True)

FYERS_URL     = "https://trade.fyers.in"
MAX_PER_LIST  = 250

logging.basicConfig(level=logging.INFO, format="[watchlist] %(message)s")
log = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ist_now() -> datetime.datetime:
    tz = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    return datetime.datetime.now(tz)

def _today_str() -> str:
    return _ist_now().strftime("%Y-%m-%d")

def _is_logged_in(page) -> bool:
    """
    Return True once the user has passed the login screen.
    Fyers may redirect to trade.fyers.in, fyers.in/charts, or similar —
    so we accept any fyers.in page that is NOT the login page itself.
    """
    try:
        from urllib.parse import urlparse
        url = page.url or ""
        netloc = urlparse(url).netloc
        if "fyers.in" not in netloc:
            return False
        # Still on login/auth pages — not done yet
        login_indicators = ("login", "auth", "signin", "sso", "myaccount")
        if any(ind in url.lower() for ind in login_indicators):
            return False
        return True
    except Exception:
        return False


# ── DB fallback (standalone mode) ─────────────────────────────────────────────

def _get_uptrend_symbols_from_db() -> list[str]:
    import psycopg2
    from config import NEON_URL
    conn = psycopg2.connect(NEON_URL)
    cur = conn.cursor()
    cur.execute(
        "SELECT fyers_symbol FROM stocks WHERE daily_cross_active = TRUE ORDER BY rs_score DESC NULLS LAST"
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [r[0] for r in rows if r[0]]


# ── Watchlist files ───────────────────────────────────────────────────────────

def _chunk(symbols: list[str], size: int) -> list[list[str]]:
    return [symbols[i:i+size] for i in range(0, len(symbols), size)]

def _write_watchlist_file(name: str, symbols: list[str]) -> Path:
    path = WATCHLIST_DIR / f"{name}.txt"
    path.write_text(",".join(symbols))
    return path


# ── Session lock ──────────────────────────────────────────────────────────────

def _clear_session_lock():
    for lock in ("SingletonLock", "SingletonCookie", "lockfile"):
        try:
            (SESSION_DIR / lock).unlink(missing_ok=True)
        except Exception:
            pass


# ── Watchlist browser helpers ─────────────────────────────────────────────────

def _get_app_frame(page):
    best_frame, best_count = page.main_frame, 0
    for f in page.frames:
        try:
            count = f.evaluate("() => document.querySelectorAll('button').length")
            if count > best_count:
                best_count = count
                best_frame = f
        except Exception:
            pass
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


def _wait_for_watchlist_button(page, timeout=60) -> bool:
    """Poll all frames until the watchlist button is present in the DOM."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        for f in page.frames:
            try:
                found = f.evaluate("""
                    () => !!document.querySelector('button[data-name="watchlists-button"]')
                """)
                if found:
                    return True
            except Exception:
                pass
        time.sleep(1)
    return False


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
                time.sleep(0.6)
                return True
        except Exception:
            pass
    return False


def _do_import(page, frame, file_path: Path) -> bool:
    if not _open_dropdown_any_tab(frame):
        log.warning("Could not open watchlist dropdown")
        return False
    time.sleep(1.0)
    # Try multiple label variants Fyers has used across versions
    _, el = _find_el_any_frame(page, [
        'text=Import list',
        'text=Import List',
        'text=Import watchlist',
        'text=Import Watchlist',
        '[data-name="import-list"]',
        '[title="Import list"]',
    ])
    if not el:
        # Dump what's visible in the dropdown for debugging
        for f in page.frames:
            try:
                items = f.evaluate("""
                    () => [...document.querySelectorAll('div[data-role="menuitem"]')]
                          .map(e => e.textContent.trim())
                """)
                if items:
                    log.warning("Dropdown items found: %s", items)
                    break
            except Exception:
                pass
        log.warning("'Import list' not found in dropdown")
        return False
    try:
        with page.expect_file_chooser(timeout=8000) as fc:
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
    for _ in range(50):
        try:
            frame = _get_app_frame(page)
            time.sleep(0.3)
            if not _open_dropdown_any_tab(frame):
                break

            # Wait for menuitem rows
            found_rows = False
            deadline = time.time() + 5.0
            while time.time() < deadline:
                for f in page.frames:
                    try:
                        if f.evaluate("() => document.querySelectorAll('div[data-role=\"menuitem\"]').length") > 0:
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

            # Find first old watchlist to delete
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
                log.warning("X not found for '%s' — skipping", name)
                try:
                    _get_app_frame(page).press("body", "Escape")
                except Exception:
                    pass

        except Exception as e:
            log.warning("Cleanup iteration error: %s", e)
            break

    log.info("Cleanup done.")


# ── Main ──────────────────────────────────────────────────────────────────────

def sync_watchlists(symbols: list[str]):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.error("playwright not installed. Run: pip install playwright && python -m playwright install chromium")
        return

    if not symbols:
        log.info("No symbols — nothing to sync.")
        return

    today = _today_str()
    ts    = _ist_now().strftime("%H%M")

    # Split into chunks of 250 and build (name, file) pairs
    chunks = _chunk(symbols, MAX_PER_LIST)
    watchlists = []
    for i, chunk in enumerate(chunks, start=1):
        suffix = f"_P{i}" if len(chunks) > 1 else ""
        name   = f"{today}_SCAN{suffix}_{ts}"
        path   = _write_watchlist_file(name, chunk)
        watchlists.append((name, path))
        log.info("Chunk %d/%d: '%s' — %d symbols", i, len(chunks), name, len(chunk))

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
        ctx.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )

        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(FYERS_URL, timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        time.sleep(2)

        # ── Wait for manual login ─────────────────────────────────────────────
        if not _is_logged_in(page):
            log.info("=" * 60)
            log.info("Please log in to Fyers in the browser window.")
            log.info("Waiting up to 10 minutes...")
            log.info("=" * 60)

            deadline = time.time() + 600
            logged_in = False
            while time.time() < deadline:
                # Check all open tabs — Fyers sometimes opens a new tab after login
                for pg in list(ctx.pages):
                    try:
                        if _is_logged_in(pg):
                            page = pg
                            logged_in = True
                            break
                    except Exception:
                        pass
                if logged_in:
                    log.info("Login detected — URL: %s", page.url)
                    break
                time.sleep(1)

            if not logged_in:
                log.error("Login wait timed out. Exiting.")
                try:
                    page.screenshot(path=str(SNAPSHOT_DIR / "login_timeout.png"))
                except Exception:
                    pass
                ctx.close()
                return

        log.info("Logged in — waiting for trading platform to fully load...")
        try:
            page.wait_for_load_state("domcontentloaded", timeout=30000)
        except Exception:
            pass

        # If login landed on a non-trade page (e.g. fyers.in/charts), navigate to trade
        if "trade.fyers.in" not in page.url:
            log.info("Landed on %s — navigating to trade.fyers.in for watchlist access...", page.url)
            page.goto(FYERS_URL, timeout=30000)
            try:
                page.wait_for_load_state("domcontentloaded", timeout=30000)
            except Exception:
                pass

        # Wait until the watchlist button actually appears in the SPA — up to 90 seconds.
        # This is the reliable signal that the UI is ready, replacing a fixed sleep.
        log.info("Waiting for watchlist UI to be ready...")
        if not _wait_for_watchlist_button(page, timeout=90):
            log.warning("Watchlist button not found after 90s — attempting import anyway.")
        else:
            log.info("Watchlist UI ready.")
            time.sleep(1)  # brief settle after button appears

        log.info("Starting import of %d watchlist(s).", len(watchlists))

        # ── Import all chunks ─────────────────────────────────────────────────
        imported_names = set()
        for wl_name, wl_path in watchlists:
            ok = _import_watchlist(page, wl_name, wl_path)
            if ok:
                imported_names.add(wl_name)
            time.sleep(1.5)

        ctx.close()
        log.info("Done — %d watchlist(s) synced, %d total symbols.",
                 len(imported_names), len(symbols))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", type=str, default="",
                        help="Comma-separated fyers_symbol list")
    args = parser.parse_args()

    if args.symbols.strip():
        syms = [s.strip() for s in args.symbols.split(",") if s.strip()]
    else:
        log.info("No --symbols given — fetching active uptrend stocks from DB.")
        syms = _get_uptrend_symbols_from_db()

    sync_watchlists(syms)
