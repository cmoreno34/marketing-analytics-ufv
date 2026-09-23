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
import { AnswerFeedback, ReviewPanel, wordCount } from "./Feedback.jsx";
import { esc, nl2p, stripTags, slug, reportShell, answerBlock, figure as figureHtml } from "../lib/report.js";

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

      <div style={{ marginTop: 15 }}>
        <ReviewPanel
          written={steps.flatMap((s) => s.questions || []).filter((q) => q.kind === "text")
            .map((q) => ({ id: q.id, prompt: stripTags(q.prompt), rubric: q.rubric, answer: answers[q.id] || "" }))}
          context={reportMeta ? reportMeta(ctx) : []}
          rubric={rubric} activity={activity} feedback={feedback} setFeedback={setFeedback} />
        <p style={{ fontSize: 11.5, color: C.mut, lineHeight: 1.6, marginTop: 11 }}>
          The feedback on each answer is shown next to that answer — go back through the steps to read it.
          It is included in your report.
        </p>
      </div>

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

/* The report the student hands in. The document shell, the answer blocks and
 * the feedback block are shared with the case study; only the body differs. */
function buildReport({ title, steps, answers, identity, ctx, reportMeta, progress, feedback }) {
  const body = steps.map((s, i) => {
    const qs = (s.questions || []).map((q) => {
      const v = answers[q.id];
      const ok = checkAnswer(q, v);
      const given = q.kind === "choice"
        ? (v === undefined || v === "" ? "" : `${"abcdefgh"[v]}) ${q.options[v]}`)
        : v;
      const mark = ok === null ? "" : ok
        ? '<span class="ok">correct</span>'
        : `<span class="no">not correct — expected ${q.kind === "number" ? q.answer : `${"abcdefgh"[q.answer]}) ${q.options[q.answer]}`}</span>`;
      return answerBlock({ prompt: q.prompt, answer: given, feedback: feedback?.items?.[q.id], mark });
    }).join("");

    const shots = (s.capture || []).map((cid) => figureHtml(snapshot(cid))).join("");
    return `<section><h2>${i + 1}. ${esc(s.title)}</h2>${shots}${qs}</section>`;
  }).join("");

  return reportShell({
    title, identity, metaRows: reportMeta ? reportMeta(ctx) : [], feedback, body,
    note: `Answered: ${progress.answered} of ${progress.total} · auto-checked correct: ${progress.right} of ${progress.checkable}`,
  });
}

