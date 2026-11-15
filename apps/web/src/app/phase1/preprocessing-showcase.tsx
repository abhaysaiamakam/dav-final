"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { DashboardCard } from "@/components/ui/dashboard-card";

type Manifest = {
  dataset_id: string; version_id: string; source_fingerprint: string; analysis_id: string;
  analysis_methodology: string; dependency_versions: Record<string, string>; dataset_image_count: number; source_path: string; source_sha256: string;
  source_dimensions: number[]; preview_dimensions: number[]; created_at: string;
  provenance: Record<string, string>; normalization_range: {min: number; max: number; dtype: string};
  sobel_measurements: {mean_magnitude: number; p90_edge_density: number};
  artifacts: Array<{id: string; label: string; path: string; method: string}>;
};

const NOTES: Record<string, { reason: string; difference: string; impact: string; limitation: string }> = {
  resize: { reason: "Illustrate a smaller model-input candidate while preserving aspect ratio.", difference: "Lower pixel dimensions; fine leaf or lesion detail may be lost.", impact: "May reduce memory and batch cost; impacts all spatial measurements.", limitation: "One image only; no task-specific minimum lesion size has been established." },
  grayscale: { reason: "Show a luminance-only representation for experiments that do not use color.", difference: "Hue and saturation are removed.", impact: "Can discard disease cues carried by discoloration.", limitation: "This display does not establish grayscale model performance." },
  hue: { reason: "Expose the HSV hue channel for color-pattern review.", difference: "Shows hue as grayscale intensity.", impact: "Separates hue from saturation/value for inspection.", limitation: "Hue is unstable in low-saturation pixels; this is not a mask." },
  saturation: { reason: "Expose HSV saturation for colorfulness review.", difference: "Shows saturation as grayscale intensity.", impact: "May help inspect color variation independently.", limitation: "Lighting and camera settings affect the channel." },
  value: { reason: "Expose HSV value as a brightness-like channel.", difference: "Shows the maximum RGB channel per pixel.", impact: "Can reveal illumination variation.", limitation: "It is not calibrated physical illumination." },
  normalized: { reason: "Illustrate scaling RGB values into [0,1] for numeric pipelines.", difference: "Display is remapped to 8-bit, so appearance is similar to source.", impact: "Supports consistent numeric ranges for downstream models.", limitation: "The PNG cannot show float32 precision; no dataset-wide tensor was written." },
  "brightness-contrast": { reason: "Show sensitivity to a simple photometric adjustment.", difference: "Brightness and contrast are each multiplied by 1.2.", impact: "Can mimic acquisition variation but changes pixel values.", limitation: "May amplify or hide visual cues; no accuracy benefit is claimed." },
  augmentation: { reason: "Demonstrate a deterministic geometric augmentation.", difference: "Horizontal flip followed by 15° bicubic rotation; seed 42.", impact: "Adds orientation variation while retaining the source class label here.", limitation: "Rotation can introduce fill pixels and may not match field orientation." },
  sobel: { reason: "Show local edge magnitude for structural review.", difference: "Sobel magnitude is percentile-scaled for display.", impact: "Highlights boundaries and texture transitions.", limitation: "Edges are not disease segmentation, sharpness ground truth, or diagnosis." },
};

export function PreprocessingShowcase({ versionId }: { versionId: string }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/phase1-evidence/analysis/preprocessing_manifest.json", { cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<Manifest> : Promise.reject(new Error("Manifest unavailable")))
      .then(data => { if (active) setManifest(data); }).catch(() => { if (active) setManifest(null); });
    return () => { active = false; };
  }, []);

  if (!manifest || manifest.version_id !== versionId) return <DashboardCard title="Preprocessing evidence unavailable"><p className="text-xs text-zinc-600">No precomputed transform examples are available for this exact version.</p></DashboardCard>;
  const originalPreview = manifest.artifacts.find(artifact => artifact.id === "original")?.path ?? "/phase1-evidence/preprocessing/original.png";
  return <>
    <DashboardCard title="Preprocessing · actual source image" description="The examples below were precomputed from one real source image in the selected immutable version. They illustrate operations; they are not a dataset-wide preprocessing run.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[ ["Dataset version", manifest.version_id], ["Image analysis run", manifest.analysis_id], ["Source image", `${manifest.source_dimensions[0]} × ${manifest.source_dimensions[1]} px`], ["Normalization", `${manifest.normalization_range.dtype} · ${manifest.normalization_range.min.toFixed(3)} to ${manifest.normalization_range.max.toFixed(3)}`] ].map(([label, value]) => <div key={label} className="rounded-lg bg-gray-50 p-3"><p className="text-[10px] text-zinc-500">{label}</p><p className="mt-1 break-all text-xs font-semibold text-zinc-800">{value}</p></div>)}
      </div>
      <p className="mt-3 break-all text-[10px] text-zinc-500">Original path: {manifest.source_path} · SHA-256: {manifest.source_sha256}</p>
      <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">The curated source was opened read-only. All saved outputs are small display derivatives under the Phase 1 evidence bundle. The original image and registered dataset version were not changed. The normalized array is float32 in [0,1]; its PNG is remapped to 8-bit solely for display.</p>
    </DashboardCard>
    <div className="grid gap-4 lg:grid-cols-2">
      {manifest.artifacts.filter(artifact => artifact.id !== "original").map(artifact => { const note = NOTES[artifact.id]; return <DashboardCard key={artifact.id} title={artifact.label} description={artifact.method}>
        <div className="grid grid-cols-2 gap-2"><figure><div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-gray-50"><Image src={originalPreview} alt={`Original source image ${manifest.source_path}`} fill sizes="(max-width: 1024px) 50vw, 25vw" unoptimized className="object-contain"/></div><figcaption className="mt-1 text-center text-[9px] text-zinc-500">Original · {manifest.source_dimensions[0]} × {manifest.source_dimensions[1]}</figcaption></figure><figure><div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-gray-50"><Image src={artifact.path} alt={`${artifact.label} result from ${manifest.source_path}`} fill sizes="(max-width: 1024px) 50vw, 25vw" unoptimized className="object-contain"/></div><figcaption className="mt-1 text-center text-[9px] text-zinc-500">After · {artifact.label}</figcaption></figure></div>
        {note && <div className="mt-3 space-y-1 text-[10px] leading-relaxed text-zinc-600"><p><strong>Reason:</strong> {note.reason}</p><p><strong>Visible difference:</strong> {note.difference}</p><p><strong>Potential impact:</strong> {note.impact}</p><p><strong>Limitations:</strong> {note.limitation}</p></div>}
        <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">Same source image · {manifest.version_id}. This one-image example does not imply all {manifest.dataset_image_count.toLocaleString()} dataset images were transformed.</p>
      </DashboardCard>; })}
    </div>
    <DashboardCard title="Method and scientific limits" description={`Derived from ${manifest.analysis_methodology}; generated ${new Date(manifest.created_at).toLocaleString()}.`}>
      <div className="space-y-2 text-xs leading-relaxed text-zinc-700">
        {Object.entries(manifest.provenance).map(([name, value]) => <p key={name}><strong className="capitalize">{name.replaceAll("_", " ")}:</strong> {value}</p>)}
        <p><strong>Dependencies:</strong> {Object.entries(manifest.dependency_versions).map(([name,value]) => `${name} ${value}`).join(" · ")}.</p>
        <p><strong>Stored Sobel measurements:</strong> mean magnitude {manifest.sobel_measurements.mean_magnitude.toFixed(3)}; p90 edge density {manifest.sobel_measurements.p90_edge_density.toFixed(3)}. Sobel is an edge descriptor, not a disease segmentation or sharpness diagnosis.</p>
        <p>Brightness, contrast, flips and rotation are generic visual transforms. They may alter disease cues or labels. Review samples before choosing training augmentation; no accuracy claim is made.</p>
      </div>
    </DashboardCard>
  </>;
}
