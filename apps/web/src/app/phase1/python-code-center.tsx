"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Search } from "lucide-react";
import sourceModules from "@/lib/phase1-python-sources.json";

type SourceFunction = (typeof sourceModules)[number]["functions"][number];
type SourceModule = (typeof sourceModules)[number];
const modules = sourceModules as SourceModule[];
type Props = { datasetId: string; versionId: string; fingerprint?: string; analysisId?: string; analyzedImages?: number; analysisConfig?: Record<string, unknown>; provenance?: Record<string, unknown>; pca?: { feature_names: string[]; explained_variance_ratio: number[]; cumulative_explained_variance: number[] }; requestedFunction?: { moduleId: string; symbol: string } | null };
type CodeView = "raw" | "commented" | "explanation";

function Code({ source, firstLine = 1 }: { source: string; firstLine?: number }) {
  function highlight(line: string, lineNo: number): ReactNode {
    const pattern = /#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:False|True|None|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b|\b\d+(?:\.\d+)?\b/g;
    const parts: ReactNode[] = [];
    let cursor = 0;
    for (const match of line.matchAll(pattern)) {
      const token = match[0], start = match.index ?? 0;
      if (start > cursor) parts.push(line.slice(cursor, start));
      const cls = token.startsWith("#") ? "text-zinc-500" : token.startsWith("\"") || token.startsWith("'") ? "text-amber-200" : /^\d/.test(token) ? "text-cyan-200" : "text-fuchsia-300";
      parts.push(<span key={`${lineNo}-${start}`} className={cls}>{token}</span>);
      cursor = start + token.length;
    }
    if (cursor < line.length) parts.push(line.slice(cursor));
    return parts.length ? parts : " ";
  }
  return <pre className="max-h-[560px] overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-[10px] leading-relaxed text-emerald-100"><code>{source.split("\n").map((line, index) => <span key={index} className="grid grid-cols-[3rem_minmax(0,1fr)]"><span className="select-none pr-3 text-right text-zinc-600">{firstLine + index}</span><span className="whitespace-pre">{highlight(line, index)}</span></span>)}</code></pre>;
}

function sourceFor(fn: SourceFunction, view: CodeView) {
  return view === "raw" ? fn.raw_source : fn.source;
}

export function Phase1PythonCodeCenter({ datasetId, versionId, fingerprint, analysisId, analyzedImages, analysisConfig, provenance, pca, requestedFunction }: Props) {
  const [moduleId, setModuleId] = useState("visual-features");
  const [symbol, setSymbol] = useState("_image_features");
  const [view, setView] = useState<CodeView>("commented");
  const [query, setQuery] = useState("");
  const [expandedLines, setExpandedLines] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!requestedFunction) return;
    const requestedModule = modules.find(item => item.id === requestedFunction.moduleId);
    if (!requestedModule?.functions.some(fn => fn.symbol === requestedFunction.symbol)) return;
    setModuleId(requestedFunction.moduleId);
    setSymbol(requestedFunction.symbol);
    setView("explanation");
    setExpandedLines(false);
  }, [requestedFunction]);
  const currentModule = modules.find(module => module.id === moduleId) ?? modules[0];
  const functions = useMemo(() => currentModule.functions.filter(fn => {
    const text = `${fn.name} ${fn.symbol} ${fn.signature} ${fn.docstring ?? ""} ${currentModule.title} ${currentModule.purpose}`.toLocaleLowerCase();
    return text.includes(query.toLocaleLowerCase());
  }), [currentModule, query]);
  const selected = functions.find(fn => fn.symbol === symbol) ?? functions[0] ?? currentModule.functions[0];
  const allFunctions = modules.flatMap(module => module.functions.map(fn => ({ module, fn })));
  const currentIndex = allFunctions.findIndex(item => item.module.id === currentModule.id && item.fn.symbol === selected.symbol);
  const actualCode = selected ? sourceFor(selected, view) : "";

  function searchSource(value: string) {
    setQuery(value);
    const term = value.trim().toLocaleLowerCase();
    if (!term) return;
    const match = /\b(iqr|tukey|outlier|anomal)\b/.test(term)
      ? allFunctions.find(({ module }) => module.id === "outliers")
      : allFunctions.find(({ fn }) => `${fn.name} ${fn.symbol} ${fn.docstring ?? ""}`.toLocaleLowerCase().includes(term))
      ?? allFunctions.find(({ module }) => `${module.title} ${module.purpose}`.toLocaleLowerCase().includes(term))
      ?? allFunctions.find(({ fn }) => fn.source.toLocaleLowerCase().includes(term))
      ?? allFunctions.find(({ module }) => `${module.math} ${module.limitations}`.toLocaleLowerCase().includes(term));
    if (match) { setModuleId(match.module.id); setSymbol(match.fn.symbol); }
  }

  function selectModule(next: string) {
    const nextModule = modules.find(item => item.id === next);
    setModuleId(next);
    setSymbol(nextModule?.functions[0]?.symbol ?? "");
    setQuery("");
    setExpandedLines(false);
  }

  function navigate(delta: number) {
    const next = allFunctions[Math.max(0, Math.min(allFunctions.length - 1, currentIndex + delta))];
    if (!next) return;
    setModuleId(next.module.id);
    setSymbol(next.fn.symbol);
    setQuery("");
    setExpandedLines(false);
  }

  function openDependency(name: string) {
    const found = allFunctions.find(item => item.fn.name === name || item.fn.symbol.endsWith(`.${name}`));
    if (!found) return;
    setModuleId(found.module.id);
    setSymbol(found.fn.symbol);
    setView("explanation");
    setExpandedLines(false);
  }

  async function copyCode() {
    await navigator.clipboard.writeText(actualCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return <div className="space-y-4">
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[10px] leading-relaxed text-emerald-950">
      <p className="font-semibold">Production source and standalone reproduction are different implementations.</p>
      <p className="mt-1">Production functions below are generated from their cited repository files at build time. Their function bodies are exact source excerpts; imports and called helpers are identified separately. They are not presented as a single runnable script. The Standalone module preserves the independent ZIP utility.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2"><p className="min-w-0 break-all"><b>Dataset</b><br/>ICAR Rice and Maize · {datasetId}</p><p className="min-w-0 break-all"><b>Selected version</b><br/><code>{versionId || "not selected"}</code></p><p className="min-w-0 break-all"><b>Source fingerprint</b><br/><code>{fingerprint || "Not returned by current version context"}</code></p><p className="min-w-0 break-all"><b>Production image run</b><br/>{analysisId ? `${analysisId} · ${analyzedImages ?? "—"} analyzed` : "No matching version-scoped image analysis loaded"}</p></div>
      {analysisConfig && <p className="mt-2"><b>Stored run configuration:</b> {Object.entries(analysisConfig).map(([key, value]) => `${key}=${String(value)}`).join(" · ")}</p>}
      {provenance && <p className="mt-1"><b>Stored runtime:</b> {Object.entries(provenance).map(([key, value]) => `${key}=${String(value)}`).join(" · ")}</p>}
      {pca && <p className="mt-1"><b>Selected-version PCA:</b> {pca.feature_names.length} descriptors · {analysisConfig?.standardize_features === true ? "standardized" : analysisConfig?.standardize_features === false ? "unstandardized" : "scaling status not stored"} · {pca.explained_variance_ratio.length} components. PC1 {((pca.explained_variance_ratio[0] ?? 0) * 100).toFixed(2)}%, PC2 {((pca.explained_variance_ratio[1] ?? 0) * 100).toFixed(2)}%; cumulative through PC2 {((pca.cumulative_explained_variance[1] ?? 0) * 100).toFixed(2)}%.</p>}
      <p className="mt-2">t-SNE, UMAP, Isolation Forest, Z-score anomaly rules, Canny-derived dataset features, and image-modality feature-registry PCA are not part of the shown ICAR production analysis unless a matching function/result is explicitly present. The production image-intelligence PCA is a separate feature pipeline.</p>
    </section>

    <div className="grid gap-3 xl:grid-cols-[minmax(190px,.28fr)_minmax(0,1fr)]">
      <nav aria-label="Python source modules" className="space-y-3">
        <div className="rounded-lg border border-croplens-border bg-white p-3"><label htmlFor="python-source-search" className="mb-2 flex items-center gap-2 text-[10px] font-semibold text-zinc-700"><Search size={13}/>Search functions and modules</label><input id="python-source-search" value={query} onChange={event => searchSource(event.target.value)} placeholder="PCA, hash, brightness…" className="w-full rounded-md border border-croplens-border px-2 py-2 text-xs outline-none focus:border-emerald-600"/></div>
        <div className="max-h-[460px] space-y-1 overflow-auto rounded-lg border border-croplens-border bg-white p-2">{modules.map(module => <button key={module.id} onClick={() => selectModule(module.id)} aria-pressed={module.id === currentModule.id} className={`w-full rounded-md px-2.5 py-2 text-left text-[10px] ${module.id === currentModule.id ? "bg-emerald-50 font-semibold text-emerald-900" : "text-zinc-600 hover:bg-gray-50"}`}>{module.title}<span className="ml-1 text-zinc-400">({module.functions.length})</span></button>)}</div>
        <div className="max-h-[350px] space-y-1 overflow-auto rounded-lg border border-croplens-border bg-white p-2" aria-label="Functions in selected module">{functions.map(fn => <button key={fn.symbol} onClick={() => { setSymbol(fn.symbol); setExpandedLines(false); }} aria-current={selected.symbol === fn.symbol ? "true" : undefined} className={`w-full rounded-md px-2.5 py-2 text-left font-mono text-[10px] ${selected.symbol === fn.symbol ? "bg-emerald-700 text-white" : "text-zinc-700 hover:bg-gray-50"}`}>{fn.name}<span className={`mt-1 block font-sans text-[9px] ${selected.symbol === fn.symbol ? "text-emerald-100" : "text-zinc-400"}`}>L{fn.line_start}–{fn.line_end}</span></button>)}</div>
      </nav>

      <div className="min-w-0 space-y-3">
        <div className="rounded-lg border border-croplens-border bg-white p-3">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-zinc-900">{selected.name}()</p><p className="mt-1 break-all font-mono text-[10px] text-zinc-500">{currentModule.path}:{selected.line_start} · {currentModule.kind === "production" ? "Production API source" : "Standalone analysis source"}</p><p className="mt-1 font-mono text-[10px] text-zinc-600">{selected.signature}</p></div><button onClick={() => void copyCode()} className="inline-flex items-center gap-1 rounded-md border border-croplens-border px-2.5 py-2 text-[10px]">{copied ? <Check size={12}/> : <Copy size={12}/>} {copied ? "Copied" : "Copy function"}</button></div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><div className="flex gap-1 rounded-lg bg-gray-100 p-1">{(["raw", "commented", "explanation"] as const).map(item => <button key={item} onClick={() => setView(item)} aria-pressed={view === item} className={`rounded-md px-3 py-1.5 text-[10px] ${view === item ? "bg-white shadow" : "text-zinc-600"}`}>{item === "raw" ? "Raw Python" : item === "commented" ? "Commented Python" : "Code Explanation"}</button>)}</div><div className="flex gap-2"><button onClick={() => navigate(-1)} disabled={currentIndex <= 0} className="rounded border border-croplens-border p-2 disabled:opacity-40" aria-label="Previous function"><ChevronLeft size={14}/></button><span className="self-center text-[9px] text-zinc-500">{currentIndex + 1} / {allFunctions.length}</span><button onClick={() => navigate(1)} disabled={currentIndex >= allFunctions.length - 1} className="rounded border border-croplens-border p-2 disabled:opacity-40" aria-label="Next function"><ChevronRight size={14}/></button></div></div>
          {view !== "explanation" ? <><Code source={actualCode} firstLine={selected.line_start}/><p className="mt-2 text-[9px] text-zinc-500">{view === "raw" ? "Exact function source with comment-only lines removed; docstrings and executable code are preserved." : "Exact function source as committed, including its original comments and docstring."} Supporting imports from this same source file:</p><pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-[9px] text-emerald-100">{currentModule.imports}</pre></> : <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(240px,.8fr)]"><Code source={selected.source} firstLine={selected.line_start}/><div className="space-y-2 text-[10px] leading-relaxed text-zinc-700"><p><b>What it does:</b> {selected.docstring || currentModule.purpose}</p><p><b>Why CropLens uses it:</b> {currentModule.purpose}</p><p><b>Input:</b> {selected.parameters.map(param => `${param.name}${param.annotation ? `: ${param.annotation}` : ""}`).join(", ") || "See signature and caller; unannotated values are not assigned guessed types."}</p><p><b>Output:</b> {selected.return_annotation || "No return annotation; inspect the exact return statements in source."}</p><div className="text-[10px]"><b>Dependencies:</b> <div className="mt-1 flex flex-wrap gap-1">{selected.calls.map(name => { const linked = allFunctions.some(item => item.fn.name === name || item.fn.symbol.endsWith(`.${name}`)); return linked ? <button key={name} onClick={() => openDependency(name)} className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[9px] text-emerald-900 underline">{name}</button> : <code key={name} className="rounded bg-gray-100 px-1 py-0.5 text-[9px]">{name}</code>; })}</div><p className="mt-1">Function dependencies link to their repository source; library and built-in calls are listed for context.</p></div><p><b>How it works:</b> Expand the source-line notes below; the notes are generated from parsed source lines and identify control flow, returns, assignment expressions, exception handling and calls.</p><p><b>Mathematics:</b> {currentModule.math}</p><p><b>ML/DL relevance:</b> {currentModule.ml}</p><p><b>Agricultural relevance:</b> {currentModule.agriculture}</p><p><b>Limitations:</b> {currentModule.limitations}</p></div></div>}
        </div>
        {view === "explanation" && <details open={expandedLines} onToggle={event => setExpandedLines(event.currentTarget.open)} className="rounded-lg border border-croplens-border bg-white p-3"><summary className="cursor-pointer text-xs font-semibold">Function line-by-line source notes ({selected.line_notes.length} lines)</summary><ol className="mt-3 max-h-[520px] space-y-2 overflow-auto">{selected.line_notes.map(item => <li key={item.line} className="grid gap-1 rounded-md bg-gray-50 p-2 sm:grid-cols-[3rem_minmax(0,1fr)]"><span className="font-mono text-[9px] text-zinc-400">L{item.line}</span><div><code className="block overflow-x-auto whitespace-pre font-mono text-[9px] text-zinc-800">{item.code || " "}</code><p className="mt-1 text-[9px] text-zinc-600">{item.explanation}</p></div></li>)}</ol></details>}
      </div>
    </div>

    <section className="rounded-lg border border-croplens-border bg-white p-3"><h3 className="text-xs font-semibold text-zinc-900">Implemented operation audit</h3><p className="mt-1 text-[10px] text-zinc-600">The explorer covers production inventory/validation, EDA, image condition, exact and perceptual duplicates, RGB/HSV, GLCM/LBP/Sobel, feature statistics/correlation, SVD PCA, registered image transforms/augmentation, version tracking, plus the separate standalone ZIP script. The API route handlers are thin request/response entry points in <code>apps/api/app/api/v1/endpoints/images.py</code>; their called service symbols are navigable above where included.</p><div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{modules.map(module => <div key={module.id} className="rounded-md bg-gray-50 p-2 text-[9px]"><p className="font-semibold">{module.title}</p><p className="mt-1 break-all text-zinc-500">{module.path}</p><p className="mt-1 text-zinc-600">{module.functions.length} source-verified functions</p></div>)}</div></section>
  </div>;
}
