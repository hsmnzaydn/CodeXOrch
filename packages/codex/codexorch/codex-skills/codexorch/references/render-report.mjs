import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

const schema = JSON.parse(await readFile(new URL("report.schema.json", import.meta.url), "utf8"));
const template = await readFile(new URL("report-template.html", import.meta.url), "utf8");
const sectionSpecs = [
  ["summary", "Özet", 30], ["changes", "Ne değişti?", 45],
  ["verification", "Doğrulama", 40], ["open", "Açık kalanlar", 30],
  ["risks", "Riskler", 30], ["next", "Sonraki adım", 20]
];
const statuses = { passed: "Geçti", failed: "Başarısız", not_run: "Çalıştırılmadı", unknown: "Bilinmiyor" };
const verdicts = { approved: "Onaylandı", changes_requested: "Düzeltme istendi", unverified: "Doğrulanmadı", unknown: "Bilinmiyor" };
const certainties = { verified: "Doğrulandı", inferred: "Çıkarım", unknown: "Bilinmiyor" };
const banned = ["kusursuz", "risksiz", "tamamen güvenli", "sorunsuz", "yapılmıştır", "gerçekleştirilmiştir", "tarafından"];
const words = new Intl.Segmenter("tr", { granularity: "word" });
const sentences = new Intl.Segmenter("tr", { granularity: "sentence" });
const wordCount = text => [...words.segment(text)].filter(part => part.isWordLike).length;
const escape = value => String(value ?? "Bilinmiyor (unknown)").replace(/[&<>"\x27]/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "\x27": "&#39;" })[character]);

function validateShape(value, rule, path = "report") {
  if (rule.$ref) return validateShape(value, schema.$defs[rule.$ref.split("/").at(-1)], path);
  const fail = message => { throw new Error(`${path}: ${message}`); };
  if (Object.hasOwn(rule, "const") && value !== rule.const) fail("wrong schema_version");
  if (rule.enum && !rule.enum.includes(value)) fail("invalid status or value");
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (rule.type && ![rule.type].flat().includes(type)) fail("invalid type");
  if (type === "string") {
    if (rule.minLength && !value.trim()) fail("empty text");
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail("invalid SHA, URL or id");
  }
  if (type === "array") {
    if (rule.minItems && value.length < rule.minItems) fail("missing evidence refs");
    if (rule.uniqueItems && new Set(value).size !== value.length) fail("duplicate refs");
    value.forEach((item, index) => validateShape(item, rule.items, `${path}[${index}]`));
  }
  if (type === "object") {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(rule.properties ?? {}, key)) fail(`unexpected ${key}`);
      validateShape(value[key], rule.properties[key], `${path}.${key}`);
    }
  }
}

export function validateReport(report) {
  validateShape(report, schema);
  const evidence = new Map([["commit", report], ["review", report.review]]);
  const sameCommit = (commit, label) => {
    if (commit !== null && report.source_commit !== null && commit !== report.source_commit)
      throw new Error(`${label}: SHA differs from source_commit`);
  };
  sameCommit(report.review.reviewed_commit, "review");
  for (const check of report.checks) {
    if (evidence.has(check.id)) throw new Error(`duplicate evidence id: ${check.id}`);
    sameCommit(check.checked_commit, check.id);
    evidence.set(check.id, check);
  }
  for (const url of [report.source_url, report.review.evidence_url, ...report.checks.map(check => check.evidence_url)]) {
    if (url === null) continue;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new Error("unsafe evidence URL");
  }
  const facts = new Map();
  for (const fact of report.facts) {
    if (facts.has(fact.id)) throw new Error(`duplicate fact id: ${fact.id}`);
    for (const ref of fact.evidence_refs)
      if (!evidence.has(ref)) throw new Error(`missing evidence ref: ${ref}`);
    facts.set(fact.id, fact);
  }
  const visible = new Set();
  for (const [section, refs] of Object.entries(report.sections)) {
    for (const ref of refs) {
      if (!facts.has(ref)) throw new Error(`missing fact ref: ${ref}`);
      if (section !== "summary" && facts.get(ref).kind !== ({ changes: "change", verification: "verification", open: "open", risks: "risk", next: "next" })[section])
        throw new Error(`${section}: wrong fact kind: ${ref}`);
      visible.add(ref);
    }
  }
  for (const fact of facts.values())
    if (!visible.has(fact.id)) throw new Error(`hidden fact: ${fact.id}`);
  return facts;
}

export function renderReport(report) {
  const facts = validateReport(report);
  const warnings = [];
  const warnText = (text, label) => {
    for (const sentence of sentences.segment(text)) {
      const count = wordCount(sentence.segment);
      if (count > 20) warnings.push(`${label}: sentence has ${count} words (limit 20)`);
    }
    const lower = text.toLocaleLowerCase("tr");
    for (const phrase of banned) if (lower.includes(phrase)) warnings.push(`${label}: banned phrase: ${phrase}`);
  };
  warnText(report.title_tr, "title_tr");
  if (report.title_tr.length > 100) warnings.push("title_tr: above 100 characters");
  for (const fact of facts.values()) warnText(fact.text_tr, fact.id);
  const linked = (url, label) => url === null ? `${escape(label)} · Bağlantı bilinmiyor (unknown)`
    : `<a href="${escape(url)}" rel="noopener noreferrer">${escape(label)}</a>`;
  const factHtml = fact => `<li>${escape(fact.text_tr)} <small>${escape(certainties[fact.certainty])} · ${fact.evidence_refs.map(ref => `<a href="#e-${escape(ref)}">${escape(ref)}</a>`).join(", ")}</small></li>`;
  let content = `<p class="status">İnceleme: ${escape(verdicts[report.review.verdict])} (${escape(report.review.verdict)}). <a href="#e-review">Kanıt</a></p>`;
  for (const [key, title, budget] of sectionSpecs) {
    const selected = report.sections[key].map(ref => facts.get(ref));
    if (wordCount(selected.map(fact => fact.text_tr).join(" ")) > budget) warnings.push(`${key}: above ${budget} words`);
    content += `<section><h2>${title}</h2>${selected.length ? `<ul>${selected.map(factHtml).join("")}</ul>` : "<p>Olgu verilmedi; sonuç bilinmiyor (unknown).</p>"}`;
    if (key === "verification") {
      content += `<ul>${report.checks.map(check => `<li>${escape(check.id)}: ${escape(statuses[check.status])} (${escape(check.status)}) · Kapsam: ${escape(check.scope)} <a href="#e-${escape(check.id)}">Kanıt</a></li>`).join("")}</ul>`;
      if (!report.checks.length) content += "<p>Kontrol kaydı verilmedi (unknown).</p>";
    }
    content += "</section>";
  }
  content += `<details><summary>Kanıt</summary><ul><li id="e-commit">${linked(report.source_url, "Kaynak commit")} · <code>${escape(report.source_commit)}</code></li>`;
  content += `<li id="e-review">${linked(report.review.evidence_url, "İnceleme")} · ${escape(report.review.verdict)} · SHA: <code>${escape(report.review.reviewed_commit)}</code></li>`;
  content += report.checks.map(check => `<li id="e-${escape(check.id)}">${linked(check.evidence_url, check.id)} · ${escape(check.status)} · SHA: <code>${escape(check.checked_commit)}</code> · Kapsam: ${escape(check.scope)} · Komut: <code>${escape(check.command)}</code></li>`).join("");
  content += "</ul></details>";
  const replacements = { TITLE: escape(report.title_tr), IDENTITY: `Görev: ${escape(report.task_id)} · Aşama: ${escape(report.milestone_id)}`, CONTENT: content };
  return { html: template.replace(/\{\{(TITLE|IDENTITY|CONTENT)\}\}/g, (_, key) => replacements[key]), warnings };
}

export async function publishReport(report, directory = "/tmp/codexorch-reports") {
  const { html, warnings } = renderReport(report);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = encodeURIComponent(`${report.task_id ?? "task"}-${report.milestone_id ?? "report"}`).replaceAll(".", "%2E");
  const reportPath = `${directory}/${name}.json`;
  const htmlPath = `${directory}/${name}.html`;
  for (const [path, content] of [[reportPath, JSON.stringify(report)], [htmlPath, html],
    [`${directory}/latest.json`, JSON.stringify({ report_path: reportPath, html_path: htmlPath })]]) {
    const temporary = `${path}.${randomUUID()}`;
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }
  return { html, warnings, htmlPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [input, output] = process.argv.slice(2);
    if (!input || !output || process.argv.length !== 4) throw new Error("Usage: node render-report.mjs input.json output.html");
    const report = JSON.parse(await readFile(input, "utf8"));
    const { html, warnings, htmlPath } = await publishReport(report);
    if (process.env.CODEXORCH_REPORT_NO_OPEN !== "1") {
      try {
        await new Promise(resolve => execFile("orca",
          ["tab", "create", "--url", pathToFileURL(htmlPath).href, "--json"],
          { timeout: 5000 }, () => resolve()));
      } catch {}
    }
    await writeFile(output, html, "utf8");
    for (const warning of warnings) console.error(`WARNING: ${warning}`);
    console.log(output);
  } catch (error) {
    console.error(`Report error: ${error.message}`);
    process.exitCode = 1;
  }
}
