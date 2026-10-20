# Verification — AI Capex Watch

Build verified on 2026-10-20, against data as filed on SEC EDGAR through the
quarter ended June 30, 2026 (2026 Q2). Every check below is produced by
`scripts/pull_edgar.py` on each run and stored in `data/capex.json` under
`verification`, so the live site always shows the current results.

## Check 1 — Derived quarters vs the 10-K annual fact

For each company, the four single quarters I derive (by differencing
year-to-date 10-Q figures, with Q4 = 10-K full year minus nine months) are
summed over the fiscal year and reconciled to the fiscal-year capex fact in
the company's 10-K. Tolerance: 2%.

| Company | Fiscal year | Period | Quarterly build | EDGAR 10-K fact | Difference | Status |
|---|---|---|---:|---:|---:|---|
| Microsoft (MSFT) | FY2024 | 2023-07-01 to 2024-06-30 | $44,477,000,000 | $44,477,000,000 | 0.000% | ✓ |
| Microsoft (MSFT) | FY2025 | 2024-07-01 to 2025-06-30 | $64,551,000,000 | $64,551,000,000 | 0.000% | ✓ |
| Alphabet (GOOGL) | FY2024 | 2024-01-01 to 2024-12-31 | $52,535,000,000 | $52,535,000,000 | 0.000% | ✓ |
| Alphabet (GOOGL) | FY2025 | 2025-01-01 to 2025-12-31 | $91,447,000,000 | $91,447,000,000 | 0.000% | ✓ |
| Amazon (AMZN) | FY2024 | 2024-01-01 to 2024-12-31 | $82,999,000,000 | $82,999,000,000 | 0.000% | ✓ |
| Amazon (AMZN) | FY2025 | 2025-01-01 to 2025-12-31 | $131,819,000,000 | $131,819,000,000 | 0.000% | ✓ |
| Meta (META) | FY2024 | 2024-01-01 to 2024-12-31 | $37,256,000,000 | $37,256,000,000 | 0.000% | ✓ |
| Meta (META) | FY2025 | 2025-01-01 to 2025-12-31 | $69,691,000,000 | $69,691,000,000 | 0.000% | ✓ |

Result: 8 of 8 reconciliations exact (0.000% difference).

## Check 2 — Built TTM vs Amazon's filer-tagged TTM spans (independent)

Amazon tags trailing-twelve-month capex spans directly in its 10-Q
supplements. These spans are *not* used in the derivation (only spans
starting on the fiscal-year start date are), which makes them an
independent check on the built series:

| TTM through | Quarterly build | Amazon-tagged TTM | Difference |
|---|---:|---:|---:|
| 2024-03-31 | $53.45B | $53.45B | 0.000% |
| 2024-06-30 | $59.61B | $59.61B | 0.000% |
| 2024-09-30 | $69.75B | $69.75B | 0.000% |
| 2025-03-31 | $93.09B | $93.09B | 0.000% |
| 2025-06-30 | $107.66B | $107.66B | 0.000% |
| 2025-09-30 | $120.13B | $120.13B | 0.000% |
| 2026-03-31 | $151.00B | $151.00B | 0.000% |
| 2026-06-30 | $173.03B | $173.03B | 0.000% |

Result: 8 of 8 exact.

## Check 3 — Spot checks against independently reported single quarters

- Microsoft capex, quarter ended 2024-12-31: build $15,804M — matches the
  single-quarter fact EDGAR carries for that period ($15,804M).
- Amazon capex, quarter ended 2026-06-30: build $54,208M — matches Amazon's
  directly tagged single-quarter fact ($54,208M).

## Continuity and tag-agreement checks

- All four companies produce an unbroken quarterly series, 2022 Q1–2026 Q2
  (18 quarters each); the pipeline warns on any gap and reported none.
- Where two us-gaap tags report the same period in the build window
  (2021 onward), values agree; the pipeline warns on any disagreement
  above 0.5% and reported none.
