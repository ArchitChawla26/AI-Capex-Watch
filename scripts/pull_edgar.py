#!/usr/bin/env python3
"""
AI Capex Watch - data pipeline.

Pulls quarterly capital expenditure, revenue and operating cash flow for
Microsoft, Alphabet, Amazon and Meta from the SEC EDGAR company-facts API,
derives single-quarter values from the year-to-date figures reported in
10-Q filings, computes the tracker metrics, verifies the build against the
annual (10-K) facts, and writes:

    data/capex.json          (repo copy)
    site/data/capex.json     (copy served by the website)

Pure standard library. Rerunnable:  python3 scripts/pull_edgar.py

Method in brief
---------------
Cash-flow items (capex, operating cash flow) and revenue are reported in
10-Qs as year-to-date (YTD) cumulative amounts within a fiscal year, so a
single quarter is recovered by differencing consecutive YTD values:
Q1 = Q1 YTD, Q2 = 6M - Q1, Q3 = 9M - 6M, Q4 = fiscal year (10-K) - 9M.
Standalone single-quarter facts, where a filer reports them, are used only
to fill gaps the differencing cannot cover.

Only spans that start on the company's fiscal-year start date are treated
as YTD cumulatives. This matters: Amazon also tags trailing-twelve-month
(TTM) capex spans in its 10-Q supplements - same tag, 12-month duration,
but starting mid-year. Those spans are excluded from the derivation and
used instead as an independent cross-check of the built TTM series.

Tags (us-gaap), in priority order per concept:
  capex   PaymentsToAcquirePropertyPlantAndEquipment,
          PaymentsToAcquireProductiveAssets (Amazon's current tag)
  revenue RevenueFromContractWithCustomerExcludingAssessedTax,
          Revenues, SalesRevenueNet (Alphabet reports under
          RevenueFromContract... through Q1 2025 and Revenues after;
          the pools are merged by period)
  ocf     NetCashProvidedByUsedInOperatingActivities
Where two tags report the same period, agreement is checked and the
higher-priority tag wins.
"""

import json
import time
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

USER_AGENT = "ArchitChawla Research archit.26.chawla@gmail.com"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"

ROOT = Path(__file__).resolve().parent.parent

COMPANIES = [
    {"ticker": "MSFT", "name": "Microsoft", "cik": "0000789019"},
    {"ticker": "GOOGL", "name": "Alphabet", "cik": "0001652044"},
    {"ticker": "AMZN", "name": "Amazon", "cik": "0001018724"},
    {"ticker": "META", "name": "Meta Platforms", "cik": "0001326801"},
]

CONCEPT_TAGS = {
    "capex": [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
    ],
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
    ],
    "ocf": ["NetCashProvidedByUsedInOperatingActivities"],
}

SERIES_START = "2021-01-01"      # build from 2021 so 2022 quarters have YoY
DISPLAY_FROM = "2022-03-31"      # first quarter end shown on the site
CUMULATIVE_FROM = "2023-03-31"   # cumulative capex counted from 2023 Q1
WARN_FROM = "2021-01-01"         # tag-agreement warnings only in build window


def fetch_facts(cik):
    req = urllib.request.Request(
        FACTS_URL.format(cik=cik), headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _days(start, end):
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


def _md(iso):
    d = date.fromisoformat(iso)
    return (d.month, d.day)


def _same_md(a, b):
    return a[0] == b[0] and abs(a[1] - b[1]) <= 3


def build_pool(facts, tags):
    """Merge candidate tags into {(start, end): {"val","tag","form"}}.

    Higher-priority tag wins a period; within a tag, the most recently
    filed value wins (restatements). Returns (pool, overlap_warnings,
    tags_actually_used).
    """
    pool = {}
    seen = {}
    used = set()
    for tag in tags:
        node = facts.get("us-gaap", {}).get(tag)
        if not node:
            continue
        best = {}
        for r in node.get("units", {}).get("USD", []):
            if "start" not in r:
                continue
            key = (r["start"], r["end"])
            if key not in best or r.get("filed", "") > best[key].get("filed", ""):
                best[key] = r
        for key, r in best.items():
            seen.setdefault(key, {})[tag] = r["val"]
            if key not in pool:
                pool[key] = {"val": r["val"], "tag": tag, "form": r.get("form", "")}
                used.add(tag)
    warnings = []
    for (s, e), by_tag in seen.items():
        if e < WARN_FROM or len(by_tag) < 2:
            continue
        vals = list(by_tag.values())
        hi, lo = max(vals), min(vals)
        if lo and abs(hi - lo) / lo > 0.005:
            warnings.append(
                f"tag disagreement {s}..{e}: "
                + ", ".join(f"{t}={v:,}" for t, v in by_tag.items())
            )
    return pool, warnings, sorted(used)


def fiscal_year_start_md(pool):
    """Fiscal-year start (month, day), from ~12-month spans in 10-K filings."""
    starts = Counter()
    for (s, e), rec in pool.items():
        if rec["form"].startswith("10-K") and 330 <= _days(s, e) <= 380:
            starts[_md(s)] += 1
    if not starts:
        raise ValueError("no 10-K annual span found to anchor fiscal year")
    return starts.most_common(1)[0][0]


def derive_quarters(pool, fy_md):
    """Recover single-quarter values from YTD cumulatives.

    Groups facts by period start. Groups starting on the fiscal-year start
    date are differenced; ~90-day facts from other groups (standalone
    quarters a filer reports directly) only fill gaps. Mid-year 12-month
    spans (filer-tagged TTM figures) are ignored here.
    """
    by_start = defaultdict(dict)
    for (s, e), rec in pool.items():
        by_start[s][e] = rec["val"]

    quarters = {}
    singles = {}
    for s, ends in by_start.items():
        items = sorted(
            ((e, _days(s, e), v) for e, v in ends.items()), key=lambda x: x[1]
        )
        if _same_md(_md(s), fy_md):
            prev = 0
            for e, d, v in items:
                if d <= 380:
                    quarters[e] = v - prev
                    prev = v
        else:
            for e, d, v in items:
                if d <= 100:
                    singles[e] = v
    for e, v in singles.items():
        quarters.setdefault(e, v)
    return quarters


def annual_facts(pool, fy_md):
    """{(start, end): val} for fiscal-year spans - the 10-K annual facts."""
    return {
        (s, e): rec["val"]
        for (s, e), rec in pool.items()
        if 330 <= _days(s, e) <= 380 and _same_md(_md(s), fy_md)
    }


def ttm_tagged_facts(pool, fy_md):
    """{(end): val} for filer-tagged trailing-twelve-month spans."""
    out = {}
    for (s, e), rec in pool.items():
        if 330 <= _days(s, e) <= 380 and not _same_md(_md(s), fy_md):
            if e not in out or rec["val"]:
                out[e] = rec["val"]
    return out


def quarter_label(end):
    d = date.fromisoformat(end)
    q = (d.month - 1) // 3 + 1
    return f"{d.year} Q{q}"


def compute_series(raw):
    """raw: {end: {'capex':..,'revenue':..,'ocf':..}} -> enriched list."""
    ends = sorted(raw)
    rows = []
    for e in ends:
        r = raw[e]
        rows.append(
            {
                "end": e,
                "label": quarter_label(e),
                "capex": r["capex"],
                "revenue": r["revenue"],
                "ocf": r["ocf"],
                "fcf": r["ocf"] - r["capex"],
                "capex_pct_revenue": round(100 * r["capex"] / r["revenue"], 2)
                if r["revenue"]
                else None,
            }
        )
    for i, row in enumerate(rows):
        if i >= 4:
            p = rows[i - 4]
            row["capex_yoy_pct"] = (
                round(100 * (row["capex"] - p["capex"]) / abs(p["capex"]), 1)
                if p["capex"]
                else None
            )
            row["revenue_yoy_pct"] = (
                round(100 * (row["revenue"] - p["revenue"]) / abs(p["revenue"]), 1)
                if p["revenue"]
                else None
            )
        else:
            row["capex_yoy_pct"] = None
            row["revenue_yoy_pct"] = None
        ttm = rows[max(0, i - 3) : i + 1]
        if len(ttm) == 4:
            row["ttm_capex"] = sum(x["capex"] for x in ttm)
            row["ttm_revenue"] = sum(x["revenue"] for x in ttm)
            row["ttm_ocf"] = sum(x["ocf"] for x in ttm)
            row["ttm_fcf"] = row["ttm_ocf"] - row["ttm_capex"]
            row["ttm_capex_pct_revenue"] = round(
                100 * row["ttm_capex"] / row["ttm_revenue"], 2
            )
        else:
            row["ttm_capex"] = row["ttm_revenue"] = row["ttm_ocf"] = None
            row["ttm_fcf"] = row["ttm_capex_pct_revenue"] = None
        if i >= 7 and row["ttm_capex"] is not None and rows[i - 4]["ttm_capex"]:
            prev = rows[i - 4]
            d_rev = row["ttm_revenue"] - prev["ttm_revenue"]
            d_cap = row["ttm_capex"] - prev["ttm_capex"]
            row["ttm_capex_yoy_pct"] = round(
                100 * (row["ttm_capex"] - prev["ttm_capex"]) / abs(prev["ttm_capex"]), 1
            )
            row["ttm_revenue_yoy_pct"] = round(
                100 * (row["ttm_revenue"] - prev["ttm_revenue"]) / abs(prev["ttm_revenue"]), 1
            )
            row["incremental_rev_per_capex"] = (
                round(d_rev / d_cap, 2) if d_cap > 0 else None
            )
        else:
            row["ttm_capex_yoy_pct"] = None
            row["ttm_revenue_yoy_pct"] = None
            row["incremental_rev_per_capex"] = None
    return rows


def continuity_warnings(rows):
    warns = []
    for a, b in zip(rows, rows[1:]):
        gap = (date.fromisoformat(b["end"]) - date.fromisoformat(a["end"])).days
        if not (80 <= gap <= 100):
            warns.append(f"gap between {a['label']} and {b['label']}: {gap} days")
    return warns


def main():
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    companies = {}
    verification = []
    all_warnings = []

    for co in COMPANIES:
        facts_doc = fetch_facts(co["cik"])
        facts = facts_doc["facts"]
        time.sleep(0.3)

        pools, tags_used, fy_mds = {}, {}, {}
        for concept, tags in CONCEPT_TAGS.items():
            pool, warns, used = build_pool(facts, tags)
            pools[concept] = pool
            tags_used[concept] = used
            fy_mds[concept] = fiscal_year_start_md(pool)
            all_warnings += [f"{co['ticker']} {concept}: {w}" for w in warns]
        fy_md = fy_mds["capex"]

        derived = {
            c: derive_quarters(p, fy_mds[c]) for c, p in pools.items()
        }
        ends = sorted(
            set(derived["capex"]) & set(derived["revenue"]) & set(derived["ocf"])
        )
        ends = [e for e in ends if e >= SERIES_START]
        raw = {e: {c: derived[c][e] for c in CONCEPT_TAGS} for e in ends}
        rows = compute_series(raw)
        all_warnings += [f"{co['ticker']}: {w}" for w in continuity_warnings(rows)]

        # --- verification 1: derived FY quarters vs 10-K annual capex ---
        fy_checks = []
        for (s, e), annual_val in sorted(
            annual_facts(pools["capex"], fy_md).items(), key=lambda kv: kv[0][1]
        ):
            fy_label = f"FY{date.fromisoformat(e).year}"
            if fy_label not in ("FY2024", "FY2025"):
                continue
            built = sum(q["capex"] for q in rows if s < q["end"] <= e)
            diff_pct = 100 * (built - annual_val) / annual_val if annual_val else None
            fy_checks.append(
                {
                    "fiscal_year": fy_label,
                    "period": f"{s} to {e}",
                    "build_capex": built,
                    "edgar_annual_capex": annual_val,
                    "diff_pct": round(diff_pct, 3) if diff_pct is not None else None,
                    "within_2pct": diff_pct is not None and abs(diff_pct) <= 2.0,
                }
            )

        # --- verification 2: built TTM vs filer-tagged TTM spans, if any ---
        ttm_checks = []
        by_end = {r["end"]: r for r in rows}
        for e, tagged in sorted(ttm_tagged_facts(pools["capex"], fy_md).items()):
            if e in by_end and by_end[e]["ttm_capex"] is not None and e >= "2023-12-31":
                diff_pct = 100 * (by_end[e]["ttm_capex"] - tagged) / tagged
                ttm_checks.append(
                    {
                        "quarter_end": e,
                        "build_ttm_capex": by_end[e]["ttm_capex"],
                        "filer_tagged_ttm_capex": tagged,
                        "diff_pct": round(diff_pct, 3),
                        "within_2pct": abs(diff_pct) <= 2.0,
                    }
                )
        verification.append(
            {
                "ticker": co["ticker"],
                "name": co["name"],
                "checks": fy_checks,
                "ttm_checks": ttm_checks,
            }
        )

        shown = [r for r in rows if r["end"] >= DISPLAY_FROM]
        latest = rows[-1]
        companies[co["ticker"]] = {
            "name": co["name"],
            "cik": co["cik"],
            "tags_used": tags_used,
            "quarters": shown,
            "cumulative_capex_since_2023": sum(
                r["capex"] for r in rows if r["end"] >= CUMULATIVE_FROM
            ),
            "latest": {
                "label": latest["label"],
                "end": latest["end"],
                "ttm_capex": latest["ttm_capex"],
                "ttm_revenue": latest["ttm_revenue"],
                "ttm_capex_pct_revenue": latest["ttm_capex_pct_revenue"],
                "ttm_capex_yoy_pct": latest["ttm_capex_yoy_pct"],
                "ttm_revenue_yoy_pct": latest["ttm_revenue_yoy_pct"],
                "ttm_fcf": latest["ttm_fcf"],
                "incremental_rev_per_capex": latest["incremental_rev_per_capex"],
            },
        }
        print(
            f"{co['ticker']}: {len(shown)} quarters {shown[0]['label']}..{shown[-1]['label']} | "
            f"TTM capex ${latest['ttm_capex']/1e9:,.1f}B | "
            f"capex/rev {latest['ttm_capex_pct_revenue']}% | "
            f"cum since 2023 ${companies[co['ticker']]['cumulative_capex_since_2023']/1e9:,.1f}B"
        )

    # --- combined series over quarters present for all four companies ---
    common = None
    for co in COMPANIES:
        ends = {r["end"] for r in companies[co["ticker"]]["quarters"]}
        common = ends if common is None else (common & ends)
    combined_raw = {}
    for e in sorted(common):
        combined_raw[e] = {
            c: sum(
                next(
                    r[c]
                    for r in companies[co["ticker"]]["quarters"]
                    if r["end"] == e
                )
                for co in COMPANIES
            )
            for c in ("capex", "revenue", "ocf")
        }
    combined_rows = compute_series(combined_raw)
    cl = combined_rows[-1]
    combined = {
        "quarters": combined_rows,
        "cumulative_capex_since_2023": sum(
            r["capex"] for r in combined_rows if r["end"] >= CUMULATIVE_FROM
        ),
        "latest": {
            "label": cl["label"],
            "end": cl["end"],
            "ttm_capex": cl["ttm_capex"],
            "ttm_revenue": cl["ttm_revenue"],
            "ttm_capex_pct_revenue": cl["ttm_capex_pct_revenue"],
            "ttm_capex_yoy_pct": cl["ttm_capex_yoy_pct"],
            "ttm_revenue_yoy_pct": cl["ttm_revenue_yoy_pct"],
            "ttm_fcf": cl["ttm_fcf"],
            "incremental_rev_per_capex": cl["incremental_rev_per_capex"],
        },
    }
    print(
        f"COMBINED: TTM capex ${cl['ttm_capex']/1e9:,.1f}B | capex/rev "
        f"{cl['ttm_capex_pct_revenue']}% | cum since 2023 "
        f"${combined['cumulative_capex_since_2023']/1e9:,.1f}B | latest {cl['label']}"
    )

    out = {
        "meta": {
            "title": "AI Capex Watch",
            "author": "Archit Chawla",
            "generated_at": generated,
            "source": "SEC EDGAR company facts API (data.sec.gov)",
            "companies": [c["ticker"] for c in COMPANIES],
            "latest_quarter": cl["label"],
            "latest_quarter_end": cl["end"],
            "display_from": "2022 Q1",
            "cumulative_from": "2023 Q1",
        },
        "combined": combined,
        "companies": companies,
        "verification": verification,
        "warnings": all_warnings,
    }

    payload = json.dumps(out, indent=1)
    for path in (ROOT / "data" / "capex.json", ROOT / "site" / "data" / "capex.json"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload)
        print("wrote", path)

    print("\n--- verification 1: build vs EDGAR 10-K annual capex ---")
    for v in verification:
        for chk in v["checks"]:
            print(
                f"{v['ticker']} {chk['fiscal_year']}: build ${chk['build_capex']/1e9:,.2f}B "
                f"vs EDGAR ${chk['edgar_annual_capex']/1e9:,.2f}B "
                f"diff {chk['diff_pct']}% within2={chk['within_2pct']}"
            )
        for chk in v["ttm_checks"]:
            print(
                f"{v['ticker']} TTM {chk['quarter_end']}: build ${chk['build_ttm_capex']/1e9:,.2f}B "
                f"vs filer-tagged ${chk['filer_tagged_ttm_capex']/1e9:,.2f}B "
                f"diff {chk['diff_pct']}% within2={chk['within_2pct']}"
            )
    if all_warnings:
        print("\n--- warnings ---")
        for w in all_warnings:
            print(" ", w)
    else:
        print("\nno warnings")


if __name__ == "__main__":
    main()
