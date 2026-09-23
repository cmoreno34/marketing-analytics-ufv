/* The printable report.
 *
 * A plain white page that prints cleanly to PDF. This is the thing a student
 * actually hands in, so it carries the parameters needed to reproduce the
 * analysis and not only the conclusions: anyone entering the same variables,
 * the same k and the same seed must get the same numbers back.
 *
 * Shared by the step-based worksheets and by the case study, which build
 * different bodies but the same document around them.
 */

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const nl2p = (s) =>
  esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

export const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

/* React nodes are used for question prompts so they can carry emphasis; the
 * report needs them as plain text. */
export function stripTags(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(stripTags).join("");
  if (node.props?.children) return stripTags(node.props.children);
  return "";
}

const CSS = `
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
 h3 { font-size: .98em; margin: 1.2em 0 .5em; }
 .q { margin: 0 0 1.3em; }
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
 figcaption { font-size: .82em; color: #666; margin-top: .3em; }
 table { border-collapse: collapse; width: 100%; font-size: .84em; margin: .5em 0 1em; }
 th, td { border: 1px solid #ddd; padding: .35em .55em; text-align: right; }
 th:first-child, td:first-child { text-align: left; }
 th { background: #f2f2f2; font-weight: bold; }
 footer { border-top: 1px solid #ddd; margin-top: 2.5em; padding-top: .8em; font-size: .8em; color: #777; }
 @media print { body { margin: 0; max-width: none; } .noprint { display: none; } }
`;

export function feedbackBlock(feedback) {
  if (!feedback?.overall) return "";
  const o = feedback.overall;
  return `<div class="overall">
  <h3>Feedback on the written answers</h3>
  <p>${esc(o.comment)}</p>
  ${o.strengths?.length ? `<p><b>Working well:</b> ${o.strengths.map(esc).join("; ")}</p>` : ""}
  ${o.gaps?.length ? `<p><b>To improve:</b> ${o.gaps.map(esc).join("; ")}</p>` : ""}
  <p class="prov">Indicative mark ${Number(o.indicative_mark).toFixed(1)} / 10 — generated as formative
  guidance before submission. It is not a grade; the lecturer marks this work.</p>
</div>`;
}

/* One written answer, with whatever feedback it received. */
export function answerBlock({ prompt, answer, feedback, mark }) {
  const empty = answer === undefined || answer === "" || answer === null;
  const fb = feedback
    ? `<div class="fb"><b>Feedback (${esc(feedback.band)}).</b> ${esc(feedback.feedback)}${
        feedback.missing?.length
          ? `<ul>${feedback.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
          : ""
      }</div>`
    : "";
  return `<div class="q">
    <div class="prompt">${esc(stripTags(prompt))}</div>
    ${empty ? '<div class="empty">not answered</div>' : `<div class="ans">${nl2p(answer)}</div>`}
    ${mark ? `<div class="mark">${mark}</div>` : ""}
    ${fb}
  </div>`;
}

export function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export function figure(dataUrl, caption) {
  if (!dataUrl) return "";
  return `<figure><img src="${dataUrl}" alt="">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}</figure>`;
}

export function reportShell({ title, identity = {}, metaRows = [], feedback, body, note }) {
  const now = new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} — ${esc(identity.name || "report")}</title>
<style>${CSS}</style></head><body>
<h1>${esc(title)}</h1>
<p class="sub">${esc(identity.name || "—")}${identity.group ? ` · group ${esc(identity.group)}` : ""} · ${now}</p>
<div class="meta">
  ${metaRows.map((m) => `<div><b>${esc(m[0])}:</b> ${esc(m[1])}</div>`).join("")}
  ${note ? `<div>${esc(note)}</div>` : ""}
</div>
${feedbackBlock(feedback)}
${body}
<footer>
  Produced with the Marketing Analytics Segmentation Lab
  (cmoreno34.github.io/marketing-analytics-ufv). The parameters above are what makes this analysis
  reproducible — anyone entering the same values gets the same numbers.
</footer>
</body></html>`;
}

/* Opens the report in a new tab and calls up the print dialogue, which is
 * where the student saves it as PDF. A blocked pop-up is the common failure,
 * so the caller is told to offer the download instead. */
export function openForPrint(html) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  // Give the images in the document a moment to decode before the dialogue
  // freezes the page, otherwise the first print can come out with gaps.
  setTimeout(() => { try { w.print(); } catch { /* user can print manually */ } }, 700);
  return true;
}

export function downloadHtml(filename, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
