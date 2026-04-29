# HypeNode Agent Service

Python LangGraph + MCP service that powers the autonomous research-to-execution
loop behind the Next.js frontend.

## Layout

```
src/
  main.py          FastAPI HTTP surface used by the Next.js API routes
  graph.py         LangGraph state machine (10 nodes mirrors Agent Console UI)
  mcp_server.py    MCP server exposing 7 tools to chat / external clients
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

## MCP

Run the MCP server independently for Claude Desktop / external clients:

```bash
python -m src.mcp_server
```

It exposes:

- `terminal.get_sentiment`
- `terminal.get_fund_flow`
- `terminal.get_news`
- `backtest.run`
- `ssi.wrap` / `ssi.unwrap`
- `sodex.execute_trade`
- `risk.check_thresholds`
