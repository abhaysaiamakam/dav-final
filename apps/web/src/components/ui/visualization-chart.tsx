"use client";

import type { VisualizationSpecification } from "@croplens/shared-types";
import Image from "next/image";

type Row = Record<string, unknown>;
const LABEL_FIELDS = ["label", "class_name", "category", "bin_label", "orientation", "format", "mode", "channel", "dimension", "feature"];
const nice = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const numeric = (value: unknown): number => typeof value === "number" ? value : Number(value);
const valueLabel = (value: number, unit?: string | null) => `${Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;

function keyPresent(rows: Row[], key?: string | null): key is string {
  return Boolean(key && rows.some(row => key in row));
}

function labelKeyFor(spec: VisualizationSpecification, rows: Row[]): string {
  const preferred = spec.x_axis?.name;
  if (keyPresent(rows, preferred)) return preferred;
  const semantic = LABEL_FIELDS.find(key => keyPresent(rows, key));
  if (semantic) return semantic;
  return rows.length ? Object.keys(rows[0]).find(key => rows.some(row => typeof row[key] === "string")) ?? "label" : "label";
}

function numberKeyFor(spec: VisualizationSpecification, rows: Row[], preferred?: string | null): string | null {
  if (keyPresent(rows, preferred) && rows.some(row => Number.isFinite(numeric(row[preferred])))) return preferred;
  const seriesKey = spec.series[0]?.data_key;
  if (keyPresent(rows, seriesKey) && rows.some(row => Number.isFinite(numeric(row[seriesKey])))) return seriesKey;
  return rows.length ? Object.keys(rows[0]).find(key => rows.some(row => Number.isFinite(numeric(row[key])))) ?? null : null;
}

export function canRenderVisualization(spec: VisualizationSpecification): boolean {
  const rows = spec.chart_data as Row[];
  if (!rows.length) return false;
  if (["pie", "bar", "histogram", "line"].includes(spec.chart_type)) return Boolean(numberKeyFor(spec, rows));
  if (spec.chart_type === "scatter") {
    const x = keyPresent(rows, spec.x_axis?.name) ? spec.x_axis?.name : Object.keys(rows[0]).find(key => Number.isFinite(numeric(rows[0][key])));
    const y = keyPresent(rows, spec.y_axis?.name) ? spec.y_axis?.name : Object.keys(rows[0]).find(key => key !== x && Number.isFinite(numeric(rows[0][key])));
    return Boolean(x && y && rows.some(row => Number.isFinite(numeric(row[x])) && Number.isFinite(numeric(row[y]))));
  }
  if (spec.chart_type === "box_plot") return rows.some(row => ["min", "q1", "median", "q3", "max"].every(key => Number.isFinite(numeric(row[key]))));
  if (spec.chart_type === "heatmap") return rows.some(row => Number.isFinite(numeric(row.value)) && row.x !== undefined && row.y !== undefined);
  if (spec.chart_type === "image_grid") return rows.some(row => typeof (row.image_url ?? row.thumbnail_url) === "string");
  return false;
}

export function VisualizationChart({ spec, onSelect }: { spec: VisualizationSpecification; onSelect?: (row: Row) => void }) {
  const rows = spec.chart_data as Row[];
  const series = spec.series[0];
  const labelKey = labelKeyFor(spec, rows);
  const valueKey = numberKeyFor(spec, rows, series?.data_key);
  const unit = series?.unit;
  const palette = ["#087f5b", "#2676a8", "#b7791f", "#7353a6", "#cc5a53", "#57883b", "#a14d82", "#64748b"];

  if (!canRenderVisualization(spec)) return <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">This visualization is unavailable because its stored result does not include the coordinates or values required to draw it.</div>;

  if (spec.chart_type === "pie" && valueKey) {
    const slices = rows.map((row, index) => ({ row, value: numeric(row[valueKey]), index })).filter(item => item.value > 0 && Number.isFinite(item.value));
    const total = slices.reduce((sum, item) => sum + item.value, 0);
    let angle = -Math.PI / 2;
    const arcs = slices.map(item => {
      const next = angle + item.value / total * Math.PI * 2;
      const p1 = [100 + 78 * Math.cos(angle), 100 + 78 * Math.sin(angle)];
      const p2 = [100 + 78 * Math.cos(next), 100 + 78 * Math.sin(next)];
      const path = `M 100 100 L ${p1[0]} ${p1[1]} A 78 78 0 ${next - angle > Math.PI ? 1 : 0} 1 ${p2[0]} ${p2[1]} Z`;
      const result = { ...item, path, share: item.value / total };
      angle = next;
      return result;
    });
    return <div className="grid items-center gap-3 md:grid-cols-[220px_1fr]"><svg viewBox="0 0 200 200" role="img" aria-label={`${spec.title} pie chart, ${total.toLocaleString()} ${unit ?? "observations"}`} className="mx-auto h-48 w-48">{arcs.map(item => <path key={item.index} d={item.path} fill={palette[item.index % palette.length]} tabIndex={0} role="button" onClick={() => onSelect?.(item.row)}><title>{`${String(item.row[labelKey] ?? item.index + 1)}: ${valueLabel(item.value, unit)} (${(item.share * 100).toFixed(1)}%).`}</title></path>)}</svg><ul className="space-y-1">{arcs.map(item => <li key={item.index}><button type="button" onClick={() => onSelect?.(item.row)} className="grid w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 text-left text-[10px]"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: palette[item.index % palette.length] }}/><span>{String(item.row[labelKey] ?? item.index + 1)}</span><span className="tabular-nums">{valueLabel(item.value, unit)} · {(item.share * 100).toFixed(1)}%</span></button></li>)}</ul></div>;
  }

  if (spec.chart_type === "scatter") {
    const xKey = keyPresent(rows, spec.x_axis?.name) ? spec.x_axis!.name : Object.keys(rows[0]).find(key => Number.isFinite(numeric(rows[0][key])))!;
    const yKey = keyPresent(rows, spec.y_axis?.name) ? spec.y_axis!.name : Object.keys(rows[0]).find(key => key !== xKey && Number.isFinite(numeric(rows[0][key])))!;
    const points = rows.map(row => ({ row, x: numeric(row[xKey]), y: numeric(row[yKey]), weight: Math.max(1, numeric(row.count) || 1) })).filter(item => Number.isFinite(item.x) && Number.isFinite(item.y));
    const xMin = Math.min(...points.map(point => point.x)), xMax = Math.max(...points.map(point => point.x));
    const yMin = Math.min(...points.map(point => point.y)), yMax = Math.max(...points.map(point => point.y));
    const xSpan = xMax - xMin || 1, ySpan = yMax - yMin || 1, peak = Math.max(...points.map(point => point.weight), 1);
    return <div><svg viewBox="0 0 680 340" role="img" aria-label={`${spec.title}: ${nice(spec.x_axis?.label ?? xKey)} against ${nice(spec.y_axis?.label ?? yKey)}`} className="h-64 w-full rounded-lg bg-white"><line x1="60" y1="25" x2="60" y2="285" stroke="#87958c"/><line x1="60" y1="285" x2="655" y2="285" stroke="#87958c"/>{[0, .25, .5, .75, 1].map(f => <g key={f}><line x1="60" y1={285 - f * 240} x2="655" y2={285 - f * 240} stroke="#e8ede9"/><text x="53" y={289 - f * 240} textAnchor="end" fontSize="9" fill="#647168">{valueLabel(yMin + ySpan * f, spec.y_axis?.unit)}</text></g>)}{points.map((point, index) => { const cx = 60 + (point.x - xMin) / xSpan * 590, cy = 285 - (point.y - yMin) / ySpan * 240, r = 3 + Math.sqrt(point.weight / peak) * 6; return <circle key={index} cx={cx} cy={cy} r={r} fill={series?.color ?? "#087f5b"} fillOpacity=".65" onClick={() => onSelect?.(point.row)} className={onSelect ? "cursor-pointer" : undefined}><title>{`${nice(xKey)} ${valueLabel(point.x, spec.x_axis?.unit)} · ${nice(yKey)} ${valueLabel(point.y, spec.y_axis?.unit)}${point.weight > 1 ? ` · ${point.weight} images at this resolution` : ""}`}</title></circle>; })}<text x="350" y="326" textAnchor="middle" fontSize="11" fill="#53615a">{spec.x_axis?.label ?? nice(xKey)}</text><text x="12" y="155" textAnchor="middle" fontSize="11" fill="#53615a" transform="rotate(-90 12 155)">{spec.y_axis?.label ?? nice(yKey)}</text><text x="60" y="302" fontSize="9" fill="#647168">{valueLabel(xMin, spec.x_axis?.unit)}</text><text x="655" y="302" textAnchor="end" fontSize="9" fill="#647168">{valueLabel(xMax, spec.x_axis?.unit)}</text></svg><p className="mt-1 text-[10px] text-zinc-500">Each point is a recorded {spec.category === "image_geometry" ? "image resolution" : "observation"}; point size indicates {rows.some(row => Number(row.count) > 1) ? "images sharing that resolution" : "one observation"}.</p></div>;
  }

  if (spec.chart_type === "box_plot") {
    const low = Math.min(...rows.map(row => numeric(row.min))), high = Math.max(...rows.map(row => numeric(row.max))), span = high - low || 1;
    return <div className="space-y-3">{rows.map((row, index) => { const x = (value: unknown) => 8 + (numeric(value) - low) / span * 84; return <div key={index} className="grid grid-cols-[90px_1fr] items-center gap-2 text-[10px]"><span className="truncate">{String(row[labelKey] ?? `Group ${index + 1}`)}</span><svg viewBox="0 0 100 24" aria-label={`${String(row[labelKey] ?? `Group ${index+1}`)} min ${row.min}, Q1 ${row.q1}, median ${row.median}, Q3 ${row.q3}, max ${row.max}`}><line x1={x(row.min)} x2={x(row.max)} y1="12" y2="12" stroke="#647168"/><line x1={x(row.min)} x2={x(row.min)} y1="6" y2="18" stroke="#647168"/><line x1={x(row.max)} x2={x(row.max)} y1="6" y2="18" stroke="#647168"/><rect x={x(row.q1)} y="4" width={Math.max(1, x(row.q3)-x(row.q1))} height="16" fill="#d6eee3" stroke="#087f5b"/><line x1={x(row.median)} x2={x(row.median)} y1="4" y2="20" stroke="#065f46" strokeWidth="1.5"/></svg></div>; })}<p className="text-[10px] text-zinc-500">Whiskers show the supplied minimum and maximum; the box spans Q1–Q3 and the center line is the median.</p></div>;
  }

  if (spec.chart_type === "heatmap") {
    const xs = Array.from(new Set(rows.map(row => String(row.x)))).sort(), ys = Array.from(new Set(rows.map(row => String(row.y)))).sort();
    return <div className="overflow-auto"><table className="min-w-full border-separate border-spacing-1 text-[9px]"><thead><tr><th>{spec.y_axis?.label ?? nice("row")}</th>{xs.map(x => <th key={x} className="max-w-16 truncate">{x}</th>)}</tr></thead><tbody>{ys.map(y => <tr key={y}><th className="max-w-32 truncate text-right">{y}</th>{xs.map(x => { const value = numeric(rows.find(row => String(row.x) === x && String(row.y) === y)?.value); const intensity = Math.min(1, Math.abs(value)); return <td key={x}><button type="button" title={`${y} × ${x}: ${value.toFixed(3)}`} aria-label={`${y} by ${x}: ${value.toFixed(3)}`} className="h-7 w-full min-w-7 rounded" style={{ backgroundColor: value >= 0 ? `rgba(8,127,91,${.08 + intensity*.76})` : `rgba(191,78,66,${.08 + intensity*.76})` }} onClick={() => { const row = rows.find(item => String(item.x) === x && String(item.y) === y); if (row) onSelect?.(row); }}>{Number.isFinite(value) ? value.toFixed(2) : "—"}</button></td>; })}</tr>)}</tbody></table></div>;
  }

  if (spec.chart_type === "image_grid") return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{rows.map((row, index) => { const src = String(row.image_url ?? row.thumbnail_url ?? ""); return <figure key={index} className="overflow-hidden rounded-lg border border-croplens-border"><Image src={src} alt={String(row.alt ?? row.label ?? `Analysis sample ${index + 1}`)} width={512} height={512} unoptimized className="aspect-square w-full object-cover"/><figcaption className="p-2 text-[10px]">{String(row.label ?? row.relative_path ?? `Sample ${index + 1}`)}</figcaption></figure>; })}</div>;

  if (!valueKey) return <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">This chart result contains no numeric value field, so it was not rendered.</div>;
  const finite = rows.map(row => ({ row, value: numeric(row[valueKey]) })).filter(item => Number.isFinite(item.value));
  const max = Math.max(...finite.map(item => item.value), 1);
  const isLine = spec.chart_type === "line";
  if (isLine) {
    const low = Math.min(...finite.map(item => item.value)), span = max - low || 1;
    const path = finite.map((item, index) => `${index ? "L" : "M"}${index * 100 / Math.max(finite.length - 1, 1)},${95 - (item.value - low) / span * 85}`).join(" ");
    return <div><svg viewBox="0 0 100 110" role="img" aria-label={`${spec.title}: ${spec.y_axis?.label ?? nice(valueKey)} by ${spec.x_axis?.label ?? nice(labelKey)}`} className="h-48 w-full overflow-visible"><path d="M0 95H100M0 52H100M0 10H100" stroke="#e8ede9" strokeWidth=".7"/><path d={path} fill="none" stroke={series?.color ?? "#23834f"} strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>{finite.map((item, index) => <circle key={index} cx={index * 100 / Math.max(finite.length - 1, 1)} cy={95 - (item.value - low) / span * 85} r="1.7" fill={series?.color ?? "#23834f"}><title>{`${String(item.row[labelKey] ?? index + 1)}: ${valueLabel(item.value, unit)}`}</title></circle>)}</svg><div className="flex justify-between text-[10px] text-zinc-500"><span>{String(finite[0]?.row[labelKey] ?? "First")}</span><span>{String(finite.at(-1)?.row[labelKey] ?? "Last")}</span></div><p className="mt-1 text-[10px] text-zinc-500">{spec.x_axis?.label ?? nice(labelKey)} grouped by category. Values: {spec.y_axis?.label ?? nice(valueKey)}{unit ? ` (${unit})` : ""}.</p></div>;
  }
  return <div className="space-y-2">{finite.slice(0, 24).map(({ row, value }, index) => { const label = String(row[labelKey] ?? `Item ${index + 1}`); const percentage = Number.isFinite(numeric(row.percentage)) ? `${numeric(row.percentage).toFixed(1)}%` : null; return <button type="button" key={`${label}:${index}`} onClick={() => onSelect?.(row)} className="grid w-full grid-cols-[minmax(86px,1fr)_minmax(80px,2fr)_auto] items-center gap-2 text-left text-[10px]"><span className="truncate" title={label}>{label}</span><span className="h-2 overflow-hidden rounded-full bg-gray-100"><span className="block h-full rounded-full" style={{ width: `${Math.max(value > 0 ? 1 : 0, value / max * 100)}%`, background: series?.color ?? "#23834f" }}/></span><span className="min-w-20 text-right font-mono tabular-nums text-zinc-600">{valueLabel(value, unit)}{percentage ? ` · ${percentage}` : ""}</span></button>; })}</div>;
}
