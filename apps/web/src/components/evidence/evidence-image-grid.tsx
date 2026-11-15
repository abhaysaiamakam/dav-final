"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { apiClient } from "@/lib/api-client";

export interface EvidenceImage {
  relativePath: string;
  label: string;
  className?: string;
  fileSizeBytes?: number;
  detail?: string;
  width?: number;
  height?: number;
}

/** Resolves repository-relative image paths to the existing version-scoped image API. */
export function EvidenceImageGrid({ datasetId, versionId, images }: {
  datasetId: string;
  versionId: string;
  images: EvidenceImage[];
}) {
  const [ids, setIds] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [dimensions, setDimensions] = useState<Record<string, {width?: number; height?: number}>>({});
  const pathKey = images.map(item => item.relativePath).join("\u0000");
  useEffect(() => {
    let active = true;
    async function resolve() {
      const paths = pathKey ? pathKey.split("\u0000") : [];
      const pairs = await Promise.all(paths.map(async path => {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
        const id = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("").slice(0, 32);
        return [path, id] as const;
      }));
      if (active) setIds(Object.fromEntries(pairs));
      if (active) {
        const details = await Promise.all(paths.map(async path => {
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
          const id = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("").slice(0, 32);
          try {
            const row = await apiClient.getImage(datasetId, versionId, id);
            return [path, {width: row.width ?? undefined, height: row.height ?? undefined}] as const;
          } catch { return [path, {}] as const; }
        }));
        if (active) setDimensions(Object.fromEntries(details));
      }
    }
    void resolve();
    return () => { active = false; };
  }, [pathKey, datasetId, versionId]);

  if (!images.length) return <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-zinc-500">No image samples were returned for this result.</p>;
  return <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {images.map(item => {
      const id = ids[item.relativePath];
      const src = id ? apiClient.imageAssetUrl(`/api/v1/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/images/${id}/thumbnail?max_dim=768`) : "";
      const original = id ? apiClient.imageAssetUrl(`/api/v1/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/images/${id}/preview`) : "";
      const size = dimensions[item.relativePath];
      return <figure key={item.relativePath} className="overflow-hidden rounded-lg border border-croplens-border bg-white">
        {src && !failed[item.relativePath] ? <div className="flex min-h-64 items-center justify-center bg-gray-100 p-2"><a href={original} target="_blank" rel="noreferrer" title="Open the original image at full size"><Image src={src} alt={`${item.label}: ${item.relativePath}`} width={768} height={768} unoptimized loading="lazy" onError={async () => { let reason = "Thumbnail request failed for this version."; try { const response = await fetch(src); const body = await response.json() as {detail?: string}; if (body.detail) reason = body.detail; } catch { /* Keep the readable fallback if the API error body is unavailable. */ } setFailed(previous => ({...previous, [item.relativePath]: reason})); }} className="max-h-[28rem] w-full object-contain"/></a></div> : failed[item.relativePath] ? <div role="status" className="flex min-h-64 items-center justify-center bg-gray-100 p-4 text-center text-xs text-zinc-600">{failed[item.relativePath]}</div> : <div className="min-h-64 animate-pulse bg-gray-100" aria-label="Resolving image"/>}
        <figcaption className="space-y-1 p-2.5 text-[10px]">
          <p className="font-semibold text-zinc-800">{item.label}{item.className ? ` · ${item.className}` : ""}</p>
          <p className="break-all font-mono text-zinc-500">{item.relativePath}</p>
          {item.fileSizeBytes !== undefined && <p className="text-zinc-500">{(item.fileSizeBytes / 1024).toFixed(1)} KB{(size?.width ?? item.width) && (size?.height ?? item.height) ? ` · ${size?.width ?? item.width} × ${size?.height ?? item.height} px` : ""}</p>}
          {item.detail && <p className="text-zinc-600">{item.detail}</p>}
          {original && <a className="inline-block pt-1 font-semibold text-emerald-800 underline" href={original} target="_blank" rel="noreferrer">Open original at full size</a>}
        </figcaption>
      </figure>;
    })}
  </div>;
}
