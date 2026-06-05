# HypeNode Agent Service

Python LangGraph + MCP service that powers the autonomous research-to-execution
loop behind the Next.js frontend.

## Layout

```
src/
  main.py          FastAPI HTTP surface used by the Next.js API routes
  graph.py         LangGraph state machine (10 nodes mirrors Agent Console UI)
  mcp_server.py    Standalone MCP server — 17 read-only research tools, installable via hypenode-mcp
  state.py         Pydantic models shared by HTTP + graph
  tools/
    terminal.py    SoSoValue Terminal: sentiment, fund flow, news
    ssi.py         SSI Protocol wrap / unwrap on ValueChain L1
    sodex.py       SoDEX trade execution
    risk.py        Risk gate (volatility / drawdown / sentiment Δ thresholds)
    backtest.py    Lightweight backtester
```

## Run

```bash
cd agent-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in keys
python -m src.main    # serves http://localhost:8001
```

The frontend reads `AGENT_SERVICE_URL` to find this service. Without keys, every
tool returns deterministic synthetic data so the UI works offline.

Useful local diagnostics:

- `GET /health` — FastAPI process health
- `GET /terminal/status` — non-secret SoSoValue cache, backoff, and last-error state

## MCP (Wave-1 delivered)

HypeNode ships a standalone MCP server exposing **17 read-only SoSoValue research tools** to Claude Desktop and any MCP client.

Install and run:

```bash
cd agent-service
pip install -e .         # registers `hypenode-mcp` console-script
hypenode-mcp             # stdio MCP server, ready for Claude Desktop
```

Or without install:

```bash
python -m src.mcp_server
```

See [`docs/CLAUDE_DESKTOP_SETUP.md`](docs/CLAUDE_DESKTOP_SETUP.md) for the full Claude Desktop config guide and copy-paste `claude_desktop_config.example.json`.

**Exposed tools (17 read-only):** `get_sector_sentiment`, `get_fund_flow`, `get_news`, `get_sector_spotlight`, `list_ssi_indices`, `propose_basket`, `run_backtest`, `get_currency_snapshot`, `check_risk_thresholds`, `get_macro_calendar`, `get_macro_event_history`, `get_smart_money_signal`, `list_funding_rounds`, `get_project_fundraising`, `search_rootdata`, `get_rootdata_project`, `get_rootdata_investor`.

**Excluded (stateful/wallet):** All SoDEX trade/transfer/cancel tools and SSI wrap/unwrap — these require a SIWE session and are gated behind a Wave-2 authenticated HTTP/SSE tier.
