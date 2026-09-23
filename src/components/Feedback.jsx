/* Formative feedback on written answers.
 *
 * One request carries every written answer plus the facts the student's own
 * run produced, so an answer that contradicts its own analysis is caught
 * before it is handed in. One call per attempt rather than one per answer:
 * cheaper, and feedback written with the whole submission in view is better.
 *
 * Shared by the step-based worksheets and by the case study — the panel takes
 * the answers directly rather than reaching into a `steps` structure, so it
 * does not care how they were collected.
 */

import { useState } from "react";
import { C } from "../theme.js";
import { Callout, Chip } from "./UI.jsx";
import { reviewAnswers, buildReviewPrompt, ApiError } from "../lib/api.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const BANDS = {
  strong: { color: "good", label: "strong" },
  adequate: { color: "acc", label: "adequate" },
  "needs work": { color: "warn", label: "needs work" },
  "not attempted": { color: "bad", label: "not attempted" },
};

export const wordCount = (s) => (String(s || "").trim().match(/\S+/g) || []).length;

/* Feedback on one answer, shown under the box it belongs to so the student can
 * act on it without scrolling to a summary and back. */
export function AnswerFeedback({ fb }) {
  if (!fb) return null;
  const band = BANDS[fb.band] ?? BANDS.adequate;
  const col = C[band.color] ?? C.acc;
  return (
    <div style={{
      marginTop: 11, background: `${col}10`, border: `1px solid ${col}44`,
      borderLeft: `3px solid ${col}`, borderRadius: 6, padding: "10px 13px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: col, letterSpacing: ".8px", textTransform: "uppercase" }}>
          feedback · {band.label}
        </span>
      </div>
      <div style={{ fontSize: 12.8, lineHeight: 1.65, color: C.txt, opacity: 0.93 }}>{fb.feedback}</div>
      {fb.missing?.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.3, lineHeight: 1.6, color: C.mut }}>
          {fb.missing.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
    </div>
  );
}

function Bullets({ title, items, color }) {
  if (!items?.length) return null;
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 9.5, color, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 17, fontSize: 12.5, lineHeight: 1.65, color: C.txt, opacity: 0.9 }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}

function Spin({ label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.mut, fontSize: 12 }}>
      <span style={{
        width: 12, height: 12, border: `2px solid ${C.bord}`, borderTopColor: C.acc,
        borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite",
      }} />
      {label}
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </span>
  );
}

/* @param written  [{ id, prompt, rubric, answer }]
 * @param context  [[label, value]] — the facts the student's own run produced */
export function ReviewPanel({ written, context = [], rubric, activity, feedback, setFeedback, intro }) {
  const [state, setState] = useState({ status: "idle" });
  const [showPrompt, setShowPrompt] = useState(false);

  const attempted = written.filter((w) => wordCount(w.answer) >= 5);
  const prompt = buildReviewPrompt({ activity, context, rubric, answers: written });

  async function run() {
    setState({ status: "loading" });
    try {
      const data = await reviewAnswers({ activity, context, rubric, answers: written });
      const items = {};
      for (const it of data.items ?? []) items[it.id] = it;
      setFeedback({ items, overall: data.overall, at: new Date().toISOString() });
      setState({ status: "done" });
    } catch (e) {
      setState({ status: "error", error: e instanceof ApiError ? e : new ApiError(e.message) });
    }
  }

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, letterSpacing: "1.1px", textTransform: "uppercase", marginBottom: 8 }}>
        feedback on your written answers
      </div>
      <p style={{ fontSize: 12.8, color: C.mut, lineHeight: 1.65, margin: "0 0 12px" }}>
        {intro ?? "Claude reads your answers against what your own analysis actually produced, and tells you what is missing before you hand in. It is feedback, not your grade — your lecturer marks the work."}
      </p>

      <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={run} disabled={state.status === "loading" || !attempted.length}
          style={{
            background: attempted.length ? C.acc : C.card, color: attempted.length ? "#0d0f14" : C.mut,
            border: `1px solid ${attempted.length ? C.acc : C.bord}`, borderRadius: 6,
            padding: "9px 17px", fontSize: 12.5, fontWeight: 600,
            cursor: attempted.length && state.status !== "loading" ? "pointer" : "not-allowed",
          }}>
          {feedback ? "Check again" : "Check my answers"}
        </button>
        <Chip active={showPrompt} onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? "Hide" : "Show"} the prompt
        </Chip>
        {state.status === "loading" && <Spin label="Reading your answers…" />}
        {!attempted.length && <span style={{ fontSize: 12, color: C.warn }}>Write some answers first.</span>}
      </div>

      {showPrompt && (
        <textarea readOnly value={prompt} rows={10} style={{
          width: "100%", marginTop: 11, background: "#0d0f14", border: `1px solid ${C.bord}`, color: C.mut,
          borderRadius: 6, padding: 11, fontSize: 11.5, fontFamily: MONO, lineHeight: 1.55, resize: "vertical",
        }} />
      )}

      {state.status === "error" && (
        <Callout tone={state.error.kind === "quota" ? "warn" : "bad"}
          title={state.error.kind === "quota" ? "Daily quota reached" : "Could not get feedback"}>
          {state.error.message}
          <div style={{ marginTop: 7 }}>
            Use <strong>Show the prompt</strong>, copy it into Claude or ChatGPT, and you get the same feedback.
            Your answers and your report are unaffected.
          </div>
        </Callout>
      )}

      {feedback?.overall && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 11, flexWrap: "wrap", alignItems: "center", marginBottom: 11 }}>
            <div style={{ background: C.card, border: `1px solid ${C.bord}`, borderRadius: 7, padding: "9px 15px" }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.mut, textTransform: "uppercase", letterSpacing: "1px" }}>
                indicative only — not your grade
              </div>
              <div style={{ fontSize: 21, fontWeight: 600, color: C.txt, marginTop: 2 }}>
                {Number(feedback.overall.indicative_mark).toFixed(1)}<span style={{ fontSize: 13, color: C.mut }}> / 10</span>
              </div>
            </div>
            <p style={{ fontSize: 12.8, color: C.txt, opacity: 0.9, lineHeight: 1.65, margin: 0, flex: "1 1 260px" }}>
              {feedback.overall.comment}
            </p>
          </div>
          <div style={{ display: "grid", gap: 11, gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
            <Bullets title="What is working" items={feedback.overall.strengths} color={C.good} />
            <Bullets title="What to fix before handing in" items={feedback.overall.gaps} color={C.warn} />
          </div>
        </div>
      )}
    </div>
  );
}
