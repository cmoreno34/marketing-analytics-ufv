/* In-class activity B4 — dendrograms and the choice of linkage.
 *
 * The practice already covers Ward. What this adds, and what nothing else in
 * the course covers, is that the linkage method is a modelling decision with
 * consequences: on the same 49 cities, single linkage puts 46 of them in one
 * cluster and three on their own, and scores a HIGHER average silhouette than
 * Ward while doing it.
 *
 * That is the whole activity. A student who leaves knowing that a good index
 * can come from a useless partition has learned something the indices alone
 * will never tell them. */

import { useState, useEffect, useMemo } from "react";
import { C, clusterStyle } from "../theme.js";
import { Callout, Stat, Table, Chip, Spinner } from "../components/UI.jsx";
import { Dendrogram, Legend, fmt, clearSnapshots } from "../components/Charts.jsx";
import Worksheet from "../components/Worksheet.jsx";
import { parseCSV } from "../lib/parse.js";
import { profileAll, standardize, buildMatrix } from "../lib/prep.js";
import { linkage, cutTree, dendrogramLayout, mergeGaps, centroidsFromLabels } from "../lib/hierarchical.js";
import { kmeans } from "../lib/kmeans.js";
import { scorePartition, adjustedRand } from "../lib/validation.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const K = 4;
const METHODS = [
  { id: "ward", label: "Ward", blurb: "Merges the pair that adds the least variance." },
  { id: "average", label: "Average", blurb: "Merges the pair with the smallest mean distance between members." },
  { id: "complete", label: "Complete", blurb: "Merges the pair whose furthest members are closest." },
  { id: "single", label: "Single", blurb: "Merges the pair whose nearest members are closest." },
];

export default function LinkageLab() {
  const [state, setState] = useState({ status: "loading" });
  const [shown, setShown] = useState("ward");

  useEffect(() => {
    clearSnapshots();
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/cities.csv`);
        const { headers, rows } = parseCSV(await res.text());
        const prof = profileAll(rows, headers);
        const numCols = prof.filter((p) => p.isNumeric && !/city_n/i.test(p.key)).map((p) => p.key);
        const nameCol = prof.find((p) => !p.isNumeric)?.key;
        const { z } = standardize(buildMatrix(rows, numCols));
        await new Promise((r) => setTimeout(r, 30));

        const by = {};
        for (const m of METHODS) {
          const { Z } = linkage(z, m.id);
          const labels = cutTree(Z, z.length, K);
          const sizes = Array.from({ length: K }, (_, c) => labels.filter((x) => x === c).length);
          by[m.id] = {
            Z, labels, sizes,
            layout: dendrogramLayout(Z, z.length),
            gaps: mergeGaps(Z, 5),
            metrics: scorePartition(z, labels, centroidsFromLabels(z, labels, K), K),
            biggestShare: Math.max(...sizes) / z.length,
            singletons: sizes.filter((s) => s === 1).length,
          };
        }
        const km = kmeans(z, K, { restarts: 25, seed: 42 });
        setState({
          status: "ready", z, by, km, n: z.length, numCols,
          names: nameCol ? rows.map((r) => String(r[nameCol])) : null,
        });
      } catch (e) {
        setState({ status: "error", message: e.message || "Could not load the cities data." });
      }
    })();
  }, []);

  if (state.status === "loading")
    return <Centered><Spinner label="Building four dendrograms of the same 49 cities…" /></Centered>;
  if (state.status === "error")
    return <Centered><Callout tone="bad" title="Problem">{state.message}</Callout></Centered>;

  const ctx = { ...state, shown, setShown };

  return (
    <Worksheet
      id="practice-linkage"
      badge="in class · ~25 min · not graded"
      title="Practice: dendrograms and the choice of linkage"
      subtitle="The same 49 cities, merged four different ways. This one is not graded — it exists so that the choice of method stops being a dropdown and becomes a decision you can defend."
      steps={buildSteps(ctx)}
      ctx={ctx}
      activity="B4 — in-class practice: dendrograms and linkage"
      rubric={"Not graded. The point is to leave able to (a) read a dendrogram and find where to cut, (b) explain what each linkage rule does, and (c) recognise that a high validation index can come from a degenerate partition."}
      reportMeta={(c) => [
        ["Activity", "B4 — in-class practice, hierarchical clustering and linkage"],
        ["Dataset", `US cities — ${c.n} rows, ${c.numCols.length} variables`],
        ["Variables", c.numCols.join(", ")],
        ["Scaling", "z-score (standardised)"],
        ["Cut at", `k = ${K} for every linkage method`],
      ]}
    />
  );
}

const Centered = ({ children }) => (
  <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "80px 22px" }}>{children}</div>
  </div>
);

function cutHeight(Z, k) {
  if (!Z?.length || k < 2) return null;
  const hi = Z[Z.length - k + 1]?.[2];
  const lo = Z[Z.length - k]?.[2];
  return hi != null && lo != null ? (hi + lo) / 2 : null;
}

function buildSteps({ by, km, n, names, shown, setShown }) {
  const ward = by.ward;
  const mostUnbalanced = METHODS.reduce((b, m) => (by[m.id].biggestShare > by[b.id].biggestShare ? m : b), METHODS[0]);
  const bestSilMethod = METHODS.reduce((b, m) => (by[m.id].metrics.silhouette > by[b.id].metrics.silhouette ? m : b), METHODS[0]);

  // The pair of linkages that agree most, for the ARI step.
  let bestPair = { a: METHODS[0], b: METHODS[1], v: -Infinity };
  for (let i = 0; i < METHODS.length; i++)
    for (let j = i + 1; j < METHODS.length; j++) {
      const v = adjustedRand(by[METHODS[i].id].labels, by[METHODS[j].id].labels);
      if (v > bestPair.v) bestPair = { a: METHODS[i], b: METHODS[j], v };
    }

  const Picker = () => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 13 }}>
      {METHODS.map((m) => (
        <Chip key={m.id} active={shown === m.id} onClick={() => setShown(m.id)} title={m.blurb}>{m.label}</Chip>
      ))}
    </div>
  );

  return [
    {
      id: "read", title: "Read the tree", minutes: 5,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            Ward's method on the {n} cities. It never asked how many segments you wanted: it merged the closest pair
            over and over, and recorded the distance at every merge. The height of a join is how different the two
            groups were when they came together.
          </p>
          <p style={{ margin: 0 }}>
            Cut just below the biggest vertical jump. The number of vertical lines your cut crosses is k.
          </p>
        </>
      ),
      capture: ["b4-ward"],
      render: () => (
        <>
          <Dendrogram captureId="b4-ward" layout={ward.layout} n={n} cutHeight={cutHeight(ward.Z, K)}
            labels={ward.labels} leafNames={names} height={330} />
          <div style={{ marginTop: 14 }}>
            <Table head={["cut to k", "merge at", "next merge at", "jump"]}
              rows={ward.gaps.slice(0, 5).map((g) => [
                <strong>{g.k}</strong>, g.from.toFixed(3), g.to.toFixed(3),
                <span style={{ color: C.acc }}>+{g.gap.toFixed(3)}</span>,
              ])} />
          </div>
        </>
      ),
      questions: [
        {
          id: "b4-gap", kind: "number", tol: 0, answer: ward.gaps[0].k,
          prompt: "Cutting to how many clusters comes just before the biggest jump?",
          hint: "The largest number in the jump column.",
          why: "That jump means the next merge would join two groups that are genuinely unlike each other.",
        },
        {
          id: "b4-height", kind: "choice", answer: 1,
          prompt: "What does the height of a join on the vertical axis represent?",
          options: [
            "The number of cities in the merged group",
            "How dissimilar the two groups were at the moment they merged",
            "The order in which the merges happened",
            "The distance from the merged group to the overall mean",
          ],
          hint: "Two very similar groups join low down; two very different ones join near the top.",
        },
      ],
    },

    {
      id: "four", title: "Four ways to decide what 'closest' means", minutes: 7,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            Hierarchical clustering always merges the closest pair. But <em>closest</em> has to be defined for two
            groups, not two points, and there is more than one sensible definition. Switch between them and watch the
            tree change shape.
          </p>
          <ul style={{ margin: 0, paddingLeft: 19, lineHeight: 1.8 }}>
            {METHODS.map((m) => <li key={m.id}><strong>{m.label}</strong> — {m.blurb}</li>)}
          </ul>
        </>
      ),
      capture: ["b4-compare"],
      render: () => (
        <>
          <Picker />
          <Dendrogram captureId="b4-compare" layout={by[shown].layout} n={n} cutHeight={cutHeight(by[shown].Z, K)}
            labels={by[shown].labels} leafNames={names} height={310} />
          <div style={{ marginTop: 14 }}>
            <Table head={["linkage", "segment sizes at k = 4", "biggest segment", "segments of one city"]}
              rows={METHODS.map((m) => [
                <strong>{m.label}</strong>,
                by[m.id].sizes.join(" · "),
                `${(by[m.id].biggestShare * 100).toFixed(0)}% of the cities`,
                by[m.id].singletons,
              ])} />
          </div>
        </>
      ),
      questions: [
        {
          id: "b4-unbalanced", kind: "choice", answer: METHODS.findIndex((m) => m.id === mostUnbalanced.id),
          prompt: "Which linkage puts the largest share of the cities into a single segment?",
          options: METHODS.map((m) => `${m.label} — ${(by[m.id].biggestShare * 100).toFixed(0)}% in one segment`),
          hint: "Read the third column of the table.",
          why: "This is called chaining: single linkage only needs one close pair to join two groups, so it grows one cluster along a chain of near neighbours and leaves isolated points behind as singletons.",
        },
        {
          id: "b4-usefulness", kind: "text", minWords: 30, rows: 4,
          rubric: "Must connect the segment sizes to usability for marketing: a segment holding almost every city, plus segments of one, cannot support different campaigns. A generic statement about 'balance' without reference to the actual numbers is weak.",
          prompt: "Look at the segment sizes for each method. Which of these four partitions could a marketing team actually act on, and which could not? Refer to the actual numbers.",
        },
      ],
    },

    {
      id: "trap", title: "A trap worth falling into once", minutes: 7,
      intro: (
        <>
          <p style={{ margin: "0 0 10px" }}>
            Now score all four with the validation indices from section 9 of the technical note, and look carefully
            before you conclude anything.
          </p>
        </>
      ),
      render: () => (
        <>
          <Table head={["linkage", "silhouette", "Davies-Bouldin", "sizes", "biggest segment"]}
            rows={METHODS.map((m) => {
              const b = by[m.id];
              const best = m.id === bestSilMethod.id;
              return [
                <strong>{m.label}</strong>,
                <span style={{ color: best ? C.good : C.txt, fontWeight: best ? 700 : 400 }}>
                  {b.metrics.silhouette.toFixed(3)}
                </span>,
                b.metrics.daviesBouldin.toFixed(3),
                b.sizes.join(" · "),
                `${(b.biggestShare * 100).toFixed(0)}%`,
              ];
            })} />
          <Callout tone="warn" title="Read the winning row again">
            The highest average silhouette here belongs to <strong>{bestSilMethod.label}</strong>, at{" "}
            {by[bestSilMethod.id].metrics.silhouette.toFixed(3)} — comfortably above Ward's{" "}
            {ward.metrics.silhouette.toFixed(3)}. And it produced segments of{" "}
            {by[bestSilMethod.id].sizes.join(", ")}.
          </Callout>
        </>
      ),
      questions: [
        {
          id: "b4-trap", kind: "choice", answer: 1,
          prompt: `${bestSilMethod.label} linkage scores the best silhouette of the four. Does that make it the best segmentation of this market?`,
          options: [
            "Yes — the silhouette is the standard measure of separation, so the highest value wins",
            "No — a segment holding almost every city plus segments of one score well because isolated points are far from everything, but the partition is useless commercially",
            "No — the silhouette cannot be used on hierarchical clustering at all",
            "It cannot be judged without knowing the Calinski-Harabasz values",
          ],
          hint: "Ask what the silhouette actually measures for a cluster containing a single city. How far is that city from its own cluster?",
          why: "A single-member cluster has no within-cluster distance at all, so it scores as perfectly compact. Chase the index and you get a partition that is mathematically excellent and commercially worthless.",
        },
        {
          id: "b4-lesson", kind: "text", minWords: 35, rows: 4,
          rubric: "Must state the general lesson — a validation index cannot be used on its own, and segment sizes and business usability have to be checked alongside it. Bonus for noting that this is the same argument as the t-shirt sizing passage in the technical note.",
          prompt: "Write the lesson in your own words: what should you always check alongside a validation index before believing it?",
        },
      ],
    },

    {
      id: "agree", title: "Do the methods find the same cities together?", minutes: 4,
      intro: (
        <p style={{ margin: 0 }}>
          The Adjusted Rand Index compares partitions by pairs of cities rather than by labels. Ward is also compared
          against K-Means, which is a completely different family of algorithm.
        </p>
      ),
      render: () => {
        const all = [...METHODS, { id: "kmeans", label: "K-Means" }];
        const labelsOf = (id) => (id === "kmeans" ? km.assign : by[id].labels);
        return (
          <Table
            head={["", ...all.map((m) => m.label)]}
            rows={all.map((r) => [
              <strong>{r.label}</strong>,
              ...all.map((c) => {
                if (r.id === c.id) return <span style={{ color: C.mut }}>—</span>;
                const v = adjustedRand(labelsOf(r.id), labelsOf(c.id));
                return <span style={{ color: v >= 0.7 ? C.good : v >= 0.4 ? C.warn : C.bad }}>{v.toFixed(2)}</span>;
              }),
            ])}
          />
        );
      },
      questions: [
        {
          id: "b4-ari-km", kind: "number", tol: 0.03, answer: +adjustedRand(ward.labels, km.assign).toFixed(2),
          prompt: "Report the Adjusted Rand Index between Ward and K-Means, to two decimal places.",
          hint: "Find the Ward row and the K-Means column.",
          why: "Two methods with nothing in common structurally — one merges to minimise added variance, the other minimises distance to moving centroids — landing on the same grouping is the strongest evidence available that the structure is real.",
        },
        {
          id: "b4-pair", kind: "choice", answer: METHODS.findIndex((m) => m.id === bestPair.a.id),
          prompt: `Among the four linkage methods, ${bestPair.a.label} and ${bestPair.b.label} agree most (ARI ${bestPair.v.toFixed(2)}). Which of these explains it best?`,
          options: METHODS.map((m) =>
            m.id === bestPair.a.id
              ? `Both produce one dominant cluster and a few isolated cities, so they agree about almost every pair by agreeing that almost every pair belongs together`
              : m.id === "ward"
                ? "Ward and the others share the same merge rule"
                : m.id === "complete"
                  ? "They both use the maximum distance between members"
                  : "They were run with the same random seed"),
          hint: "High agreement is not always a good sign. If two methods both put 90% of the cities in one bucket, they agree about almost every pair automatically.",
        },
      ],
    },

    {
      id: "choose", title: "Which would you use?", minutes: 5,
      intro: (
        <p style={{ margin: 0 }}>
          Nothing to submit for this one. But the answer below is exactly the paragraph your homework will need.
        </p>
      ),
      render: () => (
        <Table head={["linkage", "silhouette", "sizes", "would it support four campaigns?"]}
          rows={METHODS.map((m) => {
            const b = by[m.id];
            const usable = b.biggestShare < 0.75 && b.singletons === 0;
            return [
              <strong>{m.label}</strong>, b.metrics.silhouette.toFixed(3), b.sizes.join(" · "),
              <span style={{ color: usable ? C.good : C.bad }}>{usable ? "yes" : "no"}</span>,
            ];
          })} />
      ),
      questions: [
        {
          id: "b4-choice", kind: "text", minWords: 40, rows: 5,
          rubric: "Names one linkage, justifies it with both an index value and the segment sizes, and explicitly rejects the method with the best silhouette on usability grounds. An answer that picks the best silhouette without addressing the sizes has missed the point of the whole activity.",
          prompt: "Which linkage would you use to segment this market, and why? Your answer must use both a validation index and the segment sizes, and must say explicitly why you are not simply taking the method with the best silhouette.",
        },
      ],
    },
  ];
}
