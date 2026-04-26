# Personal Allocator — live market data + AI plan

A one-page tool: live ETF / equity quotes (Yahoo Finance) + U.S. Treasury yields
(Treasury Fiscal Data) form the **source of truth**, and Manus generates a
risk-calibrated allocation plan that must justify itself against those tables.

## Run

```bash
node server.js
# open http://localhost:3000
```

`MANUS_API_KEY` is read from env if set; the provided key is the default.

## Endpoints

- `GET  /api/market` — live ETF + stock quotes + Treasury avg interest rates
- `POST /api/plan`   — body `{ capital, currency, risk(1-5), expectedReturn, horizonYears }`
                      → builds a prompt embedding live data, calls Manus
                      `POST /v1/tasks`, polls `GET /v1/tasks/{id}` until
                      `completed`, returns the assistant text.

## Data sources

| What | Where |
| --- | --- |
| ETF / stock quotes (price, 1d, 1mo, 52w range) | `query1.finance.yahoo.com/v8/finance/chart/{symbol}` |
| Treasury avg interest rates | `api.fiscaldata.treasury.gov` (Average Interest Rates dataset) |
| AI plan generation | Manus `https://api.manus.im/v1/tasks` (header `x-manus-api-key`) |

## If rates need to be from individual banks

The tool currently uses **Treasury yields** as the rate benchmark (a hard,
free, official source). For per-bank deposit / CD rates, FDIC's RateBoard
or commercial APIs (Bankrate, Wise, FRED with deposit series) require
keys — say the word and we'll wire those in.
