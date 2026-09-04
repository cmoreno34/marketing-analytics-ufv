/* The AI reading of a segmentation.
 *
 * Deliberately placed AFTER the centroid table in the page, never before it.
 * Naming a segment from its centroids is the skill this module assesses; the
 * assistant is there to argue with, not to substitute for the student. The
 * "show the prompt" control exists for the same reason — the request is
 * ordinary text built from the table, and seeing it demystifies the result. */

import { useState } from "react";
import { C, clusterStyle, card } from "../theme.js";
import { Callout, Spinner, Chip } from "./UI.jsx";
import { interpretSegments, buildInterpretPrompt, ApiError } from "../lib/api.js";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default function Interpret({ payload }) {
  const [state, setState] = useState({ status: "idle" });
  const [context, setContext] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const prompt = buildInterpretPrompt({ ...payload, context });

  async function run() {
    setState({ status: "loading" });
    try {
      const data = await interpretSegments({ ...payload, context });
      setState({ status: "done", data });
    } catch (e) {
      setState({ status: "error", error: e instanceof ApiError ? e : new ApiError(e.message) });
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); } catch { /* clipboard blocked; textarea below is selectable */ }
  };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: C.mut, lineHeight: 1.65, margin: "0 0 12px" }}>
        Write your own reading of the centroid table first — that is what you are marked on. Then run this and
        argue with it. Where it disagrees with you is the interesting part of your report.
      </p>

      <label style={{ display: "block", marginBottom: 10 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px" }}>
          business context (optional, but it changes the answer a lot)
        </span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
          placeholder="e.g. Poke bowl chain expanding in Madrid. Survey of 40 respondents on price sensitivity and adventurousness."
          style={{
            width: "100%", marginTop: 5, background: C.surf, border: `1px solid ${C.bord}`, color: C.txt,
            borderRadius: 6, padding: "8px 10px", fontSize: 12, fontFamily: "system-ui", resize: "vertical", outline: "none",
          }}
        />
      </label>

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={run} disabled={state.status === "loading"}
          style={{
            background: C.acc, color: "#0d0f14", border: "none", borderRadius: 6, padding: "8px 15px",
            fontSize: 12.5, fontWeight: 600, cursor: state.status === "loading" ? "wait" : "pointer",
          }}>
          {state.status === "done" ? "Run again" : "Read the segments"}
        </button>
        <Chip active={showPrompt} onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? "Hide" : "Show"} the prompt
        </Chip>
        {state.status === "loading" && <Spinner label="Reading the centroid table…" />}
      </div>

      {showPrompt && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: "1.1px" }}>
              exact request sent
            </span>
            <button onClick={copy} style={{
              background: C.surf, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 4,
              padding: "3px 9px", fontSize: 11, cursor: "pointer",
            }}>Copy</button>
            <span style={{ fontSize: 11, color: C.mut }}>— paste it into Claude or ChatGPT if the service is unavailable</span>
          </div>
          <textarea readOnly value={prompt} rows={12} style={{
            width: "100%", background: "#0d0f14", border: `1px solid ${C.bord}`, color: C.mut,
            borderRadius: 6, padding: 11, fontSize: 11.5, fontFamily: MONO, lineHeight: 1.55, resize: "vertical",
          }} />
        </div>
      )}

      {state.status === "error" && (
        <Callout tone={state.error.kind === "quota" ? "warn" : "bad"} title={state.error.kind === "quota" ? "Daily quota reached" : "Service unavailable"}>
          {state.error.message}
          <div style={{ marginTop: 7 }}>
            Use <strong>Show the prompt</strong> above, copy it, and paste it into Claude or ChatGPT — you get the
            same analysis, and it costs the course nothing.
          </div>
        </Callout>
      )}

      {state.status === "done" && <Personas data={state.data} />}
    </div>
  );
}

function Personas({ data }) {
  const segments = data?.segments ?? [];
  return (
    <div style={{ marginTop: 15 }}>
      <div style={{ display: "grid", gap: 11, gridTemplateColumns: "repeat(auto-fit,minmax(268px,1fr))" }}>
        {segments.map((s, i) => {
          const col = clusterStyle(s.cluster ? s.cluster - 1 : i).color;
          return (
            <div key={i} style={{ ...card, background: C.surf, borderTop: `3px solid ${col}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                <span style={{ fontFamily: MONO, fontSize: 10, color: col }}>SEGMENT {s.cluster ?? i + 1}</span>
                {s.confidence && (
                  <span style={{
                    marginLeft: "auto", fontSize: 9.5, fontFamily: MONO, color: C.mut,
                    border: `1px solid ${C.bord}`, borderRadius: 3, padding: "1px 5px",
                  }}>{String(s.confidence).toUpperCase()}</span>
                )}
              </div>
              <h3 style={{ margin: "0 0 7px", fontSize: 15, color: C.txt }}>{s.name}</h3>
              <p style={{ margin: "0 0 10px", fontSize: 12.5, color: C.txt, lineHeight: 1.65, opacity: 0.9 }}>{s.description}</p>
              {s.distinguishing_variable && (
                <p style={{ margin: "0 0 8px", fontSize: 11.5, color: C.mut, lineHeight: 1.5 }}>
                  Most distinguishing variable: <span style={{ color: C.txt }}>{s.distinguishing_variable}</span>
                </p>
              )}
              <div style={{ borderTop: `1px solid ${C.bord}`, paddingTop: 9 }}>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.mut, letterSpacing: "1px" }}>ACTION</span>
                <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.txt, lineHeight: 1.6 }}>{s.recommendation}</p>
              </div>
            </div>
          );
        })}
      </div>

      {data?.attractiveness && (
        <Callout tone="info" title="Which segments are worth targeting">{data.attractiveness}</Callout>
      )}
      {data?.warnings && (
        <Callout tone="warn" title="Possible artefacts of the algorithm">{data.warnings}</Callout>
      )}
      <p style={{ fontSize: 11, color: C.mut, marginTop: 11, lineHeight: 1.6 }}>
        Generated by Claude from the centroid table above. It has seen the numbers, not your case study —
        verify every claim against the data before it goes in your report.
      </p>
    </div>
  );
}
