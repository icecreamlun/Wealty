<div align="center">

# Wealty

**A wealth tool that respects your skepticism instead of trying to overcome it.**

Live market data is the source of truth. The AI plan has to cite it.

<sub>ETF & equity quotes via Yahoo Finance · U.S. Treasury yields via fiscaldata.treasury.gov · reasoning via [Manus](https://manus.im)</sub>

<br />

![Wealty hero — live ticker tape, gold serif wordmark, ETF table with sparklines](docs/hero.png)

</div>

---

## Who this is for

The senior engineer with $300k–$2M scattered across a checking account, a brokerage, and an employer-stock concentration they've been meaning to diversify for two years. Smart, numerate, time-poor — and structurally allergic to financial advice.

They don't pay 1% AUM to be told to buy VTI. They don't trust black-box robo-advisors. They watched FTX and Terra blow up other people's money. Their default is **trust no one, verify everything, leave it in the HYSA**.

There are plenty of tools for people who want to be told what to do. **Wealty is for people who want to verify a plan against the raw numbers themselves before they touch a button.**

## What it does

A single page. Three live tables on top — these are the source of truth, not the AI:

| Table | Columns | Source |
| --- | --- | --- |
| ETF universe (12 holdings) | price, 1d %, 1mo %, 52w range | Yahoo Finance |
| Single-stock universe (10 large caps) | price, 1d %, 1mo %, 52w range | Yahoo Finance |
| U.S. Treasury yields | avg interest rate by security type | Treasury Fiscal Data API |

Every table links its source underneath. No proprietary scoring. No "Wealty Index." Just numbers and where they came from.

You enter four inputs — **capital · risk (1–5) · target return % · horizon** — and the backend snapshots that exact dataset, embeds it into a structured prompt, and asks Manus to return a Markdown plan with:

- A dollar-denominated allocation table that must sum to 100% / total capital
- A per-line rationale that **cites the trends and yields shown above**
- Three concrete risks specific to *this* allocation
- A rebalancing rule with a trigger
- A **realism check**: is your target reachable given today's yields?

Then there's a `View raw prompt` toggle. Click it and you see the literal text the AI received. **No hidden context, no system-prompt magic, no upsell.** If a paranoid user wants to paste that prompt into Claude or GPT and compare answers, that's a feature.

## Design principles

1. **Auditable, not authoritative.** The plan is a hypothesis the user grades against the tables next to it. We never say "trust us."
2. **Constrained AI.** Manus can only recommend tickers from the on-screen universe. No leverage, no shitcoins, no structured products. The blast radius of an AI hallucination is bounded by the table.
3. **No fee narrative.** No AUM, no premium tier, no managed accounts. The economics aren't aligned with selling you anything.
4. **Engineer-coded UX.** Dark mode, monospace numbers, no stock photos, no testimonials. It looks like a dashboard, not a landing page.

## Quickstart

```bash
git clone https://github.com/icecreamlun/Wealty.git
cd Wealty
npm install

# 1. get a Manus API key at https://manus.im
# 2. drop it in .env (gitignored)
cp .env.example .env
$EDITOR .env

node --env-file=.env server.js
# open http://localhost:3000
```

`MANUS_API_KEY` is **required** — the server refuses to start without it. No fallback key, no shared demo key, nothing baked in. Bring your own.

## Architecture

```
┌────────────────────────────┐         ┌──────────────────────────────┐
│  public/index.html         │         │  server.js (Express)         │
│  ─ source-of-truth tables  │ ──GET── │  /api/market                 │
│  ─ user inputs form        │         │    ├─ Yahoo Finance (12 ETF) │
│  ─ Markdown plan renderer  │         │    ├─ Yahoo Finance (10 stk)│
│  ─ "View raw prompt"       │ ──POST─ │  /api/plan                   │
│                            │         │    ├─ snapshot market data   │
└────────────────────────────┘         │    ├─ build constrained      │
                                       │    │   prompt                │
                                       │    ├─ POST Manus /v1/tasks   │
                                       │    └─ poll until completed   │
                                       └──────────────────────────────┘
```

## API reference

#### `GET /api/market`

Returns a snapshot of every table on the page.

```json
{
  "asOf": "2026-04-26T01:42:25Z",
  "etfs":   [{ "sym": "SPY", "price": 713.94, "dayChangePct": 0.77, "monthChangePct": 8.7, "...": "..." }],
  "stocks": [{ "sym": "AAPL", "...": "..." }],
  "treasury": {
    "asOf": "2026-03-31",
    "rows": [{ "security": "Treasury Bills", "ratePct": 3.702 }, "..."]
  }
}
```

#### `POST /api/plan`

Generates an allocation plan from current market data.

```bash
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{
    "capital": 100000,
    "currency": "USD",
    "risk": 3,
    "expectedReturn": 8,
    "horizonYears": 10
  }'
```

Response includes the assistant's Markdown text, the Manus `task_url` (so you can audit the run), and **the full prompt that was sent** — because if we won't show our work, why should you trust the answer?

## Manus integration notes

For anyone else integrating Manus, here's what we learned the hard way:

| | |
| --- | --- |
| Base URL  | `https://api.manus.im/v1` |
| Auth header | `x-manus-api-key: <key>` *(not `Authorization: Bearer`, which is JWT-only)* |
| Create task | `POST /v1/tasks` body `{"prompt": "..."}` → `{ task_id, task_url }` |
| Poll | `GET /v1/tasks/{id}` until `status === "completed"` |
| Read output | last item in `output[]` where `role === "assistant"`, then `content[0].text` |
| Latency | ~30–90s per task |

## Data sources

| What | Endpoint | Auth |
| --- | --- | --- |
| ETF / stock quotes | `query1.finance.yahoo.com/v8/finance/chart/{symbol}` | none |
| Treasury avg interest rates | `api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates` | none |
| AI reasoning | `api.manus.im/v1/tasks` | `x-manus-api-key` |

## Roadmap

- **Plaid read-only integration** — so the plan accounts for your actual current holdings (especially the RSU concentration)
- **Per-bank deposit & CD rate feed** — FRED + an FDIC adapter, so "you're earning 0.01% in Chase, the market pays 4.2%" becomes a one-line callout
- **Tax-lot aware rebalancing** for taxable accounts
- **Diff view** — "here's what changed in your plan this week, and which underlying number drove it"
- **FX-aware allocations** for non-USD users

## Project layout

```
Wealty/
├─ server.js              # Express server: market data + Manus proxy
├─ public/
│  └─ index.html          # single-file frontend (no build step)
├─ package.json
└─ README.md
```

## License

MIT.

<div align="center">
<sub>Built for engineers who read 10-Ks for fun.</sub>
</div>
