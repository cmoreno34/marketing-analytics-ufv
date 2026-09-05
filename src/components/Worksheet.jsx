/* The guided-activity framework.
 *
 * A worksheet is a list of steps; a step shows something computed from the
 * student's own analysis and asks about it. Numeric and multiple-choice
 * answers are checked immediately — they can be, because the Lab fixes its
 * random seed, so the right answer is the same for everybody.
 *
 * Written answers get formative feedback from Claude, judged against the facts
 * the student's own run produced, so an answer that contradicts its own
 * analysis is caught before it is handed in. It is feedback and an indicative
 * mark, not the grade: the lecturer marks the work, and the wording throughout
 * says so.
 *
 * Work is saved in the browser as it is typed, so a closed tab or a flat
 * laptop in the middle of a class does not cost anyone their answers. */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { C, card, inp } from "../theme.js";
import { Callout, Chip } from "./UI.jsx";
import { snapshot, clearSnapshots } from "./Charts.jsx";
import { reviewAnswers, buildReviewPrompt, ApiError } from "../lib/api.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const KEY = (id) => `mkt.worksheet.${id}`;

function load(id) {
  try {
    return JSON.parse(localStorage.getItem(KEY(id)) || "{}");
  } catch {
    return {};
  }
}

function save(id, data) {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(data));
  } catch {
    /* private window or storage full — the session still works, it just
       will not survive a reload. Not worth interrupting the student for. */
  }
}

const wordCount = (s) => (String(s || "").trim().match(/\S+/g) || []).length;

/* A numeric answer counts if it lands inside the stated tolerance. Students
 * report what the tool shows them, so the tolerance absorbs rounding, not
 * a different method. */
function checkAnswer(q, value) {
  // A question with no stated answer is a genuine choice, not a test — the
  // homework asks which method to take forward, and there is no key for that.
  if (q.answer === undefined) return null;
  if (value === undefined || value === "" || value === null) return null;
  if (q.kind === "number") {
    const v = Number(String(value).replace(",", "."));
    if (!Number.isFinite(v)) return false;
    return Math.abs(v - q.answer) <= (q.tol ?? 0);
  }
  if (q.kind === "choice") return value === q.answer;
  return null;
}

export default function Worksheet({ id, title, subtitle, badge, steps, ctx, reportMeta, rubric, activity, onRestart }) {
  const [state, setState] = useState(() => load(id));
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState({});
  const answers = state.answers || {};
  const identity = state.identity || { name: "", group: "" };

  useEffect(() => { save(id, state); }, [id, state]);

  const setAnswer = useCallback((qid, value) => {
    setState((s) => ({ ...s, answers: { ...(s.answers || {}), [qid]: value } }));
  }, []);
  // Spread from the full default, not from whatever happens to be stored:
  // patching an absent identity would leave the other field undefined and flip
  // its input from controlled to uncontrolled mid-typing.
  const setFeedback = useCallback((fb) => {
    setState((s) => ({ ...s, feedback: fb }));
  }, []);
  const setIdentity = useCallback((patch) => {
    setState((s) => ({ ...s, identity: { name: "", group: "", ...(s.identity || {}), ...patch } }));
  }, []);

  const allQuestions = useMemo(() => steps.flatMap((s) => s.questions || []), [steps]);

  const progress = useMemo(() => {
    let answered = 0, checkable = 0, right = 0;
    for (const q of allQuestions) {
      const v = answers[q.id];
      const filled = q.kind === "text" ? wordCount(v) >= (q.minWords ?? 1) : v !== undefined && v !== "";
      if (filled) answered++;
      const ok = checkAnswer(q, v);
      if (ok !== null) { checkable++; if (ok) right++; }
    }
    return {
      answered, total: allQuestions.length, checkable, right,
      pct: allQuestions.length ? Math.round((answered / allQuestions.length) * 100) : 0,
    };
  }, [allQuestions, answers]);

  const step = steps[current];
  const isLast = current === steps.length - 1;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "system-ui,sans-serif" }}>
      <style>{`::-webkit-scrollbar{width:7px;height:7px;background:transparent}::-webkit-scrollbar-thumb{background:#252836;border-radius:4px}`}</style>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "30px 22px 90px" }}>
        <a href="#/" style={{ color: C.mut, fontSize: 11.5, textDecoration: "none", fontFamily: MONO }}>← all tools</a>

        <div style={{ display: "flex", alignItems: "baseline", gap: 11, margin: "12px 0 6px", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 24, margin: 0, fontWeight: 600 }}>{title}</h1>
          {badge && <span style={{
            fontFamily: MONO, fontSize: 10, color: C.acc, border: `1px solid ${C.acc}66`,
            borderRadius: 4, padding: "3px 8px", letterSpacing: ".08em", textTransform: "uppercase",
          }}>{badge}</span>}
        </div>
        <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.7, maxWidth: 680, margin: "0 0 20px" }}>{subtitle}</p>

        <StepNav steps={steps} current={current} setCurrent={setCurrent} answers={answers} />

        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.acc }}>STEP {current + 1} / {steps.length}</span>
            <h2 style={{ fontSize: 17, margin: 0, fontWeight: 600 }}>{step.title}</h2>
            {step.minutes && <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: C.mut }}>~{step.minutes} min</span>}
          </div>

          {step.intro && <div style={{ fontSize: 13.5, lineHeight: 1.75, color: C.txt, opacity: 0.92, marginBottom: 15 }}>{step.intro}</div>}
          {step.render && <div style={{ margin: "15px 0" }}>{step.render(ctx)}</div>}

          {(step.questions || []).map((q) => (
            <Question key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)}
              revealed={!!revealed[q.id]} reveal={() => setRevealed((r) => ({ ...r, [q.id]: true }))}
              feedback={state.feedback?.items?.[q.id]} />
          ))}

          {step.after && <div style={{ marginTop: 15 }}>{step.after(ctx, answers)}</div>}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}
            style={navBtn(current !== 0)}>← Back</button>
          {!isLast && (
            <button onClick={() => { setCurrent((c) => Math.min(steps.length - 1, c + 1)); window.scrollTo(0, 0); }}
              style={{ ...navBtn(true), background: C.acc, color: "#0d0f14", border: `1px solid ${C.acc}`, fontWeight: 600 }}>
              Next step →
            </button>
          )}
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 11, color: C.mut }}>
            {progress.answered} of {progress.total} answered
          </span>
        </div>

        {isLast && (
          <Finish id={id} title={title} steps={steps} answers={answers} progress={progress}
            identity={identity} setIdentity={setIdentity} ctx={ctx} reportMeta={reportMeta}
            rubric={rubric} feedback={state.feedback} setFeedback={setFeedback} activity={activity ?? title}
            onRestart={() => { clearSnapshots(); setState({}); setCurrent(0); setRevealed({}); onRestart?.(); }} />
        )}

        <p style={{ color: C.mut, fontSize: 11, marginTop: 34, lineHeight: 1.7, borderTop: `1px solid ${C.bord}`, paddingTop: 15 }}>
          Your answers are saved in this browser as you type — you can close the tab and come back.
          Nothing is uploaded. Clearing your browser data, or using a different computer, loses them,
          so download the report when you finish.
        </p>
      </div>
    </div>
  );
}

const navBtn = (enabled) => ({
  background: C.surf, color: enabled ? C.txt : C.mut, border: `1px solid ${C.bord}`,
  borderRadius: 6, padding: "9px 17px", fontSize: 13, cursor: enabled ? "pointer" : "not-allowed",
  opacity: enabled ? 1 : 0.5, fontFamily: "system-ui",
});

function StepNav({ steps, current, setCurrent, answers }) {
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {steps.map((s, i) => {
        const qs = s.questions || [];
        const done = qs.length > 0 && qs.every((q) => {
          const v = answers[q.id];
          return q.kind === "text" ? wordCount(v) >= (q.minWords ?? 1) : v !== undefined && v !== "";
        });
        const active = i === current;
        return (
          <button key={s.id} onClick={() => { setCurrent(i); window.scrollTo(0, 0); }} title={s.title}
            style={{
              background: active ? C.acc : done ? `${C.good}22` : C.surf,
              color: active ? "#0d0f14" : done ? C.good : C.mut,
              border: `1px solid ${active ? C.acc : done ? `${C.good}55` : C.bord}`,
              borderRadius: 5, padding: "5px 10px", fontFamily: MONO, fontSize: 11,
              cursor: "pointer", fontWeight: active ? 700 : 400,
            }}>
            {done && !active ? "✓ " : ""}{i + 1}
          </button>
        );
      })}
    </div>
  );
}

const BANDS = {
  strong: { color: "good", label: "strong" },
  adequate: { color: "acc", label: "adequate" },
  "needs work": { color: "warn", label: "needs work" },
  "not attempted": { color: "bad", label: "not attempted" },
};

/* Feedback on one written answer, shown under the box it belongs to so the
 * student can act on it without scrolling to a summary and back. */
function AnswerFeedback({ fb }) {
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

function Question({ q, value, onChange, revealed, reveal, feedback }) {
  const ok = checkAnswer(q, value);
  const showFeedback = ok !== null && value !== undefined && value !== "";

  return (
    <div style={{
      background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8,
      padding: "13px 15px", marginTop: 13,
    }}>
      <div style={{ fontSize: 13.5, lineHeight: 1.65, marginBottom: 10 }}>
        {q.prompt}
        {q.kind !== "text" && q.answer !== undefined && (
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.mut, marginLeft: 8 }}>auto-checked</span>
        )}
      </div>

      {q.kind === "number" && (
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <input type="text" inputMode="decimal" value={value ?? ""} placeholder={q.placeholder || "your answer"}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...inp, width: 150, borderColor: showFeedback ? (ok ? C.good : C.bad) : C.bord }} />
          {q.unit && <span style={{ fontSize: 12, color: C.mut }}>{q.unit}</span>}
          {showFeedback && <Verdict ok={ok} />}
        </div>
      )}

      {q.kind === "choice" && (
        <div style={{ display: "grid", gap: 7 }}>
          {q.options.map((opt, i) => {
            const selected = value === i;
            return (
              <button key={i} onClick={() => onChange(i)}
                style={{
                  textAlign: "left", background: selected ? (ok ? `${C.good}18` : `${C.bad}18`) : C.card,
                  border: `1px solid ${selected ? (ok ? C.good : C.bad) : C.bord}`,
                  borderRadius: 6, padding: "9px 12px", fontSize: 12.8, lineHeight: 1.55,
                  color: C.txt, cursor: "pointer", fontFamily: "system-ui",
                }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.mut, marginRight: 8 }}>
                  {"abcdefgh"[i]}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {q.kind === "text" && (
        <>
          <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={q.rows || 4}
            placeholder={q.placeholder || ""}
            style={{
              width: "100%", background: C.card, border: `1px solid ${C.bord}`, color: C.txt,
              borderRadius: 6, padding: "9px 11px", fontSize: 13, fontFamily: "system-ui",
              lineHeight: 1.6, resize: "vertical", outline: "none",
            }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
            <span style={{ fontSize: 11, color: C.mut }}>
              {q.minWords ? `at least ${q.minWords} words — this one is marked by your lecturer, not here` : "marked by your lecturer"}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: wordCount(value) >= (q.minWords ?? 0) ? C.good : C.mut }}>
              {wordCount(value)} words
            </span>
          </div>
        </>
      )}

      {showFeedback && !ok && q.hint && (
        <div style={{ marginTop: 10 }}>
          {revealed
            ? <div style={{ fontSize: 12.5, color: C.warn, lineHeight: 1.6 }}>{q.hint}</div>
            : <button onClick={reveal} style={{
                background: "transparent", color: C.warn, border: `1px solid ${C.warn}55`,
                borderRadius: 5, padding: "4px 10px", fontSize: 11.5, cursor: "pointer",
              }}>Show a hint</button>}
        </div>
      )}
      {showFeedback && ok && q.why && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: C.mut, lineHeight: 1.6 }}>{q.why}</div>
      )}
      {q.kind === "text" && <AnswerFeedback fb={feedback} />}
    </div>
  );
}

const Verdict = ({ ok }) => (
  <span style={{ fontSize: 12.5, color: ok ? C.good : C.bad, fontWeight: 600 }}>
    {ok ? "✓ correct" : "not yet"}
  </span>
);

function Finish({ id, title, steps, answers, progress, identity, setIdentity, ctx, reportMeta,
                 rubric, feedback, setFeedback, activity, onRestart }) {
  const [busy, setBusy] = useState(false);
  const missing = progress.total - progress.answered;

  const build = useCallback(() => buildReport({ title, steps, answers, identity, ctx, reportMeta, progress, feedback }),
    [title, steps, answers, identity, ctx, reportMeta, progress, feedback]);

  const openReport = () => {
    setBusy(true);
    try {
      const blob = new Blob([build()], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      // Pop-up blocked: fall back to a download so the work is never trapped.
      if (!w) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug(title)}_report.html`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally { setBusy(false); }
  };

  const downloadReport = () => {
    const blob = new Blob([build()], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug(title)}_${slug(identity.name || "report")}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };

  return (
    <div style={{ ...card, marginTop: 18, borderColor: `${C.acc}55` }}>
      <h2 style={{ fontSize: 17, margin: "0 0 6px" }}>Finish and hand in</h2>
      <p style={{ fontSize: 13, color: C.mut, lineHeight: 1.7, margin: "0 0 15px" }}>
        The report collects your answers, the parameters you used and the charts you produced, on one page.
        Open it and print to PDF, then upload that to Canvas.
      </p>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", marginBottom: 15 }}>
        <label>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", display: "block", marginBottom: 5 }}>your name</span>
          <input value={identity.name} onChange={(e) => setIdentity({ name: e.target.value })} style={inp} placeholder="Name and surname" />
        </label>
        <label>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px", display: "block", marginBottom: 5 }}>group</span>
          <input value={identity.group} onChange={(e) => setIdentity({ group: e.target.value })} style={inp} placeholder="Group number or name" />
        </label>
      </div>

      <CompletenessMeter progress={progress} />

      <Review steps={steps} answers={answers} ctx={ctx} reportMeta={reportMeta} rubric={rubric}
        activity={activity} feedback={feedback} setFeedback={setFeedback} />

      {missing > 0 && (
        <Callout tone="warn">
          {missing} question{missing === 1 ? " is" : "s are"} still unanswered. You can hand in anyway, but the
          report will show the gaps.
        </Callout>
      )}

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 14 }}>
        <button onClick={openReport} disabled={busy} style={{
          background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6,
          padding: "10px 19px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>Open the report (print to PDF)</button>
        <button onClick={downloadReport} style={{
          background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 6,
          padding: "10px 17px", fontSize: 13, cursor: "pointer",
        }}>Download it</button>
        <button onClick={() => { if (confirm("Delete every answer and start again?")) onRestart(); }}
          style={{
            background: "transparent", color: C.mut, border: `1px solid ${C.bord}`, borderRadius: 6,
            padding: "10px 15px", fontSize: 12.5, cursor: "pointer", marginLeft: "auto",
          }}>Start again</button>
      </div>
    </div>
  );
}

/* Formative feedback on the written answers.
 *
 * One request carries every written answer plus the facts the student's own
 * analysis produced, which is what lets the feedback say "you wrote 0.4 but
 * your silhouette was 0.251". One call per attempt rather than one per answer:
 * cheaper, and feedback written with the whole submission in view is better. */
function Review({ steps, answers, ctx, reportMeta, rubric, activity, feedback, setFeedback }) {
  const [state, setState] = useState({ status: "idle" });
  const [showPrompt, setShowPrompt] = useState(false);

  const written = useMemo(() => steps
    .flatMap((s) => s.questions || [])
    .filter((q) => q.kind === "text")
    .map((q) => ({ id: q.id, prompt: stripTags(q.prompt), rubric: q.rubric, answer: answers[q.id] || "" })),
    [steps, answers]);

  const attempted = written.filter((w) => wordCount(w.answer) >= 5);
  const context = reportMeta ? reportMeta(ctx) : [];
  const prompt = buildReviewPrompt({ activity, context, rubric, answers: written });

  async function run() {
    setState({ status: "loading" });
    try {
      const data = await reviewAnswers({ activity, context, rubric, answers: written });
      // Index by question id so each answer can show its own feedback in place.
      const items = {};
      for (const it of data.items ?? []) items[it.id] = it;
      setFeedback({ items, overall: data.overall, at: new Date().toISOString() });
      setState({ status: "done" });
    } catch (e) {
      setState({ status: "error", error: e instanceof ApiError ? e : new ApiError(e.message) });
    }
  }

  return (
    <div style={{ marginTop: 15, background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, letterSpacing: "1.1px", textTransform: "uppercase", marginBottom: 8 }}>
        feedback on your written answers
      </div>
      <p style={{ fontSize: 12.8, color: C.mut, lineHeight: 1.65, margin: "0 0 12px" }}>
        Claude reads your written answers against what your own analysis actually produced, and tells you what is
        missing before you hand in. It is feedback, not your grade — your lecturer marks the work.
      </p>

      <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={run} disabled={state.status === "loading" || !attempted.length}
          style={{
            background: attempted.length ? C.acc : C.card, color: attempted.length ? "#0d0f14" : C.mut,
            border: `1px solid ${attempted.length ? C.acc : C.bord}`, borderRadius: 6,
            padding: "9px 17px", fontSize: 12.5, fontWeight: 600,
            cursor: attempted.length && state.status !== "loading" ? "pointer" : "not-allowed",
          }}>
          {feedback ? "Check again" : "Check my written answers"}
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
            <div style={{
              background: C.card, border: `1px solid ${C.bord}`, borderRadius: 7, padding: "9px 15px",
            }}>
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
          <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, marginTop: 11 }}>
            The feedback on each answer is shown next to that answer — go back through the steps to read it.
            It is included in your report.
          </p>
        </div>
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

/* Completeness, stated as completeness. It is deliberately NOT called a grade
 * and deliberately NOT a percentage out of ten: it counts what has been done
 * and how many auto-checked answers are right, and says plainly that the
 * written work — where the marks actually are — is not judged here. */
function CompletenessMeter({ progress }) {
  const donePct = progress.total ? (progress.answered / progress.total) * 100 : 0;
  const rightPct = progress.checkable ? (progress.right / progress.checkable) * 100 : 0;
  const bar = (pct, col) => (
    <span style={{ display: "block", height: 6, background: C.bord, borderRadius: 3, overflow: "hidden", marginTop: 5 }}>
      <span style={{ display: "block", width: `${pct}%`, height: "100%", background: col }} />
    </span>
  );
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "13px 15px" }}>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, letterSpacing: "1.1px", textTransform: "uppercase", marginBottom: 10 }}>
        completeness check — not a grade
      </div>
      <div style={{ display: "grid", gap: 13, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
        <div>
          <span style={{ fontSize: 12.5 }}>Answered <strong>{progress.answered}</strong> of {progress.total}</span>
          {bar(donePct, C.acc)}
        </div>
        <div>
          <span style={{ fontSize: 12.5 }}>
            Auto-checked answers right: <strong>{progress.right}</strong> of {progress.checkable}
          </span>
          {bar(rightPct, rightPct >= 80 ? C.good : rightPct >= 50 ? C.warn : C.bad)}
        </div>
      </div>
      <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, margin: "11px 0 0" }}>
        This counts what you have filled in and how many of the numeric answers match. It says nothing about
        the quality of your written reasoning, which is where most of the marks are and which only your
        lecturer can judge.
      </p>
    </div>
  );
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nl2p = (s) => esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

/* The report. A plain white page that prints cleanly to PDF — this is the
 * thing the student actually hands in, so it carries the parameters needed to
 * reproduce the analysis, not just the conclusions. */
function buildReport({ title, steps, answers, identity, ctx, reportMeta, progress, feedback }) {
  const now = new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });
  const meta = reportMeta ? reportMeta(ctx) : [];

  const body = steps.map((s, i) => {
    const qs = (s.questions || []).map((q) => {
      const v = answers[q.id];
      const ok = checkAnswer(q, v);
      const given = q.kind === "choice"
        ? (v === undefined || v === "" ? "" : `${"abcdefgh"[v]}) ${q.options[v]}`)
        : v;
      const empty = given === undefined || given === "" || given === null;
      const mark = ok === null ? "" : ok
        ? '<span class="ok">correct</span>'
        : `<span class="no">not correct — expected ${q.kind === "number" ? q.answer : `${"abcdefgh"[q.answer]}) ${q.options[q.answer]}`}</span>`;
      const fb = feedback?.items?.[q.id];
      const fbBlock = fb ? `<div class="fb"><b>Feedback (${esc(fb.band)}).</b> ${esc(fb.feedback)}${
        fb.missing?.length ? `<ul>${fb.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""
      }</div>` : "";
      return `<div class="q">
        <div class="prompt">${esc(stripTags(q.prompt))}</div>
        ${empty ? '<div class="empty">not answered</div>' : `<div class="ans">${nl2p(given)}</div>`}
        ${mark ? `<div class="mark">${mark}</div>` : ""}
        ${fbBlock}
      </div>`;
    }).join("");

    const shots = (s.capture || []).map((cid) => {
      const url = snapshot(cid);
      return url ? `<figure><img src="${url}" alt=""></figure>` : "";
    }).join("");

    return `<section>
      <h2>${i + 1}. ${esc(s.title)}</h2>
      ${shots}
      ${qs}
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} — ${esc(identity.name || "report")}</title>
<style>
 @page { margin: 18mm; }
 body { font-family: Georgia,'Times New Roman',serif; max-width: 46em; margin: 2.5em auto; padding: 0 1.5em;
        line-height: 1.6; color: #1a1a1a; }
 h1 { font-size: 1.55em; margin: 0 0 .15em; }
 .sub { color: #666; font-size: .92em; margin: 0 0 1.6em; }
 .meta { border: 1px solid #ddd; border-radius: 5px; padding: .8em 1em; margin-bottom: 2em;
         font-size: .87em; color: #333; }
 .meta b { color: #000; }
 .meta div { margin: .15em 0; }
 section { margin: 0 0 2em; page-break-inside: avoid; }
 h2 { font-size: 1.08em; border-bottom: 1px solid #ddd; padding-bottom: .3em; margin: 0 0 .8em; }
 .q { margin: 0 0 1.1em; }
 .prompt { font-weight: bold; font-size: .95em; margin-bottom: .35em; }
 .ans { background: #f7f7f7; border-left: 3px solid #bbb; padding: .55em .9em; font-size: .95em; }
 .ans p { margin: .35em 0; }
 .empty { color: #a00; font-style: italic; font-size: .9em; }
 .mark { font-size: .84em; margin-top: .3em; }
 .ok { color: #0a7d3f; } .no { color: #a00; }
 .fb { border-left: 3px solid #b9891f; background: #fdf9f0; padding: .5em .9em; margin-top: .45em;
       font-size: .88em; color: #4a3c1d; }
 .fb ul { margin: .35em 0 0; padding-left: 1.2em; }
 .overall { border: 1px solid #ddd; border-left: 3px solid #b9891f; border-radius: 5px;
            padding: .9em 1.1em; margin: 0 0 2em; font-size: .9em; }
 .overall h3 { margin: 0 0 .4em; font-size: 1em; }
 .prov { color: #777; font-size: .85em; }
 figure { margin: 0 0 1em; } img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; }
 footer { border-top: 1px solid #ddd; margin-top: 2.5em; padding-top: .8em; font-size: .8em; color: #777; }
 @media print { body { margin: 0; max-width: none; } .noprint { display: none; } }
</style></head><body>
<h1>${esc(title)}</h1>
<p class="sub">${esc(identity.name || "—")}${identity.group ? ` · group ${esc(identity.group)}` : ""} · ${now}</p>
<div class="meta">
  ${meta.map((m) => `<div><b>${esc(m[0])}:</b> ${esc(m[1])}</div>`).join("")}
  <div><b>Answered:</b> ${progress.answered} of ${progress.total} · auto-checked correct: ${progress.right} of ${progress.checkable}</div>
</div>
${feedback?.overall ? `<div class="overall">
  <h3>Feedback on the written answers</h3>
  <p>${esc(feedback.overall.comment)}</p>
  ${feedback.overall.strengths?.length ? `<p><b>Working well:</b> ${feedback.overall.strengths.map(esc).join("; ")}</p>` : ""}
  ${feedback.overall.gaps?.length ? `<p><b>To improve:</b> ${feedback.overall.gaps.map(esc).join("; ")}</p>` : ""}
  <p class="prov">Indicative mark ${Number(feedback.overall.indicative_mark).toFixed(1)} / 10 — generated as formative
  guidance before submission. It is not a grade; the lecturer marks this work.</p>
</div>` : ""}
${body}
<footer>
  Produced with the Marketing Analytics Segmentation Lab
  (cmoreno34.github.io/marketing-analytics-ufv). The parameters above are what makes this analysis
  reproducible — anyone entering the same values gets the same numbers.
</footer>
</body></html>`;
}

function stripTags(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(stripTags).join("");
  if (node.props?.children) return stripTags(node.props.children);
  return "";
}
