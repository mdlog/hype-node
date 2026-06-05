# HypeNode MCP — Claude Desktop Setup Guide

Connect Claude Desktop to HypeNode's 17 read-only SoSoValue research tools in four steps.

---

## Read-only safety stance

Only research/read-only tools are exposed over this MCP surface. All stateful and wallet tools (`sodex_execute_trade`, `sodex_transfer`, `sodex_cancel_order`, `ssi.wrap`, `ssi.unwrap`, etc.) are intentionally excluded. Without a SIWE session, MCP callers would fall back to the server's signer key — a key-drain risk. Those tools will remain gated behind authentication in a future Wave-2 HTTP/SSE tier.

---

## Installation

### Step 1 — Install the package

```bash
cd agent-service
python -m venv .venv
.venv/bin/pip install -e .
```

This registers the `hypenode-mcp` console-script inside the venv.

### Step 2 — Find the binary path

The binary lives at:

```
<absolute-path-to-agent-service>/.venv/bin/hypenode-mcp
```

Example (macOS/Linux):
```
/Users/you/hypenode-app/agent-service/.venv/bin/hypenode-mcp
```

Example (Windows):
```
C:\Users\you\hypenode-app\agent-service\.venv\Scripts\hypenode-mcp.exe
```

Claude Desktop requires either an absolute path or a binary that is on `PATH`. Using the absolute path is the safest option.

### Step 3 — Configure Claude Desktop

Copy `claude_desktop_config.example.json` into your Claude Desktop config location and fill in the real values.

**Config file locations:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

Replace `"command": "hypenode-mcp"` with the absolute path you found in Step 2, and supply your real API keys:

```json
{
  "mcpServers": {
    "hypenode": {
      "command": "/absolute/path/to/agent-service/.venv/bin/hypenode-mcp",
      "env": {
        "SOSOVALUE_API_KEY": "sk-soso-...",
        "ROOTDATA_API_KEY": "rd-..."
      }
    }
  }
}
```

`ROOTDATA_API_KEY` is optional — RootData fundraising tools degrade gracefully without it.

### Step 4 — Restart Claude Desktop

Quit and reopen Claude Desktop. In the tool panel you should see the `hypenode` server and all 17 tools listed below.

---

## Available tools (17 read-only)

| Tool | Description |
|------|-------------|
| `get_sector_sentiment` | Current sentiment score (0-100) for a crypto sector based on SoSoValue Terminal news velocity |
| `get_fund_flow` | Net fund flow (USD) into a sector over a window; ETF flow for BTC |
| `get_news` | Recent scored headlines for a sector (why is X moving) |
| `get_sector_spotlight` | Snapshot of all macro sectors with 24h change % and dominance |
| `list_ssi_indices` | List SSI Protocol narrative index tickers (ssiDePIN, ssiRWA, ssiAI, …) |
| `propose_basket` | Build an on-chain-grounded basket from live SSI Protocol constituents |
| `run_backtest` | Replay basket performance on real daily klines (Sharpe, drawdown, return) |
| `get_currency_snapshot` | Live market snapshot for a single asset (price, mcap, 24h change) |
| `check_risk_thresholds` | Evaluate portfolio metrics against the standard risk gate (PASS / EMERGENCY_EXIT) |
| `get_macro_calendar` | Upcoming US macro releases (FOMC, CPI, NFP, GDP) for the next N days |
| `get_macro_event_history` | Historical actual / forecast / previous prints for a named macro event |
| `get_smart_money_signal` | Public-company BTC treasury accumulation signal (MSTR, TSLA, MARA, …) |
| `list_funding_rounds` | Recent crypto fundraising rounds from RootData |
| `get_project_fundraising` | Full fundraising history for a specific project |
| `search_rootdata` | Search RootData for projects, investors, or ecosystems by keyword |
| `get_rootdata_project` | Detailed project profile from RootData |
| `get_rootdata_investor` | Investor profile and portfolio from RootData |

---

## Troubleshooting

**Server doesn't appear in Claude Desktop**
- Confirm the `command` path is absolute and the binary is executable.
- Check Claude Desktop logs for startup errors.

**Tool calls return errors about missing keys**
- Set `SOSOVALUE_API_KEY` in the `env` block of your config.

**Wave-2 / HTTP+SSE transport**
- Stdio is the only supported transport for Wave-1. HTTP/SSE transport with API-key auth and stateful trade tools is planned for Wave-2.
