"use client";

import { useMemo, useState } from "react";
import type { ImageIntelligenceResponse } from "@croplens/shared-types";
import { EvidenceImageGrid } from "@/components/evidence/evidence-image-grid";

type Props = {
  frequency: Record<string, number>;
  total: number;
  measurements: ImageIntelligenceResponse["image_measurements"];
  datasetId: string;
  versionId: string;
};

const PAGE_SIZE = 12;

export function DimensionFrequencyTable({ frequency, total, measurements, datasetId, versionId }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"count" | "width" | "height">("count");
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = useMemo(() => Object.entries(frequency).map(([key, count]) => {
    const [width, height] = key.split("x").map(Number);
    return { key, width, height, count };
  }).filter(row => Number.isFinite(row.width) && Number.isFinite(row.height) && (!query || String(row.width).includes(query) || String(row.height).includes(query) || row.key.toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => (a[sort] - b[sort]) * (descending ? -1 : 1) || a.width - b.width || a.height - b.height), [frequency, query, sort, descending]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const samples = selected ? measurements.filter(image => `${image.features.width}x${image.features.height}` === selected).slice(0, 4) : [];
  function changeSort(column: "count" | "width" | "height") {
    if (column === sort) setDescending(value => !value);
    else { setSort(column); setDescending(column === "count"); }
    setPage(1);
  }

  return <section className="rounded-xl border border-croplens-border bg-white p-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-sm font-semibold text-zinc-900">Image dimensions · all observed pairs</h2><p className="mt-1 text-[11px] text-zinc-500">{rows.length} observed dimension pairs · {total.toLocaleString()} valid images in this version</p></div>
      <label className="text-[10px] text-zinc-500">Search width, height or pair<input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="e.g. 640 or 640x480" className="mt-1 h-9 w-56 rounded-lg border border-croplens-border px-3 text-xs text-zinc-800"/></label>
    </div>
    <div className="mt-3 overflow-x-auto rounded-lg border border-croplens-border">
      <table className="w-full text-left text-xs"><thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-zinc-500"><tr>{([ ["width", "Width (px)"], ["height", "Height (px)"], ["count", "Images"] ] as const).map(([column, label]) => <th key={column} className="px-3 py-2"><button onClick={() => changeSort(column)} className="font-semibold">{label}{sort === column ? descending ? " ↓" : " ↑" : ""}</button></th>)}<th className="px-3 py-2">Share</th><th className="px-3 py-2">Source samples</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.key} className={`border-t border-zinc-100 ${selected === row.key ? "bg-emerald-50" : ""}`}><td className="px-3 py-2 tabular-nums">{row.width}</td><td className="px-3 py-2 tabular-nums">{row.height}</td><td className="px-3 py-2 tabular-nums">{row.count.toLocaleString()}</td><td className="px-3 py-2 tabular-nums">{total ? (row.count / total * 100).toFixed(2) : "0.00"}%</td><td className="px-3 py-2"><button onClick={() => setSelected(selected === row.key ? null : row.key)} className="font-semibold text-emerald-800 underline">{measurements.some(image => `${image.features.width}x${image.features.height}` === row.key) ? "Inspect" : "Unavailable"}</button></td></tr>)}
        {visible.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">No dimension pairs match this search.</td></tr>}</tbody></table>
    </div>
    <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-500"><span>Page {Math.min(page, pages)} of {pages} · showing {visible.length} of {rows.length}</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="rounded border border-croplens-border px-2 py-1 disabled:opacity-40">Previous</button><button disabled={page >= pages} onClick={() => setPage(value => Math.min(pages, value + 1))} className="rounded border border-croplens-border px-2 py-1 disabled:opacity-40">Next</button></div></div>
    {selected && <div className="mt-3 border-t border-croplens-border pt-2"><p className="text-xs font-semibold">Original source images · {selected}</p>{samples.length ? <EvidenceImageGrid datasetId={datasetId} versionId={versionId} images={samples.map(image => ({ relativePath: image.relative_path, label: `${image.features.width} × ${image.features.height} px`, className: image.class_name, width: image.features.width, height: image.features.height }))}/> : <p className="mt-2 text-xs text-zinc-500">Image-level evidence is unavailable for this exact version.</p>}</div>}
  </section>;
}
