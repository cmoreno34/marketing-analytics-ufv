/* RFM — Recency, Frequency, Monetary.
 *
 * The oldest segmentation in direct marketing and still the first thing a
 * practitioner runs on transactional data. It is not a clustering algorithm:
 * it is a scoring rule that produces segments by construction, which is
 * exactly why it is worth putting next to k-means. RFM tells you what a
 * customer is WORTH; clustering tells you what a customer is LIKE. The two
 * answer different questions and a good deliverable uses both. */

const quantile = (sorted, q) => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/* Quintile scoring, 1–5. Recency is reversed: a small number of days since the
 * last purchase is GOOD, so it earns a 5.
 *
 * Ties are the practical headache here — if 40% of customers have frequency 1,
 * the quintile edges collapse and whole score bands vanish. We rank first and
 * break ties by position, which keeps the five bands populated and is what
 * most commercial implementations do. */
function scoreQuintiles(values, reverse) {
  const n = values.length;
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const scores = new Array(n).fill(1);
  idx.forEach(([, original], rank) => {
    const band = Math.min(4, Math.floor((rank / n) * 5));
    scores[original] = reverse ? 5 - band : band + 1;
  });
  return scores;
}

/* The 11 standard RFM segments. The rule set is the widely used
 * Putler/Kohavi-style grid, driven by R and by the average of F and M. */
function labelSegment(r, fm) {
  if (r >= 5 && fm >= 4) return "Champions";
  if (r >= 4 && fm >= 3) return "Loyal customers";
  if (r >= 4 && fm >= 1 && fm <= 2) return "Potential loyalist";
  if (r === 5 && fm <= 1) return "New customers";
  if (r >= 3 && r <= 4 && fm <= 1) return "Promising";
  if (r === 3 && fm >= 3) return "Need attention";
  if (r === 3 && fm <= 2) return "About to sleep";
  if (r <= 2 && fm >= 4) return "Cannot lose them";
  if (r <= 2 && fm >= 2) return "At risk";
  if (r <= 2 && fm >= 1) return "Hibernating";
  return "Lost";
}

export const SEGMENT_ACTIONS = {
  "Champions": "Reward them. Early access, referral asks, advocacy programmes — they will carry the brand for you.",
  "Loyal customers": "Upsell higher-value products and ask for reviews. They already believe you.",
  "Potential loyalist": "Membership or loyalty programme; recommend adjacent products to build the habit.",
  "New customers": "Onboarding. Build the second purchase early — the first repeat is the hardest.",
  "Promising": "Free trials, brand awareness content. Interest is there, value is not yet.",
  "Need attention": "Time-limited offers based on past purchases. Reactivate before they drift.",
  "About to sleep": "Reactivation with popular products and a discount. Share useful resources.",
  "Cannot lose them": "Win them back with renewals or newer products. Talk to them directly — the loss is expensive.",
  "At risk": "Personalised reactivation, helpful contact, targeted offers. Do not let this cohort go quietly.",
  "Hibernating": "Low-cost reactivation, or accept the churn and stop spending on them.",
  "Lost": "Revive interest with an outreach campaign, otherwise ignore. Do not spend the budget here.",
};

/* @param rows      raw data
 * @param cfg       { id, recency, frequency, monetary, recencyIsDate, referenceDate }
 * Recency may be supplied either as a date of last purchase (we convert to
 * days before the reference date) or already as a number of days. */
export function computeRFM(rows, cfg) {
  const { id, recency, frequency, monetary, recencyIsDate, referenceDate } = cfg;
  const ref = referenceDate ? new Date(referenceDate) : new Date();

  const parseDate = (v) => {
    if (v instanceof Date) return v;
    const s = String(v).trim();
    // Accept dd-mm-yyyy and dd/mm/yyyy, which is how Canvas-exported and
    // Spanish-locale CSVs come out, before falling back to Date parsing.
    const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return new Date(s);
  };

  const recVals = rows.map((r) => {
    if (!recencyIsDate) return Number(r[recency]);
    const d = parseDate(r[recency]);
    return Number.isFinite(d.getTime()) ? (ref - d) / 86400000 : NaN;
  });
  const freqVals = rows.map((r) => Number(r[frequency]));
  const monVals = rows.map((r) => Number(r[monetary]));

  const keep = rows
    .map((_, i) => i)
    .filter((i) => Number.isFinite(recVals[i]) && Number.isFinite(freqVals[i]) && Number.isFinite(monVals[i]));

  const R = scoreQuintiles(keep.map((i) => recVals[i]), true);
  const F = scoreQuintiles(keep.map((i) => freqVals[i]), false);
  const M = scoreQuintiles(keep.map((i) => monVals[i]), false);

  const result = keep.map((rowIdx, i) => {
    const fm = Math.round((F[i] + M[i]) / 2);
    const segment = labelSegment(R[i], fm);
    return {
      rowIndex: rowIdx,
      id: id ? rows[rowIdx][id] : rowIdx + 1,
      recency: Math.round(recVals[rowIdx] * 10) / 10,
      frequency: freqVals[rowIdx],
      monetary: Math.round(monVals[rowIdx] * 100) / 100,
      R: R[i], F: F[i], M: M[i],
      cell: `${R[i]}${F[i]}${M[i]}`,
      segment,
    };
  });

  const bySegment = new Map();
  for (const row of result) {
    if (!bySegment.has(row.segment))
      bySegment.set(row.segment, { segment: row.segment, n: 0, monetary: 0, recency: 0, frequency: 0 });
    const s = bySegment.get(row.segment);
    s.n++;
    s.monetary += row.monetary;
    s.recency += row.recency;
    s.frequency += row.frequency;
  }
  const totalValue = result.reduce((s, r) => s + r.monetary, 0);
  const summary = [...bySegment.values()]
    .map((s) => ({
      segment: s.segment,
      n: s.n,
      share: s.n / result.length,
      avgRecency: Math.round((s.recency / s.n) * 10) / 10,
      avgFrequency: Math.round((s.frequency / s.n) * 10) / 10,
      avgMonetary: Math.round((s.monetary / s.n) * 100) / 100,
      totalMonetary: Math.round(s.monetary * 100) / 100,
      valueShare: totalValue ? s.monetary / totalValue : 0,
      action: SEGMENT_ACTIONS[s.segment] ?? "",
    }))
    .sort((a, b) => b.totalMonetary - a.totalMonetary);

  return { rows: result, summary, dropped: rows.length - keep.length, totalValue };
}

/* Columns that plausibly serve each RFM role, so the tool can pre-select
 * sensible defaults instead of making the student hunt through 29 headers. */
export function guessRFMColumns(profiles) {
  const find = (patterns, numericOnly = true) =>
    profiles.find((p) => (!numericOnly || p.isNumeric) && patterns.some((re) => re.test(p.key)))?.key ?? "";
  return {
    id: find([/^id$/i, /customer.?id/i, /^cust/i], false),
    recency: find([/recency/i, /days.?since/i, /last.?purchase/i]),
    dateColumn: find([/dt_?customer/i, /date/i, /fecha/i], false),
    frequency: find([/frequency/i, /num.*purchase/i, /orders/i, /visits/i]),
    monetary: find([/monetary/i, /revenue/i, /spend/i, /amount/i, /total/i, /mnt/i]),
  };
}
