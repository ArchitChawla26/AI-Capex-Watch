"use strict";

/* ---------- formatting helpers ---------- */
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmtB(v, dp = 1) {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(dp) + "B";
  return "$" + (v / 1e6).toFixed(0) + "M";
}
function fmtPct(v, dp = 1, signed = false) {
  if (v === null || v === undefined) return "—";
  const s = signed && v > 0 ? "+" : "";
  return s + v.toFixed(dp) + "%";
}
function fmtRatio(v) {
  if (v === null || v === undefined) return "—";
  return v.toFixed(2);
}
function niceMax(v) {
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const s of steps) if (v <= s * pow) return s * pow;
  return 10 * pow;
}
function shortLabel(label) {
  const [y, q] = label.split(" ");
  return q + "\u2019" + y.slice(2);
}
function longDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

/* ---------- SVG combo chart: bars + line, dual axis ---------- */
function comboChart(rows, barKey, lineKey, barTitle, lineTitle, lineFmt) {
  const W = 760, H = 320, ml = 58, mr = 58, mt = 26, mb = 36;
  const pw = W - ml - mr, ph = H - mt - mb;
  const n = rows.length;
  const band = pw / n;
  const barW = Math.min(30, band * 0.6);
  const bMax = niceMax(Math.max(...rows.map(r => r[barKey])) * 1.08);
  const lVals = rows.map(r => r[lineKey]).filter(v => v !== null && v !== undefined);
  const lMax = niceMax(Math.max(...lVals) * 1.15);
  const bx = i => ml + band * i + band / 2;
  const by = v => mt + ph - (v / bMax) * ph;
  const ly = v => mt + ph - (v / lMax) * ph;

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="chart">`;
  for (let g = 0; g <= 4; g++) {
    const y = mt + (ph / 4) * g;
    const bv = bMax * (1 - g / 4), lv = lMax * (1 - g / 4);
    s += `<line class="grid-line" x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}"/>`;
    s += `<text class="axis-lbl" x="${ml - 8}" y="${y + 4}" text-anchor="end">${(bv / 1e9).toFixed(0)}</text>`;
    s += `<text class="axis-lbl" x="${W - mr + 8}" y="${y + 4}">${lineFmt(lv)}</text>`;
  }
  s += `<text class="axis-title" x="${ml}" y="14">${barTitle}</text>`;
  s += `<text class="axis-title" x="${W - mr}" y="14" text-anchor="end">${lineTitle}</text>`;
  rows.forEach((r, i) => {
    const h = (r[barKey] / bMax) * ph;
    s += `<rect x="${(bx(i) - barW / 2).toFixed(1)}" y="${(mt + ph - h).toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="2.5" fill="#2456d6" opacity="${i === n - 1 ? "1" : "0.82"}"><title>${r.label}: ${fmtB(r[barKey])}</title></rect>`;
    s += `<text class="axis-lbl" x="${bx(i)}" y="${H - 18}" text-anchor="middle">${shortLabel(r.label)}</text>`;
  });
  const pts = rows.map((r, i) => (r[lineKey] === null || r[lineKey] === undefined) ? null : [bx(i), ly(r[lineKey])]).filter(Boolean);
  if (pts.length > 1) {
    s += `<polyline points="${pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}" fill="none" stroke="#d97706" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p, i) => {
      s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="#d97706"><title>${rows[i].label}: ${lineFmt(rows[i][lineKey])}</title></circle>`;
    });
  }
  s += "</svg>";
  return s;
}

/* ---------- analysis, in the author's voice, built from the data ---------- */
function buildAnalysis(d) {
  const rows = d.combined.quarters;
  const L = d.combined.latest;
  const li = rows.length - 1;
  const yearAgo = rows[li - 4];
  const fiveAgo = rows[li - 5];
  const spreadNow = Math.round((L.ttm_capex_yoy_pct - L.ttm_revenue_yoy_pct) * 10) / 10;
  const spreadAgo = Math.round((yearAgo.ttm_capex_yoy_pct - yearAgo.ttm_revenue_yoy_pct) * 10) / 10;
  const dRev = L.ttm_revenue - yearAgo.ttm_revenue;
  const dCap = L.ttm_capex - yearAgo.ttm_capex;
  const ratioPath = rows.filter(r => r.incremental_rev_per_capex !== null);
  const ref2024 = ratioPath.find(r => r.label.endsWith("2024 Q4")) || ratioPath[Math.max(0, ratioPath.length - 7)];
  const sinceRef = ratioPath.slice(ratioPath.indexOf(ref2024));
  const fellEvery = sinceRef.every((r, i) => i === 0 || r.incremental_rev_per_capex <= sinceRef[i - 1].incremental_rev_per_capex + 1e-9);
  const fcfThen = ratioPath[0];
  const fcfDrop = Math.round(100 * (fcfThen.ttm_fcf - L.ttm_fcf) / fcfThen.ttm_fcf);
  const ttmOcf = L.ttm_fcf + L.ttm_capex;
  const cumStr = fmtB(d.combined.cumulative_capex_since_2023);
  const cumVerb = d.combined.cumulative_capex_since_2023 >= 1e12 ? "has crossed" : "stands at";

  const cos = Object.entries(d.companies).map(([t, co]) => ({
    ticker: t, name: co.name, latest: co.latest,
    cum: co.cumulative_capex_since_2023,
    lastQ: co.quarters[co.quarters.length - 1],
  }));
  const byIntensity = [...cos].sort((a, b) => b.latest.ttm_capex_pct_revenue - a.latest.ttm_capex_pct_revenue);
  const byRatio = [...cos].sort((a, b) => (b.latest.incremental_rev_per_capex ?? -9) - (a.latest.incremental_rev_per_capex ?? -9));
  const byGrowth = [...cos].sort((a, b) => b.latest.ttm_capex_yoy_pct - a.latest.ttm_capex_yoy_pct);
  const belowOne = cos.filter(c => c.latest.incremental_rev_per_capex !== null && c.latest.incremental_rev_per_capex < 1);
  const negFcf = cos.filter(c => c.latest.ttm_fcf < 0);
  const top = byIntensity[0], best = byRatio[0], fastest = byGrowth[0];

  let companyPara = `The burden is not evenly shared. <strong>${top.name} (${top.ticker})</strong> carries the highest capex intensity: capex is <strong>${fmtPct(top.latest.ttm_capex_pct_revenue)} of TTM revenue</strong>, and in the latest quarter alone it reached <strong>${fmtPct(top.lastQ.capex_pct_revenue)} of quarterly revenue</strong>. `;
  if (belowOne.length === 1) {
    const b = belowOne[0];
    companyPara += `<strong>${b.name}</strong> is the only one of the four whose incremental ratio has slipped below 1.0 (<strong>${fmtRatio(b.latest.incremental_rev_per_capex)}</strong>) — its last year of spending added more capex dollars than revenue dollars. `;
  } else if (belowOne.length === 0) {
    companyPara += `No company has slipped below a 1.0 incremental ratio yet. `;
  } else {
    companyPara += `<strong>${belowOne.map(b => b.name).join(" and ")}</strong> have slipped below a 1.0 incremental ratio. `;
  }
  companyPara += `<strong>${best.name}</strong> posts the strongest ratio at <strong>${fmtRatio(best.latest.incremental_rev_per_capex)}</strong>`;
  if (best.ticker === "AMZN") companyPara += `, though its revenue base is mostly retail rather than cloud, which flatters the comparison`;
  companyPara += `. <strong>${fastest.name}</strong> is growing capex fastest, at <strong>${fmtPct(fastest.latest.ttm_capex_yoy_pct, 1, true)}</strong> year over year. `;
  if (negFcf.length === 1) {
    const nf = negFcf[0];
    companyPara += `And <strong>${nf.name}</strong> is the only one spending beyond its own operating cash flow: TTM free cash flow after capex is <strong>${fmtB(nf.latest.ttm_fcf)}</strong>.`;
  } else if (negFcf.length > 1) {
    companyPara += `<strong>${negFcf.map(c => c.name).join(" and ")}</strong> are each spending beyond their operating cash flow on a TTM basis.`;
  }

  const paras = [
    `The four hyperscalers are now spending at a run rate of <strong>${fmtB(L.ttm_capex)} a year</strong> on property and equipment. Trailing-twelve-month capex is up <strong>${fmtPct(L.ttm_capex_yoy_pct)}</strong> year over year, against revenue growth of <strong>${fmtPct(L.ttm_revenue_yoy_pct)}</strong> — a <strong>${spreadNow.toFixed(0)}-point growth spread</strong>, versus ${spreadAgo.toFixed(0)} points a year ago. Cumulative capex since the start of 2023 ${cumVerb} <strong>${cumStr}</strong>. On the spending side, the filed numbers show no slowdown yet.`,
    `My conversion test is incremental revenue per incremental capex dollar: the TTM revenue the group added over the last year, divided by the TTM capex it added. The latest reading is <strong>${fmtRatio(L.incremental_rev_per_capex)}</strong> — the last four quarters added <strong>${fmtB(dRev, 0)}</strong> of revenue against <strong>${fmtB(dCap, 0)}</strong> of added capex. That is still above 1.0, so in dollar terms revenue is still out-adding capex. But the cushion is thinning on a clean trend: the ratio was <strong>${fmtRatio(ref2024.incremental_rev_per_capex)}</strong> at the end of 2024 and has ${fellEvery ? "fallen every quarter since" : "trended down since"}. Revenue growth is genuinely accelerating — from <strong>${fmtPct(fiveAgo.ttm_revenue_yoy_pct)}</strong> five quarters ago to <strong>${fmtPct(L.ttm_revenue_yoy_pct)}</strong> now — it is simply not accelerating as fast as the spending.`,
    companyPara,
    `The cost is visible in cash generation. Combined free cash flow after capex has fallen from <strong>${fmtB(fcfThen.ttm_fcf, 0)}</strong> in the twelve months to ${fcfThen.label} to <strong>${fmtB(L.ttm_fcf, 0)}</strong> now — down <strong>${fcfDrop}%</strong> — even though combined operating cash flow is still a formidable <strong>${fmtB(ttmOcf, 0)}</strong> TTM. These are not companies in funding trouble. They are companies pre-committing a rising share of an enormous cash engine to capacity whose revenue has to arrive later.`,
    `My read: the build-out is converting, but the margin for disappointment narrows every quarter. The number that decides it is the spread. If revenue growth keeps climbing toward the capex growth rate, the incremental ratio stabilizes above 1.0 and this tracker turns boring. If capex growth re-accelerates, or revenue growth stalls first, the ratio crosses below 1.0 and the overbuild case stops being a talking point and becomes arithmetic. This page refreshes weekly from new SEC filings; the verdict updates with the data.`,
  ];
  return paras;
}

/* ---------- render ---------- */
async function main() {
  const d = await (await fetch("data/capex.json")).json();
  const L = d.combined.latest;

  document.getElementById("asof-line").textContent =
    "Data through quarter ended " + longDate(L.end) + " (" + L.label + ")";
  document.getElementById("stat-ttm-capex").innerHTML = fmtB(L.ttm_capex);
  document.getElementById("stat-spread").innerHTML =
    fmtPct(L.ttm_capex_yoy_pct, 0, true) + " <small>vs</small> " + fmtPct(L.ttm_revenue_yoy_pct, 0, true);
  document.getElementById("stat-intensity").textContent = fmtPct(L.ttm_capex_pct_revenue);
  document.getElementById("stat-cum").textContent = fmtB(d.combined.cumulative_capex_since_2023);
  document.getElementById("stat-incr").textContent = fmtRatio(L.incremental_rev_per_capex);

  const chip = document.getElementById("verdict-chip");
  const ratio = L.incremental_rev_per_capex;
  if (ratio !== null && ratio >= 2) { chip.textContent = "Converting"; chip.classList.add("good"); }
  else if (ratio !== null && ratio >= 1) { chip.textContent = "Converting — margin thinning"; }
  else { chip.textContent = "Not converting yet"; chip.classList.add("bad"); }

  document.getElementById("combined-chart").innerHTML =
    comboChart(d.combined.quarters, "capex", "revenue", "CAPEX, $B / QUARTER", "REVENUE, $B / QUARTER", v => "$" + (v / 1e9).toFixed(0) + "B");

  /* scorecard */
  const order = ["MSFT", "GOOGL", "AMZN", "META"];
  let body = "";
  for (const t of order) {
    const co = d.companies[t], l = co.latest;
    body += `<tr>
      <td><span class="ticker">${t}</span><br><span class="cname">${co.name}</span></td>
      <td class="num price">${fmtB(l.ttm_capex)}</td>
      <td class="num">${fmtB(l.ttm_revenue)}</td>
      <td class="num">${fmtPct(l.ttm_capex_pct_revenue)}</td>
      <td class="num">${fmtPct(l.ttm_capex_yoy_pct, 1, true)}</td>
      <td class="num">${fmtPct(l.ttm_revenue_yoy_pct, 1, true)}</td>
      <td class="num ${l.ttm_fcf < 0 ? "neg" : ""}">${fmtB(l.ttm_fcf)}</td>
      <td class="num">${fmtRatio(l.incremental_rev_per_capex)}</td>
      <td class="num">${fmtB(co.cumulative_capex_since_2023)}</td>
    </tr>`;
  }
  body += `<tr class="total-row">
    <td><span class="ticker">ALL FOUR</span><br><span class="cname">Combined</span></td>
    <td class="num price">${fmtB(L.ttm_capex)}</td>
    <td class="num">${fmtB(L.ttm_revenue)}</td>
    <td class="num">${fmtPct(L.ttm_capex_pct_revenue)}</td>
    <td class="num">${fmtPct(L.ttm_capex_yoy_pct, 1, true)}</td>
    <td class="num">${fmtPct(L.ttm_revenue_yoy_pct, 1, true)}</td>
    <td class="num ${L.ttm_fcf < 0 ? "neg" : ""}">${fmtB(L.ttm_fcf)}</td>
    <td class="num">${fmtRatio(L.incremental_rev_per_capex)}</td>
    <td class="num">${fmtB(d.combined.cumulative_capex_since_2023)}</td>
  </tr>`;
  document.getElementById("scorecard-body").innerHTML = body;

  /* analysis */
  document.getElementById("analysis-body").innerHTML =
    buildAnalysis(d).map(p => `<p>${p}</p>`).join("");

  /* company sections */
  let sections = "";
  for (const t of order) {
    const co = d.companies[t], l = co.latest;
    const chart = comboChart(co.quarters, "capex", "capex_pct_revenue", "CAPEX, $B / QUARTER", "CAPEX % OF REVENUE", v => v.toFixed(0) + "%");
    const trows = [...co.quarters].reverse().map(r => `<tr>
      <td><strong>${r.label}</strong></td>
      <td class="num price">${fmtB(r.capex, 2)}</td>
      <td class="num">${fmtB(r.revenue)}</td>
      <td class="num">${fmtPct(r.capex_pct_revenue)}</td>
      <td class="num">${fmtPct(r.capex_yoy_pct, 1, true)}</td>
      <td class="num">${fmtPct(r.revenue_yoy_pct, 1, true)}</td>
      <td class="num">${fmtB(r.ocf)}</td>
      <td class="num ${r.fcf < 0 ? "neg" : ""}">${fmtB(r.fcf)}</td>
    </tr>`).join("");
    sections += `<div class="company-block">
      <div class="co-head"><span class="ticker">${t}</span><span class="cname">${co.name} · CIK ${co.cik}</span></div>
      <div class="co-stats">
        <div class="co-stat"><div class="k">TTM Capex</div><div class="v">${fmtB(l.ttm_capex)}</div></div>
        <div class="co-stat"><div class="k">Capex / Revenue (TTM)</div><div class="v">${fmtPct(l.ttm_capex_pct_revenue)}</div></div>
        <div class="co-stat"><div class="k">Capex Growth (TTM YoY)</div><div class="v">${fmtPct(l.ttm_capex_yoy_pct, 1, true)}</div></div>
        <div class="co-stat"><div class="k">Incr. Rev / Capex $</div><div class="v">${fmtRatio(l.incremental_rev_per_capex)}</div></div>
        <div class="co-stat"><div class="k">Cum. Capex Since 2023</div><div class="v">${fmtB(co.cumulative_capex_since_2023)}</div></div>
      </div>
      <div class="chart-card co-chart">
        <div class="legend">
          <span class="legend-item"><span class="swatch sw-bar"></span>Quarterly capex</span>
          <span class="legend-item"><span class="swatch sw-pct"></span>Capex % of revenue</span>
        </div>
        ${chart}
      </div>
      <div class="table-scroll">
        <table class="companies quarters">
          <thead><tr>
            <th>Quarter</th><th class="num">Capex</th><th class="num">Revenue</th>
            <th class="num">Capex % Rev</th><th class="num">Capex YoY</th><th class="num">Revenue YoY</th>
            <th class="num">Operating CF</th><th class="num">FCF After Capex</th>
          </tr></thead>
          <tbody>${trows}</tbody>
        </table>
      </div>
    </div>`;
  }
  document.getElementById("company-sections").innerHTML = sections;

  /* verification table */
  let vrows = "";
  for (const v of d.verification) {
    for (const chk of v.checks) {
      vrows += `<tr>
        <td><strong>${v.ticker}</strong></td><td>${chk.fiscal_year}</td>
        <td class="num">${fmtB(chk.build_capex, 2)}</td>
        <td class="num">${fmtB(chk.edgar_annual_capex, 2)}</td>
        <td class="num">${chk.diff_pct.toFixed(2)}%</td>
        <td class="check-ok">${chk.within_2pct ? "✓ within 2%" : "✗ CHECK"}</td>
      </tr>`;
    }
  }
  let ttmNote = "";
  for (const v of d.verification) {
    if (v.ttm_checks && v.ttm_checks.length) {
      const ok = v.ttm_checks.filter(c => c.within_2pct).length;
      ttmNote += `<p><strong>${v.name} TTM cross-check:</strong> ${ok} of ${v.ttm_checks.length} filer-tagged trailing-twelve-month capex spans in ${v.ticker}'s 10-Qs match the TTM series built here (latest: ${fmtB(v.ttm_checks[v.ttm_checks.length - 1].build_ttm_capex)} through ${v.ttm_checks[v.ttm_checks.length - 1].quarter_end}).</p>`;
    }
  }
  document.getElementById("verify-body").innerHTML =
    `<div class="verify-scroll"><table class="companies">
      <thead><tr><th>Company</th><th>Fiscal Year</th><th class="num">My Quarterly Build</th><th class="num">EDGAR 10-K Annual Fact</th><th class="num">Difference</th><th>Status</th></tr></thead>
      <tbody>${vrows}</tbody></table></div>` + ttmNote;

  document.getElementById("gen-stamp").textContent =
    "Data generated " + d.meta.generated_at + " · Pipeline: scripts/pull_edgar.py · Refreshes weekly via GitHub Actions.";
}

main().catch(err => {
  document.getElementById("analysis-body").innerHTML =
    "<p>The filing data could not be loaded (" + err.message + "). The dataset is published alongside this page at data/capex.json.</p>";
});
