"""SQLite-backed persistence for the agent runtime.

Two surfaces:
  - Risk config (singleton)  — five numeric thresholds + per-rule enable
    flags + a global manual override. Read every cycle by `risk_node` so the
    user can change limits via UI without restarting the service.
  - Decision log (append-only) — one row per LangGraph cycle. Holds the
    summary signal/basket/risk/exec snapshot. Surfaces the History page with
    real audit trail (LATEST_LOG is RAM-only and capped at 250 entries).

DB lives at $HYPE_DB_PATH or `agent-service/data/hypenode.db`. The directory
is created on init; the schema is idempotent so cold starts on a fresh disk
work without external migration.

All access is sync (sqlite3 stdlib) and short-lived per-call — the cycle
runner already has plenty of awaits, and contention is single-writer in
practice. We open with `check_same_thread=False` so FastAPI's threadpool can
serve reads concurrently with the runner's writes.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# Default thresholds mirror tools/risk.py DEFAULT_THRESHOLDS — kept in sync so
# a fresh DB seeds with the same values the rule-based fallback would use.
_DEFAULT_RISK_CONFIG: dict[str, Any] = {
    "volatility_max": 0.35,
    "drawdown_max": 0.15,
    "sentiment_delta_min": -20.0,
    "single_asset_weight_max": 0.25,
    "net_outflow_24h_max_usd": 5_000_000.0,
    "rule_volatility_enabled": True,
    "rule_drawdown_enabled": True,
    "rule_sentiment_enabled": True,
    "rule_weight_enabled": True,
    "rule_outflow_enabled": True,
    "manual_override": False,
}


def _db_path() -> Path:
    explicit = os.getenv("HYPE_DB_PATH")
    if explicit:
        return Path(explicit)
    return Path(__file__).resolve().parent.parent / "data" / "hypenode.db"


_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    with _lock:
        if _conn is not None:
            return _conn
        path = _db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # WAL keeps reads non-blocking against the runner's writes — the
        # /history endpoint hits the same DB while a cycle is being persisted.
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        _init_schema(conn)
        _conn = conn
        return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS risk_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          volatility_max REAL NOT NULL,
          drawdown_max REAL NOT NULL,
          sentiment_delta_min REAL NOT NULL,
          single_asset_weight_max REAL NOT NULL,
          net_outflow_24h_max_usd REAL NOT NULL,
          rule_volatility_enabled INTEGER NOT NULL DEFAULT 1,
          rule_drawdown_enabled INTEGER NOT NULL DEFAULT 1,
          rule_sentiment_enabled INTEGER NOT NULL DEFAULT 1,
          rule_weight_enabled INTEGER NOT NULL DEFAULT 1,
          rule_outflow_enabled INTEGER NOT NULL DEFAULT 1,
          manual_override INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          sector TEXT,
          idle INTEGER NOT NULL DEFAULT 0,
          basket_size INTEGER,
          basket_top_symbol TEXT,
          basket_top_weight REAL,
          basket_json TEXT,
          strategy_source TEXT,
          strategy_confidence TEXT,
          strategy_reasoning TEXT,
          sentiment_score REAL,
          sentiment_delta REAL,
          flow_inflow_usd REAL,
          backtest_sharpe REAL,
          backtest_drawdown REAL,
          backtest_win_rate REAL,
          risk_verdict TEXT,
          risk_breaches_json TEXT,
          ssi_tx_hash TEXT,
          ssi_status TEXT,
          sodex_placed INTEGER,
          sodex_skipped INTEGER,
          sodex_errors INTEGER,
          emergency INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_decisions_ts ON decisions(ts DESC);
        CREATE INDEX IF NOT EXISTS idx_decisions_sector ON decisions(sector);
        """
    )
    # Seed singleton risk_config row if missing.
    cur = conn.execute("SELECT id FROM risk_config WHERE id = 1")
    if cur.fetchone() is None:
        cfg = _DEFAULT_RISK_CONFIG
        conn.execute(
            """
            INSERT INTO risk_config (
              id, volatility_max, drawdown_max, sentiment_delta_min,
              single_asset_weight_max, net_outflow_24h_max_usd,
              rule_volatility_enabled, rule_drawdown_enabled,
              rule_sentiment_enabled, rule_weight_enabled,
              rule_outflow_enabled, manual_override, updated_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cfg["volatility_max"],
                cfg["drawdown_max"],
                cfg["sentiment_delta_min"],
                cfg["single_asset_weight_max"],
                cfg["net_outflow_24h_max_usd"],
                int(cfg["rule_volatility_enabled"]),
                int(cfg["rule_drawdown_enabled"]),
                int(cfg["rule_sentiment_enabled"]),
                int(cfg["rule_weight_enabled"]),
                int(cfg["rule_outflow_enabled"]),
                int(cfg["manual_override"]),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
    conn.commit()


def init() -> None:
    """Eagerly open + migrate the DB. Safe to call multiple times."""
    _get_conn()


# ---------------- Risk config ----------------


def _row_to_risk_config(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "volatility_max": float(row["volatility_max"]),
        "drawdown_max": float(row["drawdown_max"]),
        "sentiment_delta_min": float(row["sentiment_delta_min"]),
        "single_asset_weight_max": float(row["single_asset_weight_max"]),
        "net_outflow_24h_max_usd": float(row["net_outflow_24h_max_usd"]),
        "rule_volatility_enabled": bool(row["rule_volatility_enabled"]),
        "rule_drawdown_enabled": bool(row["rule_drawdown_enabled"]),
        "rule_sentiment_enabled": bool(row["rule_sentiment_enabled"]),
        "rule_weight_enabled": bool(row["rule_weight_enabled"]),
        "rule_outflow_enabled": bool(row["rule_outflow_enabled"]),
        "manual_override": bool(row["manual_override"]),
        "updated_at": row["updated_at"],
    }


def get_risk_config() -> dict[str, Any]:
    conn = _get_conn()
    with _lock:
        row = conn.execute("SELECT * FROM risk_config WHERE id = 1").fetchone()
    # Defensive: if row vanished (manual delete) re-seed and retry.
    if row is None:
        _init_schema(conn)
        with _lock:
            row = conn.execute("SELECT * FROM risk_config WHERE id = 1").fetchone()
    return _row_to_risk_config(row)


# Field whitelist for partial updates — anything outside this set is silently
# dropped so a malformed POST body can't smuggle column names.
_RISK_FIELDS_NUMERIC = {
    "volatility_max",
    "drawdown_max",
    "sentiment_delta_min",
    "single_asset_weight_max",
    "net_outflow_24h_max_usd",
}
_RISK_FIELDS_BOOL = {
    "rule_volatility_enabled",
    "rule_drawdown_enabled",
    "rule_sentiment_enabled",
    "rule_weight_enabled",
    "rule_outflow_enabled",
    "manual_override",
}


def update_risk_config(payload: dict[str, Any]) -> dict[str, Any]:
    """Partial update — only fields in payload are touched. Unknown keys are
    ignored. Returns the resulting row."""
    if not isinstance(payload, dict):
        return get_risk_config()
    sets: list[str] = []
    values: list[Any] = []
    for k, v in payload.items():
        if k in _RISK_FIELDS_NUMERIC:
            try:
                values.append(float(v))
            except (TypeError, ValueError):
                continue
            sets.append(f"{k} = ?")
        elif k in _RISK_FIELDS_BOOL:
            values.append(1 if bool(v) else 0)
            sets.append(f"{k} = ?")
    if not sets:
        return get_risk_config()
    sets.append("updated_at = ?")
    values.append(datetime.now(timezone.utc).isoformat())
    sql = f"UPDATE risk_config SET {', '.join(sets)} WHERE id = 1"
    conn = _get_conn()
    with _lock:
        conn.execute(sql, values)
        conn.commit()
    return get_risk_config()


# ---------------- Decision log ----------------


def append_decision(record: dict[str, Any]) -> int:
    """Persist one cycle's summary. `record` is the runner's snapshot dict."""
    conn = _get_conn()
    cols = (
        "ts", "sector", "idle", "basket_size", "basket_top_symbol",
        "basket_top_weight", "basket_json", "strategy_source",
        "strategy_confidence", "strategy_reasoning", "sentiment_score",
        "sentiment_delta", "flow_inflow_usd", "backtest_sharpe",
        "backtest_drawdown", "backtest_win_rate", "risk_verdict",
        "risk_breaches_json", "ssi_tx_hash", "ssi_status", "sodex_placed",
        "sodex_skipped", "sodex_errors", "emergency",
    )
    values = tuple(record.get(c) for c in cols)
    placeholders = ",".join(["?"] * len(cols))
    sql = f"INSERT INTO decisions ({', '.join(cols)}) VALUES ({placeholders})"
    with _lock:
        cur = conn.execute(sql, values)
        conn.commit()
        return int(cur.lastrowid or 0)


def list_decisions(
    limit: int = 100,
    sector: str | None = None,
    since_iso: str | None = None,
) -> list[dict[str, Any]]:
    conn = _get_conn()
    where: list[str] = []
    args: list[Any] = []
    if sector:
        where.append("sector = ?")
        args.append(sector)
    if since_iso:
        where.append("ts >= ?")
        args.append(since_iso)
    sql = "SELECT * FROM decisions"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY ts DESC LIMIT ?"
    args.append(int(max(1, min(500, limit))))
    with _lock:
        rows = conn.execute(sql, args).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        d = {k: r[k] for k in r.keys()}
        # Hydrate JSON columns so callers get structured data instead of
        # decoding strings.
        if d.get("basket_json"):
            try:
                d["basket"] = json.loads(d["basket_json"])
            except json.JSONDecodeError:
                d["basket"] = None
        if d.get("risk_breaches_json"):
            try:
                d["risk_breaches"] = json.loads(d["risk_breaches_json"])
            except json.JSONDecodeError:
                d["risk_breaches"] = None
        d["idle"] = bool(d.get("idle"))
        d["emergency"] = bool(d.get("emergency"))
        out.append(d)
    return out


def decision_stats(window_days: int = 30) -> dict[str, Any]:
    """Cheap aggregate for History page header KPIs.
    Returns count, last_decision_at, emergency count, distinct sectors."""
    conn = _get_conn()
    with _lock:
        total = conn.execute("SELECT COUNT(*) AS c FROM decisions").fetchone()["c"]
        emerg = conn.execute(
            "SELECT COUNT(*) AS c FROM decisions WHERE emergency = 1"
        ).fetchone()["c"]
        last = conn.execute(
            "SELECT ts FROM decisions ORDER BY ts DESC LIMIT 1"
        ).fetchone()
        idle = conn.execute(
            "SELECT COUNT(*) AS c FROM decisions WHERE idle = 1"
        ).fetchone()["c"]
        sectors = conn.execute(
            "SELECT DISTINCT sector FROM decisions WHERE sector IS NOT NULL"
        ).fetchall()
    return {
        "total": int(total),
        "emergency_count": int(emerg),
        "idle_count": int(idle),
        "active_count": int(total - idle),
        "last_decision_at": (last["ts"] if last else None),
        "sectors": [r["sector"] for r in sectors],
        "window_days": window_days,
    }
