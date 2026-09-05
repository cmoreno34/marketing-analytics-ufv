/* In-class practice — the guided version of activity A4.
 *
 * Forty minutes, one dataset, all four methods. The student chooses between
 * the cities data and the poke survey, and the two teach opposite lessons:
 * on the cities the methods converge and the segments are defensible; on the
 * poke survey the structure is weak and the methods disagree, and the right
 * answer is caution. Both are worth having met before the homework.
 *
 * Every expected answer is derived from the analysis the student is looking
 * at, never hardcoded, so this works unchanged on any dataset added later. */

import { useState, useEffect, useMemo } from "react";
import { C, card, clusterStyle } from "../theme.js";
import { Callout, Stat, Table, CentroidTable, Chip, Spinner } from "../components/UI.jsx";
import { LineOverK, Scatter, Dendrogram, SilhouettePlot, Legend, fmt, clearSnapshots } from "../components/Charts.jsx";
import Worksheet from "../components/Worksheet.jsx";
import { parseCSV } from "../lib/parse.js";
import { profileAll } from "../lib/prep.js";
import { analyse, silhouetteCurve, dbCurve } from "../lib/analysis.js";
import { silhouetteVerdict } from "../lib/validation.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const K = 4;

const DATASETS = [
  {
    id: "cities", file: "cities.csv", name: "US cities (49)",
    blurb: "Six demographic variables per city. The dataset the technical note uses throughout — city names on the dendrogram make it easy to read.",
    drop: /city_n/i,
  },
  {
    id: "poke", file: "poke_survey.csv", name: "Poke survey (40)",
    blurb: "The in-class case: 40 respondents scored on six survey scales. Real survey data, with everything that implies.",
    drop: null,
  },
];

export default function Practice() {
  const [dataset, setDataset] = useState(null);
  const [state, setState] = useState({ status: "idle" });

  useEffect(() => {
    if (!dataset) return;
    clearSnapshots();   // figures from a previous dataset must not leak in
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/${dataset.file}`);
        const { headers, rows } = parseCSV(await res.text());
        const prof = profileAll(rows, headers);
        const numCols = prof
          .filter((p) => p.isNumeric && !(dataset.drop && dataset.drop.test(p.key)))
          .map((p) => p.key);
        const nameCol = prof.find((p) => !p.isNumeric && p.distinctCount === rows.length)?.key;
        // A frame or two so the spinner paints before the synchronous crunch.
        await new Promise((r) => setTimeout(r, 30));
        const a = analyse(rows, numCols, [], { seed: 42, restarts: 25 });
        setState({ status: "ready", a, rowNames: nameCol ? rows.map((r) => String(r[nameCol])) : null });
      } catch (e) {
        setState({ status: "error", message: e.message || "Could not load the data." });
      }
    })();
  }, [dataset]);

  if (!dataset) return <Chooser onPick={setDataset} />;
  if (state.status === "loading" || state.status === "idle")
    return <Centered><Spinner label={`Running all four algorithms on ${dataset.name}…`} /></Centered>;
  if (state.status === "error")
    return <Centered><Callout tone="bad" title="Problem">{state.message}</Callout></Centered>;

  const { a, rowNames } = state;
  const ctx = { a, rowNames, dataset };

  return (
    <Worksheet
      id={`practice-${dataset.id}`}
      badge="in class · ~40 min"
      title="Practice: segmenting a market"
      subtitle={`Working on ${dataset.name}. Everything below is computed from that data as you go — you are reading real output, not a worked example. Numeric answers are checked instantly; the written ones are read by your lecturer.`}
      steps={buildSteps(ctx)}
      ctx={ctx}
      reportMeta={(c) => [
        ["Activity", "A4 — in-class practice, segmentation and buyer persona"],
        ["Dataset", `${c.dataset.name} — ${c.a.n} rows, ${c.a.numCols.length} variables`],
        ["Variables", c.a.numCols.join(", ")],
        ["Scaling", "z-score (standardised)"],
        ["Algorithm", `k-means, k = ${K}, seed ${c.a.seed}, ${c.a.restarts} restarts; Ward linkage; DBSCAN eps ${c.a.dbscan.eps}, minPts ${c.a.dbscan.minPts}`],
      ]}
      onRestart={() => setDataset(null)}
    />
  );
}

const Centered = ({ children }) => (
  <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "80px 22px" }}>{children}</div>
  </div>
);

function Chooser({ onPick }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "48px 22px 80px" }}>
        <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>
        <h1 style={{ fontSize: 26, margin: "14px 0 8px", fontWeight: 600 }}>Practice: segmenting a market</h1>
        <p style={{ color: C.mut, fontSize: 13.5, lineHeight: 1.75, maxWidth: 620, margin: "0 0 8px" }}>
          About forty minutes. You will run four clustering algorithms on one dataset, decide how many segments
          it really has, and judge whether the answer is good enough to show a client.
        </p>
        <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.75, maxWidth: 620, margin: "0 0 28px" }}>
          Your answers save as you type. At the end you get a report to hand in.
        </p>
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.mut, letterSpacing: "1.1px", textTransform: "uppercase", marginBottom: 11 }}>
          choose your data
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {DATASETS.map((d) => (
            <button key={d.id} onClick={() => onPick(d)} style={{
              textAlign: "left", background: C.card, border: `1px solid ${C.bord}`, borderRadius: 10,
              padding: "18px 20px", cursor: "pointer", color: C.txt, fontFamily: "system-ui",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <strong style={{ fontSize: 15.5 }}>{d.name}</strong>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: C.acc }}>START →</span>
              </div>
              <div style={{ color: C.mut, fontSize: 12.8, lineHeight: 1.6 }}>{d.blurb}</div>
            </button>
          ))}
        </div>
        <Callout tone="info" title="Which one?">
          If your class is doing the poke case, take the survey. Otherwise take the cities — it is the dataset in
          the technical note, so every figure there will match what you see. The two behave very differently, which
          is itself worth knowing.
        </Callout>
      </div>
    </div>
  );
}

/* ── The steps ── */
function buildSteps({ a, rowNames, dataset }) {
  const km = a.kmeans[K];
  const sil = km.metrics.silhouette;
  const verdict = silhouetteVerdict(sil);
  const bestSilK = a.bestK.silhouette;
  const gapK = a.ward.gaps[0].k;
  const ari = a.ari(K);
  const db = a.dbscan;

  return [
    {
      id: "data", title: "Look at the data first", minutes: 4,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            Before any algorithm runs, look at what you have. {a.n} rows, {a.numCols.length} variables, all numeric
            and standardised so that no variable dominates the distance simply because it is measured in bigger units.
          </p>
          <p style={{ margin: 0 }}>
            Clustering will find groups whether or not any exist. Forming an expectation now is what lets you tell
            a real finding from an artefact later.
          </p>
        </>
      ),
      render: () => (
        <Table
          head={["variable", "mean", "min", "max"]}
          rows={a.numCols.map((c, j) => {
            const col = a.numRaw.map((r) => r[j]);
            return [c, fmt(col.reduce((s, v) => s + v, 0) / col.length), fmt(Math.min(...col)), fmt(Math.max(...col))];
          })}
        />
      ),
      questions: [{
        id: "expect", kind: "text", minWords: 20, rows: 3,
        prompt: "Which of these variables do you expect to separate the groups most, and why? One or two sentences — you will check yourself against the result later.",
        placeholder: "I expect … because …",
      }],
    },

    {
      id: "first", title: `A first segmentation: k-means with k = ${K}`, minutes: 6,
      intro: (
        <p style={{ margin: 0 }}>
          Here is k-means with {K} segments, seed {a.seed}, {a.restarts} restarts. The table shows cluster means in the
          original units — this is the buyer persona in quantitative form, before anyone writes a word of prose.
        </p>
      ),
      capture: ["p-scatter"],
      render: () => (
        <>
          <div style={{ marginBottom: 12 }}><Legend k={K} sizes={km.sizes} /></div>
          <CentroidTable centroids={km.centroids} numCols={a.numCols} catCols={[]}
            sizes={km.sizes} total={a.n} silhouettePerCluster={km.metrics.silhouettePerCluster} />
          <div style={{ marginTop: 16 }}>
            <Scatter captureId="p-scatter" points={a.numRaw.map((r) => [r[0], r[1]])} labels={km.labels}
              centroids={km.centroids.map((c) => [c[a.numCols[0]], c[a.numCols[1]]])}
              xLabel={a.numCols[0]} yLabel={a.numCols[1]} rowNames={rowNames} height={300} />
          </div>
        </>
      ),
      questions: [
        {
          id: "biggest", kind: "number", tol: 0, unit: "(segment number)",
          answer: km.sizes.indexOf(Math.max(...km.sizes)) + 1,
          prompt: "Which segment number holds the most rows?",
          hint: "Look at the n column in the table, or the legend above the scatter.",
          why: "Size matters commercially: a segment of three customers is rarely worth a campaign of its own.",
        },
        {
          id: "persona", kind: "text", minWords: 30, rows: 4,
          prompt: "Pick any segment and describe it in three or four sentences, as you would to a marketing manager. Quote the actual centroid values that justify what you say — do not invent attributes the data does not contain.",
          placeholder: "Segment N is …, with an average … of …, which suggests …",
        },
      ],
    },

    {
      id: "howmany", title: `Is ${K} the right number of segments?`, minutes: 7,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            We chose {K} because someone had to choose something. The elbow curve on the left always falls, so it can
            only ever show where the improvement slows — it cannot say whether the segments are separated. The
            silhouette can.
          </p>
        </>
      ),
      capture: ["p-elbow", "p-sil-k"],
      render: () => (
        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))" }}>
          <LineOverK captureId="p-elbow" data={a.elbow} yKey="wcss" yLabel="WCSS" selected={K}
            label="Elbow — within-cluster sum of squares" />
          <LineOverK captureId="p-sil-k" data={silhouetteCurve(a)} yKey="silhouette" yLabel="silhouette"
            selected={K} invertGood={false} label="Average silhouette (higher is better)" />
          <LineOverK data={dbCurve(a)} yKey="daviesBouldin" yLabel="Davies-Bouldin" selected={K} invertGood
            label="Davies-Bouldin (lower is better)" />
        </div>
      ),
      questions: [
        {
          id: "bestk", kind: "number", tol: 0, answer: bestSilK,
          prompt: "At which value of k is the average silhouette highest? Read it off the middle chart — the best point is circled.",
          hint: `Follow the silhouette line and find its peak. On this data it is at k = ${bestSilK}.`,
          why: bestSilK === K
            ? `It agrees with the k = ${K} we picked, which is reassuring but not proof.`
            : `Note that it disagrees with the k = ${K} we started from. That disagreement is the interesting part, and the next question is about it.`,
        },
        {
          id: "elbowlimit", kind: "choice", answer: 0,
          prompt: "Why can the elbow curve not tell you, on its own, whether a segmentation is any good?",
          options: [
            "Because it always falls as k rises, so it shows where improvement slows but says nothing about whether the segments are separated from each other",
            "Because it needs at least 100 observations to be reliable",
            "Because it only works on standardised data",
            "Because it measures separation but not compactness",
          ],
          hint: "Think about what happens to the within-cluster sum of squares when you add another cluster. Can it ever go up?",
          why: "A dataset with no structure at all still produces a perfectly smooth elbow curve.",
        },
      ],
    },

    {
      id: "quality", title: "How good is this partition, really?", minutes: 6,
      intro: (
        <p style={{ margin: 0 }}>
          The three indices, and the silhouette plot underneath. Each bar is one row of your data: a wide block of long
          bars is a solid segment, a short ragged block is one the algorithm invented to satisfy the k we imposed.
          Bars to the left of zero are rows that sit closer to a different segment than to their own.
        </p>
      ),
      capture: ["p-silplot"],
      render: () => (
        <>
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 15 }}>
            <Stat label="silhouette" value={sil.toFixed(3)} hint={verdict.label}
              tone={verdict.tone === "good" ? "good" : verdict.tone === "warn" ? "warn" : "bad"} />
            <Stat label="Davies-Bouldin" value={km.metrics.daviesBouldin.toFixed(3)} hint="lower is better" />
            <Stat label="Calinski-Harabasz" value={fmt(km.metrics.calinskiHarabasz)} hint="higher is better" />
          </div>
          <SilhouettePlot captureId="p-silplot" perPoint={km.metrics.silhouettePerPoint}
            labels={km.labels} k={K} mean={sil} height={280} />
        </>
      ),
      questions: [
        {
          id: "silval", kind: "number", tol: 0.003, answer: +sil.toFixed(3),
          prompt: `Report the average silhouette for k = ${K}, to three decimal places.`,
          hint: "It is on the first tile above, and marked by the dashed line on the plot.",
        },
        {
          id: "silband", kind: "choice", answer: bandIndex(sil),
          prompt: "Using the interpretation table from section 9 of the technical note, which band does that value fall in?",
          options: [
            "0.71 – 1.00 · a strong structure has been found",
            "0.51 – 0.70 · a reasonable structure has been found",
            "0.26 – 0.50 · the structure is weak and could be artificial",
            "below 0.26 · no substantial structure has been found",
          ],
          hint: "Compare your number against the four bands. Be honest about which one it lands in — that honesty is the point of the exercise.",
          why: sil < 0.26
            ? "That is an uncomfortable answer and the correct one. Reporting it honestly is worth more than four confident personas resting on a partition of noise."
            : "Note this down — you will need it when you decide whether to show these segments to a client.",
        },
      ],
    },

    {
      id: "hier", title: "A completely different method: hierarchical clustering", minutes: 7,
      intro: (
        <p style={{ margin: 0 }}>
          Ward's method never asked us for k. It merged the two closest groups over and over and recorded every merge.
          Height is the distance at which two groups joined; the biggest vertical jump is where merging starts to
          combine things that do not belong together.
        </p>
      ),
      capture: ["p-dendro"],
      render: () => (
        <>
          <Dendrogram captureId="p-dendro" layout={a.ward.layout} n={a.n}
            cutHeight={cutHeight(a, K)} labels={a.ward.byK[K].labels} leafNames={rowNames} height={330} />
          <div style={{ marginTop: 14 }}>
            <Table head={["cut to k", "merge at", "next merge at", "jump"]}
              rows={a.ward.gaps.slice(0, 5).map((g) => [
                <strong>{g.k}</strong>, g.from.toFixed(3), g.to.toFixed(3),
                <span style={{ color: C.acc }}>+{g.gap.toFixed(3)}</span>,
              ])} />
          </div>
        </>
      ),
      questions: [
        {
          id: "gapk", kind: "number", tol: 0, answer: gapK,
          prompt: "According to the table, cutting to how many clusters comes just before the biggest jump in merge distance?",
          hint: `Sort by the jump column — the largest is at k = ${gapK}.`,
          why: gapK === K
            ? `The dendrogram agrees with k = ${K} from a completely different starting principle. That is the strongest kind of evidence you can get.`
            : `The dendrogram points at k = ${gapK}, not ${K}. Two reputable methods disagreeing on the same data is normal, and saying so is better than hiding it.`,
        },
      ],
    },

    {
      id: "agree", title: "Do the two methods agree?", minutes: 5,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            You cannot compare two partitions by comparing labels — what one method calls segment 1 the other may call
            segment 3, and the grouping can still be identical. The Adjusted Rand Index compares <em>pairs</em> of rows
            instead: for every pair, do both methods agree on whether they belong together?
          </p>
          <p style={{ margin: 0 }}>
            1 means identical groupings, 0 means no more agreement than chance would give.
          </p>
        </>
      ),
      render: () => (
        <div style={{ display: "flex", gap: 11, flexWrap: "wrap" }}>
          <Stat label={`ARI at k = ${K}`} value={ari.toFixed(3)}
            tone={ari >= 0.7 ? "good" : ari >= 0.4 ? "warn" : "bad"}
            hint={ari >= 0.7 ? "same structure" : ari >= 0.4 ? "same broad shape" : "different stories"} />
          <Stat label="k-means sizes" value={a.kmeans[K].sizes.join(" · ")} />
          <Stat label="Ward sizes" value={a.ward.byK[K].sizes.join(" · ")} />
        </div>
      ),
      questions: [
        {
          id: "arival", kind: "number", tol: 0.02, answer: +ari.toFixed(2),
          prompt: `Report the Adjusted Rand Index between k-means and Ward at k = ${K}, to two decimal places.`,
          hint: "It is on the first tile above.",
        },
        {
          id: "arimean", kind: "choice", answer: ari >= 0.7 ? 0 : ari >= 0.4 ? 1 : 2,
          prompt: "What does that value tell you?",
          options: [
            "The two methods essentially found the same structure — strong evidence the segments are real and not an artefact of one algorithm",
            "They agree on the broad shape but disagree about which segment the borderline rows belong to",
            "They are telling different stories about this data, and you have to decide which one the business can act on",
          ],
          hint: "Above 0.7 is the same structure; 0.4 to 0.7 agrees on the shape but not the boundaries; below 0.4 is genuine disagreement.",
          why: ari >= 0.7
            ? "Two methods built on different principles converging is the best evidence a segmentation study can produce."
            : "Write this down for your conclusion — it constrains how strongly you can claim these segments.",
        },
      ],
    },

    {
      id: "dbscan", title: "And a method that can refuse to answer", minutes: 4,
      intro: (
        <p style={{ margin: 0 }}>
          DBSCAN looks for dense regions instead of partitioning everything. It chooses its own number of clusters, and
          it is allowed to label rows as noise rather than forcing them into a segment. Here it ran with eps = {db.eps} and
          minPts = {db.minPts}, both taken from the knee of the k-distance curve.
        </p>
      ),
      render: () => (
        <>
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 13 }}>
            <Stat label="clusters found" value={db.nClusters} tone={db.nClusters <= 1 ? "warn" : undefined} />
            <Stat label="noise" value={db.noise} hint={`${((db.noise / a.n) * 100).toFixed(0)}% unassigned`} />
            <Stat label="eps" value={db.eps} />
            <Stat label="minPts" value={db.minPts} />
          </div>
          {db.nClusters <= 1 && (
            <Callout tone="warn" title="It found nothing — and that is a result">
              With {a.numCols.length} variables, distances between rows concentrate: nearest and furthest neighbours end
              up almost equally far away, so no region is meaningfully denser than another. DBSCAN is excellent in two
              or three dimensions and unreliable in eight. This is the curse of dimensionality, not a bug.
            </Callout>
          )}
        </>
      ),
      questions: [{
        id: "dbwhy", kind: "choice", answer: db.nClusters <= 1 ? 0 : 1,
        prompt: db.nClusters <= 1
          ? "DBSCAN found essentially no density structure here, while k-means happily returned four segments. What does the combination tell you?"
          : "DBSCAN found its own clusters and rejected some rows as noise. What is the most useful thing about that behaviour for a marketer?",
        options: db.nClusters <= 1
          ? [
              "The k-means segments are divisions imposed on a continuous cloud rather than naturally separated groups — which limits how strongly you can claim them",
              "The k-means result is wrong and should be discarded",
              "DBSCAN needs more data to work",
              "The data was not standardised properly",
            ]
          : [
              "It removes the outliers so the remaining segments are cleaner",
              "The rows it rejects are usually the commercially interesting ones — the very high spender, the one-off buyer, the mis-keyed record — and a method that absorbs them into the nearest segment hides them",
              "It always finds the correct number of segments",
              "It is faster than k-means",
            ],
        hint: db.nClusters <= 1
          ? "Both results are true at once. k-means partitions any cloud into k parts whether or not the parts are separated; DBSCAN only reports groups that are separated by sparse regions."
          : "Think about who ends up labelled as noise in a customer database.",
      }],
    },

    {
      id: "conclude", title: "Your conclusion", minutes: 6,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            You have four methods, three indices and two answers for k. Now do the part no algorithm does for you.
          </p>
          <p style={{ margin: 0 }}>
            Remember what the technical note says about t-shirt sizes: the arithmetic narrows the options, the business
            picks between them. A segmentation you can act on beats one the indices marginally prefer.
          </p>
        </>
      ),
      render: () => (
        <Table
          head={["method", "k", "silhouette", "Davies-Bouldin", "sizes"]}
          rows={[
            ["k-means", K, sil.toFixed(3), km.metrics.daviesBouldin.toFixed(3), km.sizes.join(" · ")],
            ["Ward", K, a.ward.byK[K].metrics.silhouette.toFixed(3), a.ward.byK[K].metrics.daviesBouldin.toFixed(3), a.ward.byK[K].sizes.join(" · ")],
            ["DBSCAN", db.nClusters, db.metrics ? db.metrics.silhouette.toFixed(3) : "—",
              db.metrics ? db.metrics.daviesBouldin.toFixed(3) : "—", `${db.counts.join(" · ") || "—"} (+${db.noise} noise)`],
          ]}
        />
      ),
      questions: [
        {
          id: "chosenk", kind: "text", minWords: 30, rows: 3,
          prompt: "How many segments would you report for this market, and why? Your answer must refer to at least two pieces of evidence above, and say what you did about any disagreement between them.",
          placeholder: "I would report N segments. The silhouette … while the dendrogram … I chose … because …",
        },
        {
          id: "client", kind: "text", minWords: 40, rows: 5,
          prompt: "Would you present these segments to a client as a basis for spending a marketing budget? Say yes or no explicitly, and justify it with the validation evidence. If your answer is no, say what you would do instead — that is a perfectly good answer and it is marked as one.",
          placeholder: "",
        },
        {
          id: "reflect", kind: "text", minWords: 20, rows: 3,
          prompt: "Look back at step 1. Was the variable you expected to matter actually the one that separated the segments? What does the answer tell you about starting an analysis with an expectation?",
        },
      ],
    },
  ];
}

const bandIndex = (s) => (s >= 0.71 ? 0 : s >= 0.51 ? 1 : s >= 0.26 ? 2 : 3);

/* Halfway between the merge that creates k clusters and the one that would
 * take it to k-1 — the same rule the Segmentation Lab draws. */
function cutHeight(a, k) {
  const L = a.ward.Z;
  if (!L?.length || k < 2) return null;
  const hi = L[L.length - k + 1]?.[2];
  const lo = L[L.length - k]?.[2];
  return hi != null && lo != null ? (hi + lo) / 2 : null;
}
