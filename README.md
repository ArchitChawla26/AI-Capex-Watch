# AI Capex Watch

**By Archit Chawla** · Live site: https://architchawla26.github.io/AI-Capex-Watch/

## The question

Microsoft, Alphabet, Amazon and Meta are spending at a historic rate on AI
infrastructure. This tracker asks one question of their own SEC filings:
**is the capital expenditure converting into revenue?**

Every figure comes from EDGAR — no estimates, no data vendor. The site
updates itself weekly from new filings.

## Headline numbers (through quarter ended June 30, 2026)

| Company | TTM capex | Capex / revenue (TTM) | Cumulative capex since 2023 |
|---|---:|---:|---:|
| Microsoft | $115.9B | 34.9% | $240.5B |
| Alphabet | $132.4B | 29.7% | $256.8B |
| Amazon | $173.0B | 22.3% | $366.0B |
| Meta | $89.3B | 39.1% | $183.1B |
| **Combined** | **$510.7B** | **28.7%** | **$1,046.4B** |

Combined TTM capex is growing +75.3% year over year against revenue growth
of +18.6%. The tracker's conversion measure — incremental TTM revenue per
incremental TTM capex dollar — stands at 1.27, down from 2.09 at the end of
2024: still converting, with a thinning margin.

## Method

- **Source:** SEC EDGAR company facts API (data.sec.gov), from each
  company's 10-Q and 10-K filings. CIKs: MSFT 0000789019, GOOGL 0001652044,
  AMZN 0001018724, META 0001326801.
- **Tags (us-gaap):** capex — `PaymentsToAcquirePropertyPlantAndEquipment`
  (Amazon: `PaymentsToAcquireProductiveAssets`, its current tag); revenue —
  `RevenueFromContractWithCustomerExcludingAssessedTax` with `Revenues` /
  `SalesRevenueNet` fallbacks, merged by period (Alphabet switched tags in
  2025); operating cash flow — `NetCashProvidedByUsedInOperatingActivities`.
- **Single quarters from year-to-date filings:** cash-flow items in 10-Qs
  are cumulative year-to-date, so single quarters are recovered by
  differencing consecutive YTD values within the fiscal year (Q1 = Q1 YTD;
  Q2 = 6M − Q1; Q3 = 9M − 6M; Q4 = 10-K full year − 9M). Only spans
  starting on the fiscal-year start date are treated as cumulatives —
  Amazon also tags trailing-twelve-month spans in its 10-Qs, which are
  excluded from the derivation and used as a cross-check.
- **Derived metrics:** capex % of revenue, YoY growth (quarterly and TTM),
  free cash flow after capex (operating cash flow − capex), cumulative
  capex since 2023 Q1, and incremental revenue per incremental capex dollar
  (TTM revenue change YoY ÷ TTM capex change YoY).

## Verification

The build is reconciled two ways on every run (see `VERIFICATION.md`):
the sum of derived quarters for FY2024 and FY2025 matches each company's
10-K annual capex fact exactly (8 of 8, 0.000% difference), and the built
TTM series matches all 8 of Amazon's filer-tagged TTM spans exactly.

## Rerun it

```bash
python3 scripts/pull_edgar.py   # stdlib only; writes data/capex.json + site/data/capex.json
```

In production, `.github/workflows/refresh.yml` runs the same script every
Wednesday, commits the new data and redeploys the site in the same run.
`.github/workflows/pages.yml` deploys on site changes.

## Limitations

- **Capex is total purchases of property and equipment, not AI-only
  spend.** The filings do not split capex into AI and non-AI; data centers
  dominate recent growth, but warehouses, offices and other assets are
  included. This is the key limitation of any tracker built on filed data.
- Capex is cash capex: assets acquired under finance leases are excluded,
  so figures run below the "capex including finance leases" numbers some
  companies quote (e.g. Meta 2024: $37.3B here vs $39.2B quoted).
- Revenue is total company revenue, not AI/cloud segment revenue, so the
  conversion ratios are directional evidence, not AI-segment returns —
  Amazon's ratio is flattered by its retail base.
- Capex leads revenue by construction and installation lags; the tracker
  therefore judges the trend, not a single quarter.

## Disclaimer

Independent research published for education. Not investment advice, a
recommendation, or an offer to buy or sell any security.
