import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MANUS_KEY = process.env.MANUS_API_KEY || '***REMOVED-MANUS-KEY***';
const MANUS_BASE = 'https://api.manus.im/v1';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ETFS = [
  { sym: 'SPY',  name: 'SPDR S&P 500',           bucket: 'US Equity (Large Cap)' },
  { sym: 'QQQ',  name: 'Invesco QQQ (Nasdaq-100)', bucket: 'US Equity (Tech)' },
  { sym: 'VTI',  name: 'Vanguard Total US Market', bucket: 'US Equity (Broad)' },
  { sym: 'VXUS', name: 'Vanguard Total Intl Stock', bucket: 'Intl Equity' },
  { sym: 'AGG',  name: 'iShares Core US Aggregate Bond', bucket: 'US Bonds' },
  { sym: 'BND',  name: 'Vanguard Total Bond Market',     bucket: 'US Bonds' },
  { sym: 'TLT',  name: 'iShares 20+ Year Treasury',      bucket: 'Long Duration Treasury' },
  { sym: 'IEF',  name: 'iShares 7-10 Year Treasury',     bucket: 'Mid Duration Treasury' },
  { sym: 'SHY',  name: 'iShares 1-3 Year Treasury',      bucket: 'Short Duration Treasury' },
  { sym: 'HYG',  name: 'iShares High Yield Corp',        bucket: 'High Yield' },
  { sym: 'VNQ',  name: 'Vanguard Real Estate',           bucket: 'REIT' },
  { sym: 'GLD',  name: 'SPDR Gold Shares',               bucket: 'Commodities' },
];

const STOCKS = [
  { sym: 'AAPL',  name: 'Apple' },
  { sym: 'MSFT',  name: 'Microsoft' },
  { sym: 'NVDA',  name: 'NVIDIA' },
  { sym: 'GOOGL', name: 'Alphabet' },
  { sym: 'AMZN',  name: 'Amazon' },
  { sym: 'META',  name: 'Meta Platforms' },
  { sym: 'TSLA',  name: 'Tesla' },
  { sym: 'BRK-B', name: 'Berkshire Hathaway' },
  { sym: 'JPM',   name: 'JPMorgan Chase' },
  { sym: 'JNJ',   name: 'Johnson & Johnson' },
];

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Yahoo ${symbol}: ${r.status}`);
  const j = await r.json();
  const m = j?.chart?.result?.[0]?.meta;
  if (!m) throw new Error(`Yahoo ${symbol}: no meta`);
  const closes = (j.chart.result[0].indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  const first = closes[0];
  const last = m.regularMarketPrice ?? closes[closes.length - 1];
  const prevDay = closes.length >= 2 ? closes[closes.length - 2] : m.chartPreviousClose;
  const monthChange = first ? ((last - first) / first) * 100 : null;
  return {
    symbol,
    price: last,
    currency: m.currency,
    prevClose: prevDay,
    dayChangePct: prevDay ? ((last - prevDay) / prevDay) * 100 : null,
    monthChangePct: monthChange,
    fiftyTwoWeekHigh: m.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: m.fiftyTwoWeekLow,
    longName: m.longName || m.shortName,
    asOf: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
  };
}

async function fetchAll(list) {
  const results = await Promise.allSettled(list.map((x) => fetchYahooQuote(x.sym)));
  return list.map((x, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') return { ...x, ...r.value, ok: true };
    return { ...x, ok: false, error: String(r.reason).slice(0, 120) };
  });
}

async function fetchTreasuryRates() {
  const url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page%5Bsize%5D=40';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Treasury: ${r.status}`);
  const j = await r.json();
  const latestDate = j.data?.[0]?.record_date;
  const rows = (j.data || []).filter((d) => d.record_date === latestDate);
  return {
    asOf: latestDate,
    source: 'U.S. Treasury Fiscal Data — Average Interest Rates on U.S. Treasury Securities',
    sourceUrl: 'https://fiscaldata.treasury.gov/datasets/average-interest-rates-treasury-securities/',
    rows: rows.map((d) => ({
      type: d.security_type_desc,
      security: d.security_desc,
      ratePct: parseFloat(d.avg_interest_rate_amt),
    })),
  };
}

app.get('/api/market', async (_req, res) => {
  try {
    const [etfs, stocks, treasury] = await Promise.all([
      fetchAll(ETFS),
      fetchAll(STOCKS),
      fetchTreasuryRates().catch((e) => ({ error: String(e), rows: [] })),
    ]);
    res.json({
      asOf: new Date().toISOString(),
      etfs,
      stocks,
      treasury,
      sources: {
        equities: 'Yahoo Finance (query1.finance.yahoo.com)',
        rates: treasury.sourceUrl || 'fiscaldata.treasury.gov',
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

function buildPrompt({ risk, capital, currency, expectedReturn, horizonYears }, market) {
  const fmtPct = (x) => (x == null ? 'n/a' : `${x.toFixed(2)}%`);
  const etfTable = market.etfs
    .filter((e) => e.ok)
    .map((e) => `${e.sym} | ${e.name} | ${e.bucket} | $${e.price?.toFixed(2)} | 1d ${fmtPct(e.dayChangePct)} | 1mo ${fmtPct(e.monthChangePct)}`)
    .join('\n');
  const stockTable = market.stocks
    .filter((s) => s.ok)
    .map((s) => `${s.sym} | ${s.name} | $${s.price?.toFixed(2)} | 1d ${fmtPct(s.dayChangePct)} | 1mo ${fmtPct(s.monthChangePct)}`)
    .join('\n');
  const rateTable = (market.treasury.rows || [])
    .map((r) => `${r.security} (${r.type}) | ${r.ratePct.toFixed(3)}%`)
    .join('\n');

  return `You are a portfolio strategist. Build an actionable allocation plan for the user.

USER PROFILE
- Investable capital: ${capital} ${currency}
- Risk tolerance: ${risk} (1=very conservative, 5=very aggressive)
- Target annual return: ${expectedReturn}%
- Horizon: ${horizonYears} years

LIVE MARKET DATA (as of ${market.asOf}) — use ONLY these instruments and rates:

ETF universe:
SYM | Name | Bucket | Price | 1d% | 1mo%
${etfTable}

Stock universe:
SYM | Name | Price | 1d% | 1mo%
${stockTable}

U.S. Treasury yields (avg interest rate, ${market.treasury.asOf}):
${rateTable}

DELIVERABLES — return clean Markdown with these sections in order:
1. **Summary** — 2-3 sentences calibrating risk vs target.
2. **Allocation Table** — a Markdown table with columns: Asset Class | Ticker | % | $ Amount. Percentages must total 100%. $ amounts must total ${capital} ${currency}.
3. **Rationale** — bullet list, one bullet per holding, citing the data above (e.g. its 1mo trend or yield).
4. **Risks** — 3 bullets specific to this allocation.
5. **Rebalancing** — one paragraph: cadence + triggers.
6. **Realism check** — does the target return match the risk profile given current yields? Be honest.

Constraints:
- Only use tickers from the lists above.
- Risk 1-2: tilt to bonds + cash-like (SHY, BND, AGG). Risk 4-5: tilt to equities (SPY, QQQ, VTI) and 1-2 single stocks.
- Do not recommend leverage, options, or instruments not in the lists.
- Keep total response under 700 words.`;
}

async function callManus(prompt) {
  const create = await fetch(`${MANUS_BASE}/tasks`, {
    method: 'POST',
    headers: { 'x-manus-api-key': MANUS_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!create.ok) {
    const text = await create.text();
    throw new Error(`Manus create failed ${create.status}: ${text}`);
  }
  const { task_id, task_url } = await create.json();
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const g = await fetch(`${MANUS_BASE}/tasks/${task_id}`, {
      headers: { 'x-manus-api-key': MANUS_KEY },
    });
    if (!g.ok) continue;
    const j = await g.json();
    if (j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') {
      const assistant = (j.output || []).filter((o) => o.role === 'assistant').pop();
      const text = assistant?.content?.map((c) => c.text).join('\n').trim() || '';
      return { task_id, task_url, status: j.status, text, raw: j };
    }
  }
  return { task_id, task_url, status: 'timeout', text: '(Manus task did not finish in 5 minutes — check task_url)' };
}

app.post('/api/plan', async (req, res) => {
  try {
    const { risk, capital, currency = 'USD', expectedReturn, horizonYears = 10 } = req.body || {};
    if (!risk || !capital || !expectedReturn) {
      return res.status(400).json({ error: 'risk, capital, expectedReturn required' });
    }
    const marketResp = await fetch(`http://localhost:${PORT}/api/market`);
    const market = await marketResp.json();
    const prompt = buildPrompt({ risk, capital, currency, expectedReturn, horizonYears }, market);
    const result = await callManus(prompt);
    res.json({ ...result, prompt, market });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`Fintech advisor running on http://localhost:${PORT}`));
