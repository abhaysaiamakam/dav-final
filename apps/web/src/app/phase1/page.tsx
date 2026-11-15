"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, BarChart3, BookOpen, Check, ChevronLeft, ChevronRight, Code2, Copy, Download, FileImage, FlaskConical, Images, LoaderCircle, Play, Presentation, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import type { AvailableFeaturesResponse, AvailableOperationsResponse, DataQualityAssessment, DatasetImage, DatasetImageListResponse, DatasetValidationResult, DuplicateAnalysisResult, EdaReport, FeaturePreviewResponse, ImageIntelligenceResponse, InsightCollectionResponse, PreprocessingOperationConfig, PreprocessingPreviewResponse, VisualizationCollectionResponse } from "@croplens/shared-types";
import { CodeLensExplainability } from "@/components/ui/codelens";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { ErrorState } from "@/components/ui/error-state";
import { EvidenceImageGrid } from "@/components/evidence/evidence-image-grid";
import { PageContainer } from "@/components/layout/page-container";
import { WorkspaceDatasetSelect } from "@/components/ui/workspace-dataset-select";
import { WorkspaceVersionSelect } from "@/components/ui/workspace-version-select";
import { canRenderVisualization, VisualizationChart } from "@/components/ui/visualization-chart";
import { useDatasetContext } from "@/hooks/use-dataset-context";
import { useDatasetVersion } from "@/hooks/use-dataset-version";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { ArchiveEvidenceWorkspace } from "./archive-evidence-workspace";
import { ImageAnalysisVisuals, OriginalTransformPreview } from "./image-analysis-visuals";
import { PreprocessingShowcase } from "./preprocessing-showcase";
import { DimensionFrequencyTable } from "./dimension-frequency-table";
import { InsightsResearchStory } from "./insights-research-story";
import { PcaResearchPresentation } from "./pca-research-presentation";
import { FindingEvidenceVisuals } from "./finding-evidence-visuals";
import { Phase1PythonCodeCenter } from "./python-code-center";

type WorkspaceTab = "overview" | "eda" | "quality" | "gallery" | "preprocessing" | "features" | "insights" | "code";
const PAGE_SIZE = 24;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "overview", label: "Overview" }, { id: "eda", label: "EDA" }, { id: "quality", label: "Quality" },
  { id: "gallery", label: "Images" }, { id: "preprocessing", label: "Preprocessing" }, { id: "features", label: "Features & PCA" },
  { id: "insights", label: "Insights" }, { id: "code", label: "Python code" },
];

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not available";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return String(value);
}

function errorText(reason: unknown): string { return reason instanceof Error ? reason.message : "The CropLens API could not return this result."; }

function ImagePcaScatter({ points, onSelect }: { points: ImageIntelligenceResponse["pca"]["coordinates"]; onSelect?: (path: string) => void }) {
  if (!points.length) return <p className="mt-3 text-xs text-zinc-500">No PCA coordinates are available for this version.</p>;
  const width = 760, height = 320, pad = 28;
  const xs = points.map(point => point.PC1), ys = points.map(point => point.PC2);
  const minX = xs.reduce((a, b) => Math.min(a, b), Infinity), maxX = xs.reduce((a, b) => Math.max(a, b), -Infinity), minY = ys.reduce((a, b) => Math.min(a, b), Infinity), maxY = ys.reduce((a, b) => Math.max(a, b), -Infinity);
  const xSpan = maxX - minX || 1, ySpan = maxY - minY || 1;
  const classes = Array.from(new Set(points.map(point => point.class_name))).sort();
  const colorFor = (name: string) => `hsl(${Math.max(0, classes.indexOf(name)) * 360 / Math.max(classes.length, 1)}, 62%, 38%)`;
  return <div className="mt-3"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="PCA scatter plot colored by observed directory class; click a point to inspect its original image" className="h-auto w-full rounded-lg bg-zinc-50"><line x1={pad} y1={height-pad} x2={width-pad} y2={height-pad} stroke="#a1a1aa"/><line x1={pad} y1={pad} x2={pad} y2={height-pad} stroke="#a1a1aa"/><text x={width/2} y={height-5} textAnchor="middle" fontSize="10" fill="#52525b">PC1</text><text x="10" y={height/2} textAnchor="middle" fontSize="10" fill="#52525b" transform={`rotate(-90 10 ${height/2})`}>PC2</text>{points.map(point => <circle key={point.relative_path} cx={pad + ((point.PC1-minX)/xSpan)*(width-pad*2)} cy={height-pad-((point.PC2-minY)/ySpan)*(height-pad*2)} r="2.7" fill={colorFor(point.class_name)} fillOpacity="0.68" tabIndex={0} role="button" onClick={() => onSelect?.(point.relative_path)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(point.relative_path); } }} className="cursor-pointer"><title>{`${point.relative_path} · ${point.class_name} · PC1 ${point.PC1.toFixed(3)} · PC2 ${point.PC2.toFixed(3)}. Click to inspect.`}</title></circle>)}</svg><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-zinc-600">{classes.map(name => <span key={name} className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{backgroundColor: colorFor(name)}}/>{name}</span>)}</div><p className="mt-1 text-[10px] text-zinc-500">Points represent images; colors represent observed directory classes. Click a point for its image. Projection overlap or separation is exploratory and is not classification accuracy.</p></div>;
}

export default function Phase1SubmissionPage() {
  const context = useDatasetContext();
  const version = useDatasetVersion(context.selectedId, context.selected?.current_version_id);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadRequestId = useRef(0);
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [presentation, setPresentation] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("ICAR Rice and Maize Disease Dataset");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [artifactErrors, setArtifactErrors] = useState<string[]>([]);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [images, setImages] = useState<DatasetImageListResponse | null>(null);
  const [validation, setValidation] = useState<DatasetValidationResult | null>(null);
  const [quality, setQuality] = useState<DataQualityAssessment | null>(null);
  const [eda, setEda] = useState<EdaReport | null>(null);
  const [charts, setCharts] = useState<VisualizationCollectionResponse | null>(null);
  const [insights, setInsights] = useState<InsightCollectionResponse | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateAnalysisResult | null>(null);
  const [imageIntelligence, setImageIntelligence] = useState<ImageIntelligenceResponse | null>(null);
  const [imageIntelligenceBusy, setImageIntelligenceBusy] = useState(false);
  const [pcaSamplePath, setPcaSamplePath] = useState<string | null>(null);
  const [preprocessing, setPreprocessing] = useState<AvailableOperationsResponse | null>(null);
  const [features, setFeatures] = useState<AvailableFeaturesResponse | null>(null);
  const [galleryPage, setGalleryPage] = useState(1);
  const [cropFilter, setCropFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [imageSearch, setImageSearch] = useState("");
  const [operationType, setOperationType] = useState("");
  const [operationParameters, setOperationParameters] = useState("{}");
  const [targetColumns, setTargetColumns] = useState("");
  const [preview, setPreview] = useState<PreprocessingPreviewResponse | FeaturePreviewResponse | null>(null);
  const [lastDerived, setLastDerived] = useState<{ version: string; job: string } | null>(null);
  const [codeSelection, setCodeSelection] = useState<{ moduleId: string; symbol: string } | null>(null);

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    if (!context.selectedId || !version.versionId) {
      setImages(null); setValidation(null); setQuality(null); setEda(null); setCharts(null); setInsights(null); setDuplicates(null); setImageIntelligence(null); setPreprocessing(null); setFeatures(null); setArtifactErrors([]); return;
    }
    const datasetId = context.selectedId;
    const versionId = version.versionId;
    const [gallery, validationResult, qualityResult, edaResult, chartResult, insightResult, duplicateResult, imageIntelligenceResult, preprocessingResult, featureResult] = await Promise.allSettled([
      apiClient.getImages(datasetId, versionId, { page: galleryPage, page_size: PAGE_SIZE, crop: cropFilter, class_name: classFilter, search: imageSearch }),
      apiClient.getVersionValidation(datasetId, versionId),
      apiClient.getQuality(datasetId, versionId), apiClient.getEda(datasetId, versionId), apiClient.getVisualizations(datasetId, versionId),
      apiClient.getInsights(datasetId, versionId), apiClient.getDuplicates(datasetId, versionId),
      apiClient.getImageIntelligence(datasetId, versionId),
      apiClient.getPreprocessingOperations(datasetId), apiClient.getAvailableFeatures(datasetId),
    ]);
    if (requestId !== loadRequestId.current) return;
    const results = [gallery, validationResult, qualityResult, edaResult, chartResult, insightResult, duplicateResult, imageIntelligenceResult, preprocessingResult, featureResult];
    const labels = ["Image gallery", "version validation", "Quality", "EDA", "visualizations", "insights", "duplicate detection", "image intelligence", "preprocessing registry", "feature registry"];
    setArtifactErrors(results.flatMap((result, index) => result.status === "rejected" && !(result.reason instanceof ApiClientError && result.reason.status === 404) ? [`${labels[index]}: ${errorText(result.reason)}`] : []));
    setImages(gallery.status === "fulfilled" ? gallery.value : null);
    setValidation(validationResult.status === "fulfilled" && validationResult.value.dataset_id === datasetId ? validationResult.value : null);
    setQuality(qualityResult.status === "fulfilled" && qualityResult.value.version_id === versionId ? qualityResult.value : null);
    setEda(edaResult.status === "fulfilled" && edaResult.value.version_id === versionId ? edaResult.value : null);
    setCharts(chartResult.status === "fulfilled" && chartResult.value.dataset_version === versionId ? chartResult.value : null);
    setInsights(insightResult.status === "fulfilled" && insightResult.value.dataset_version === versionId ? insightResult.value : null);
    setDuplicates(duplicateResult.status === "fulfilled" && duplicateResult.value.version_id === versionId ? duplicateResult.value : null);
    setImageIntelligence(imageIntelligenceResult.status === "fulfilled" && imageIntelligenceResult.value.version_id === versionId ? imageIntelligenceResult.value : null);
    setPreprocessing(preprocessingResult.status === "fulfilled" ? preprocessingResult.value : null);
    setFeatures(featureResult.status === "fulfilled" ? featureResult.value : null);
  }, [context.selectedId, version.versionId, galleryPage, cropFilter, classFilter, imageSearch]);

  useEffect(() => { void load(); }, [load, refreshCounter]);
  useEffect(() => { setGalleryPage(1); setClassFilter(""); setPreview(null); setLastDerived(null); }, [context.selectedId, version.versionId, cropFilter, imageSearch]);

  const cropNames = useMemo(() => Array.from(new Set((images?.classes ?? []).map(item => item.class_name.split("/")[0]).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [images?.classes]);
  const visibleClasses = useMemo(() => (images?.classes ?? []).filter(item => !cropFilter || item.class_name.toLocaleLowerCase().startsWith(`${cropFilter.toLocaleLowerCase()}/`)), [images?.classes, cropFilter]);
  const imageOperations = (preprocessing?.operations ?? []).filter(operation => operation.modality === "image");
  const featureOperations = (features?.operations ?? []).filter(operation => operation.modality === "image");
  const selectedOperation = [...imageOperations, ...featureOperations].find(operation => operation.operation_type === operationType);
  const isFeatureOperation = featureOperations.some(operation => operation.operation_type === operationType);
  const selectedName = `${context.selected?.id ?? ""} ${context.selected?.name ?? ""}`.toLocaleLowerCase();
  const selectedPhase1Dataset = selectedName.includes("rice") && selectedName.includes("maize");
  const validVersion = Boolean(context.selectedId && version.versionId && selectedPhase1Dataset);
  const activeVersion = version.versions.find(item => item.version_id === version.versionId);
  const imageCharts = (charts?.items ?? []).filter(item => ["class_distribution", "image_geometry", "format_and_color", "duplicates", "annotations"].includes(item.category) && canRenderVisualization(item));

  async function runImageIntelligence() {
    if (!context.selectedId || !version.versionId) return;
    setImageIntelligenceBusy(true);
    setActionError(null);
    try {
      const result = await apiClient.analyzeImageIntelligence(context.selectedId, version.versionId);
      if (result.version_id === version.versionId) setImageIntelligence(result);
    } catch (error) {
      setActionError(`Image intelligence: ${errorText(error)}`);
    } finally {
      setImageIntelligenceBusy(false);
    }
  }

  function downloadImageFeatureCsv() {
    if (!imageIntelligence || imageIntelligence.version_id !== version.versionId) return;
    const rows = imageIntelligence.image_measurements;
    const keys = Array.from(new Set(rows.flatMap(row => Object.keys(row.features)))).sort();
    const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [["relative_path", "observed_class", ...keys].map(cell).join(","), ...rows.map(row => [row.relative_path, row.class_name, ...keys.map(key => row.features[key] ?? "")].map(cell).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `croplens-image-features-${imageIntelligence.version_id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function openPythonFunction(moduleId: string, symbol: string) {
    setCodeSelection({ moduleId, symbol });
    setTab("code");
  }

  async function chooseArchive(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    if (!/\.(zip|tar|tar\.gz|tgz)$/i.test(file.name)) { setUploadFile(null); setUploadError("Choose a .zip, .tar, .tar.gz, or .tgz dataset archive."); return; }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadFile(file);
      setUploadError(`This archive is ${(file.size / (1024 * 1024)).toFixed(1)} MiB. The current documented CropLens API upload limit is 500 MiB; no supported large-upload mechanism is configured in this repository.`);
      return;
    }
    setUploadFile(file);
  }

  async function uploadArchive() {
    if (!uploadFile || uploadFile.size > MAX_UPLOAD_BYTES) return;
    setUploading(true); setUploadError(null); setUploadProgress(0);
    try {
      const response = await apiClient.uploadDataset(uploadFile, uploadName || undefined, undefined, setUploadProgress);
      const url = new URL(window.location.href); url.searchParams.set("dataset", response.dataset_id); window.history.replaceState(null, "", url);
      await context.reload();
      setActionError(`Upload registered as ${response.dataset_id}, version ${response.version_id}. Track job ${response.job_id} before relying on analysis results.`);
      setUploadFile(null);
    } catch (reason) { setUploadError(errorText(reason)); }
    finally { setUploading(false); }
  }

  async function runAnalysis() {
    if (!validVersion || busy) return;
    setBusy(true); setActionError(null);
    const failures: string[] = [];
    try {
      const refreshed = await apiClient.runUnifiedAnalysis(context.selectedId, true);
      if (refreshed.version_id !== version.versionId) failures.push(`Validation completed for ${refreshed.version_id}, but this page is showing ${version.versionId}.`);
    } catch (reason) { failures.push(`Full source validation: ${errorText(reason)}`); }
    try { await apiClient.detectDuplicates(context.selectedId, version.versionId); }
    catch (reason) { failures.push(`Exact duplicate detection: ${errorText(reason)}`); }
    const [qualityResult, edaResult, imageResult] = await Promise.allSettled([
      apiClient.assessQuality(context.selectedId, version.versionId),
      apiClient.runEda(context.selectedId, version.versionId),
      apiClient.analyzeImageIntelligence(context.selectedId, version.versionId),
    ]);
    if (qualityResult.status === "rejected") failures.push(`Quality: ${errorText(qualityResult.reason)}`);
    if (edaResult.status === "rejected") failures.push(`EDA: ${errorText(edaResult.reason)}`);
    if (imageResult.status === "rejected") failures.push(`Image features and near duplicates: ${errorText(imageResult.reason)}`);
    try { await apiClient.regenerateInsights(context.selectedId, version.versionId); }
    catch (reason) { failures.push(`Insights: ${errorText(reason)}`); }
    setActionError(failures.length ? failures.join(" · ") : "Full image validation, Quality, EDA, exact and near-duplicate detection, image features and Insights refreshed for this version.");
    setRefreshCounter(value => value + 1);
    setBusy(false);
  }

  function makeOperation(): PreprocessingOperationConfig | null {
    if (!operationType || !selectedOperation) return null;
    let parameters: Record<string, unknown>;
    try { parameters = JSON.parse(operationParameters) as Record<string, unknown>; }
    catch { setActionError("Parameters must be valid JSON."); return null; }
    return { operation_type: operationType, modality: selectedOperation.modality, parameters, target_columns: targetColumns.split(",").map(value => value.trim()).filter(Boolean) };
  }

  async function runPreview() {
    const operation = makeOperation();
    if (!operation || !validVersion) return;
    setBusy(true); setActionError(null); setPreview(null);
    try {
      const result = isFeatureOperation
        ? await apiClient.previewFeatures(context.selectedId, version.versionId, [operation])
        : await apiClient.previewPreprocessing(context.selectedId, version.versionId, [operation]);
      setPreview(result);
    } catch (reason) { setActionError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function applyOperation() {
    const operation = makeOperation();
    if (!operation || !validVersion || busy) return;
    setBusy(true); setActionError(null);
    try {
      const result = isFeatureOperation
        ? await apiClient.applyFeatures(context.selectedId, version.versionId, [operation], `Phase 1: ${selectedOperation?.display_name}`)
        : await apiClient.applyPreprocessing(context.selectedId, version.versionId, [operation], `Phase 1: ${selectedOperation?.display_name}`);
      setLastDerived({ version: result.derived_version_id, job: result.job_id });
      await version.reload();
      version.select(result.derived_version_id);
      setRefreshCounter(value => value + 1);
    } catch (reason) { setActionError(errorText(reason)); }
    finally { setBusy(false); }
  }

  const metricTiles = eda ? [
    ["Valid images", eda.overview.total_valid_images], ["Classes", eda.overview.class_count], ["Formats", eda.overview.format_count], ["Image findings", eda.findings.length],
  ] : [];

  return <PageContainer title="ICAR Rice and Maize Disease Dataset" description="Phase 1 submission workspace · Complete analysis, evidence, versioned transformations, and presentation preparation." badge="Phase 2 presentation" actions={<div className="flex flex-wrap items-center gap-2">{!presentation && <button type="button" onClick={() => setShowUpload(value => !value)} aria-expanded={showUpload} className="inline-flex h-10 items-center gap-2 rounded-lg border border-croplens-border bg-white px-3 text-xs font-semibold text-zinc-700"><Upload size={15}/>Submit archive</button>}<button type="button" aria-pressed={presentation} onClick={() => { setPresentation(value => !value); if (tab === "code") setTab("overview"); }} className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${presentation ? "border-emerald-700 bg-emerald-700 text-white" : "border-croplens-border bg-white text-zinc-700"}`}><Presentation size={15}/>{presentation ? "Exit presentation" : "Presentation mode"}</button>{!presentation && <button type="button" onClick={() => void runAnalysis()} disabled={!validVersion || busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle size={15} className="animate-spin"/> : <Play size={15}/>}Run version analysis</button>}</div>}>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        {context.error && <ErrorState title="Dataset registry unavailable" message={context.error} onRetry={() => void context.reload()}/>}
        {version.error && <ErrorState title="Version registry unavailable" message={version.error} onRetry={() => void version.reload()}/>}
        {actionError && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">{actionError}</div>}
        {artifactErrors.length > 0 && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900"><p className="font-semibold">Some selected-version artifacts could not be loaded</p>{artifactErrors.map((error, index) => <p key={`${index}-${error}`} className="mt-1">{error}</p>)}</div>}
        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-croplens-border bg-white p-1" aria-label="Phase 1 workspace sections">{TABS.map(item => <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium ${tab === item.id ? "bg-emerald-700 text-white" : "text-zinc-600 hover:bg-gray-100"}`}>{item.label}</button>)}</nav>
        {presentation && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-950"><strong>Presentation sequence:</strong> Overview → EDA → Quality → Images → Preprocessing → Feature engineering/PCA → Insights → Python code → Conclusions. Historical ZIP evidence and current version-backed API results are shown as separate artifacts.</div>}
        <ArchiveEvidenceWorkspace section={tab} presentation={presentation} activeVersion={activeVersion} activeAnalysisTimestamp={eda?.completed_at ?? quality?.completed_at}/>
        {!presentation && showUpload && !context.loading && <DashboardCard title="Select or submit the Phase 1 dataset" icon={<Upload size={17}/>} description="Choose an existing dataset and exact version, or submit an archive within the documented CropLens limit.">
          {context.selected && !selectedPhase1Dataset && <p className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">The selected registry record is not identified as the Rice and Maize submission. Choose the Phase 1 dataset record or upload its archive before showing analysis here.</p>}
          <div className="grid gap-2 sm:grid-cols-2"><WorkspaceDatasetSelect datasets={context.datasets} value={context.selectedId} onChange={context.select} loading={context.loading}/><WorkspaceVersionSelect versions={version.versions} value={version.versionId} onChange={version.select} loading={version.loading}/></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><label className="text-xs font-medium text-zinc-600">Archive<input ref={fileInput} type="file" accept=".zip,.tar,.gz,.tgz" className="mt-1 block w-full text-xs" onChange={event => void chooseArchive(event.target.files?.[0])}/></label><button onClick={() => void uploadArchive()} disabled={!uploadFile || uploading || uploadFile.size > MAX_UPLOAD_BYTES} className="self-end rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{uploading ? `Uploading ${uploadProgress ?? 0}%` : "Upload archive"}</button></div>
          <label className="mt-2 block text-xs text-zinc-600">Dataset name<input value={uploadName} onChange={event => setUploadName(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-croplens-border px-3"/></label>
          {uploadError && <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">{uploadError}</p>}
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">Maximum upload size: 500 MiB. CropLens has no resumable or large-archive upload endpoint configured here; oversized archives are blocked before transfer. Original archives are not split or modified.</p>
        </DashboardCard>}

        {validVersion && tab === "overview" && <section id="overview" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-croplens-border bg-white p-4"><div><p className="text-sm font-semibold text-zinc-900">{context.selected?.name ?? context.selectedId}</p><p className="mt-1 font-mono text-[11px] text-zinc-500">Dataset {context.selectedId} · Version {version.versionId}</p></div><div className="flex items-center gap-2"><WorkspaceDatasetSelect datasets={context.datasets} value={context.selectedId} onChange={context.select} loading={context.loading}/><WorkspaceVersionSelect versions={version.versions} value={version.versionId} onChange={version.select} loading={version.loading}/><button aria-label="Refresh selected version artifacts" onClick={() => setRefreshCounter(value => value + 1)} className="rounded-lg border border-croplens-border p-2"><RefreshCw size={15}/></button></div></div>
          {eda?.version_id === version.versionId ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metricTiles.map(([label, value]) => <div key={String(label)} className="rounded-xl border border-croplens-border bg-white p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-2xl font-semibold text-zinc-900">{show(value)}</p></div>)}</div><p className="text-[11px] text-zinc-500">Values are from EDA report {eda.id}; method {eda.methodology_version}. Dataset version {eda.version_id}.</p></> : <div className="rounded-xl border border-dashed border-croplens-border bg-white p-6 text-sm text-zinc-500">No EDA report exists for this exact version yet. Run version analysis after the dataset job finishes.</div>}
          {eda?.class_distribution && <DashboardCard title="Observed directory classes" icon={<BarChart3 size={17}/>} description="Counts and shares are computed from the selected version. Directory labels reflect the archive structure; they do not estimate field prevalence."><div className="space-y-2">{eda.class_distribution.distribution.map(item => <div key={item.class_name} className="grid grid-cols-[minmax(0,1fr)_minmax(100px,2fr)_70px] items-center gap-2 text-xs"><button type="button" onClick={() => { setClassFilter(item.class_name); setTab("gallery"); }} className="truncate text-left text-emerald-800 underline" title={`Open actual ${item.valid_image_count} images in ${item.class_name}`}>{item.class_name}</button><div className="h-2 overflow-hidden rounded bg-gray-100"><div className="h-full bg-emerald-600" style={{ width: `${Math.max(0, Math.min(100, item.percentage_of_valid))}%` }}/></div><button type="button" onClick={() => { setClassFilter(item.class_name); setTab("gallery"); }} className="text-right tabular-nums hover:text-emerald-800">{show(item.valid_image_count)} · {show(item.percentage_of_valid)}%</button></div>)}</div></DashboardCard>}
          {imageIntelligence?.version_id === version.versionId && <DashboardCard title="Representative source photographs" icon={<FileImage size={17}/>} description="Actual image samples from observed crop folders in this selected version."><EvidenceImageGrid datasetId={context.selectedId} versionId={version.versionId} images={Array.from(new Map(imageIntelligence.image_measurements.map(row => [row.class_name.split("/")[0], row])).values()).slice(0, 4).map(row => ({ relativePath: row.relative_path, label: "Observed folder sample", className: row.class_name, width: row.features.width, height: row.features.height }))}/></DashboardCard>}
          {imageCharts.filter(spec => ["class_distribution", "image_geometry"].includes(spec.category)).length > 0 && <div className="grid gap-4 lg:grid-cols-2">{imageCharts.filter(spec => ["class_distribution", "image_geometry"].includes(spec.category)).slice(0, 4).map(spec => <DashboardCard key={spec.visualization_id} title={spec.title} icon={<BarChart3 size={17}/>} description={spec.description}><VisualizationChart spec={spec} onSelect={row => { const className = String(row.class_name ?? row.label ?? row.category ?? row.class_name ?? ""); if (spec.category === "class_distribution" && className) { setClassFilter(className); setTab("gallery"); } }}/><p className="mt-3 border-t border-croplens-border pt-2 text-[10px] text-zinc-500">Bound to version {spec.dataset_version}{spec.category === "class_distribution" ? " · select a class to open its source images" : ""}</p></DashboardCard>)}</div>}
          <DashboardCard title="What can be concluded" icon={<BookOpen size={17}/>}><p className="text-xs leading-relaxed text-zinc-600">The class chart describes this submitted collection only. It does not establish disease prevalence in agriculture. For claims, use findings below with their source artifact, metric, affected files, and stated limitations.</p></DashboardCard>
        </section>}

          {validVersion && tab === "eda" && <section id="eda" className="space-y-4"><button type="button" onClick={() => openPythonFunction("eda", "EdaService._compute_class_distribution")} className="ml-auto block text-[10px] font-medium text-emerald-800 underline">View class distribution implementation</button><DashboardCard title="Exploratory data analysis" icon={<BarChart3 size={17}/>} description="Charts and summary metrics are displayed only when returned for the selected immutable version.">{eda?.version_id === version.versionId ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Discovered", eda.overview.total_discovered_files], ["Valid images", eda.overview.total_valid_images], ["Classes", eda.overview.class_count], ["Unique dimensions", eda.overview.unique_dimension_count]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-gray-50 p-3"><p className="text-[11px] text-zinc-500">{label}</p><p className="mt-1 text-lg font-semibold text-zinc-900">{show(value)}</p></div>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-gray-50 p-3"><p className="text-xs font-semibold">Image dimensions</p><p className="mt-1 text-xs">{show(eda.dimension_analysis?.min_width)}–{show(eda.dimension_analysis?.max_width)} px wide · {show(eda.dimension_analysis?.min_height)}–{show(eda.dimension_analysis?.max_height)} px high</p></div><div className="rounded-lg bg-gray-50 p-3"><p className="text-xs font-semibold">Image file size</p><p className="mt-1 text-xs">Mean {show(eda.file_size_analysis?.mean_human)} · Median {show(eda.file_size_analysis?.median_bytes)} bytes · Total {show(eda.file_size_analysis?.total_human)}</p></div></div><p className="mt-3 text-xs text-zinc-500">Formats: {Object.entries(eda.format_analysis?.format_distribution ?? {}).map(([format, count]) => `${format} ${show(count)}`).join(" · ") || "Not available"}. Dimensions shown from validated image metadata.</p></> : <p className="text-xs text-zinc-500">No selected-version EDA report is available. Run analysis to compute it.</p>}</DashboardCard>
          {imageCharts.map(spec => <DashboardCard key={spec.visualization_id} title={spec.title} icon={<BarChart3 size={17}/>} description={spec.description}><VisualizationChart spec={spec} onSelect={row => { const className = String(row.class_name ?? row.label ?? row.category ?? ""); if (spec.category === "class_distribution" && className) { setClassFilter(className); setTab("gallery"); } }}/></DashboardCard>)}
          {eda?.findings.map(finding => <DashboardCard key={finding.id} title={finding.title} badge={{ text: finding.severity, variant: finding.severity === "high" || finding.severity === "critical" ? "amber" : "neutral" }}><p className="text-xs leading-relaxed">{finding.explanation}</p><p className="mt-2 text-xs">{finding.metric_name}: <strong>{show(finding.observed_value)}</strong> {finding.expected_value !== null ? `· expected ${show(finding.expected_value)}` : ""}</p>{finding.affected_image_samples.length > 0 && <EvidenceImageGrid datasetId={context.selectedId} versionId={version.versionId} images={finding.affected_image_samples.map(path => ({ relativePath: path, label: finding.title, className: finding.affected_classes.join(", ") }))}/>}<FindingEvidenceVisuals finding={finding} eda={eda?.version_id === version.versionId ? eda : null} analysis={imageIntelligence?.version_id === version.versionId ? imageIntelligence : null} duplicates={duplicates?.version_id === version.versionId ? duplicates : null} datasetId={context.selectedId} versionId={version.versionId}/></DashboardCard>)}
          {eda?.version_id === version.versionId && <DimensionFrequencyTable frequency={eda.dimension_analysis?.dimension_frequency ?? {}} total={eda.overview.total_valid_images ?? 0} measurements={imageIntelligence?.version_id === version.versionId ? imageIntelligence.image_measurements : []} datasetId={context.selectedId} versionId={version.versionId}/> }</section>}

        {validVersion && tab === "quality" && <section id="quality" className="space-y-4"><div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-[10px]"><button type="button" onClick={() => openPythonFunction("quality", "_image_features")} className="font-medium text-emerald-800 underline">View image measurement implementation</button><button type="button" onClick={() => openPythonFunction("exact-duplicates", "DuplicateDetectionService.detect_duplicates")} className="font-medium text-emerald-800 underline">View SHA-256 duplicate implementation</button><button type="button" onClick={() => openPythonFunction("near-duplicate-groups", "_complete_link_groups")} className="font-medium text-emerald-800 underline">View pHash grouping implementation</button></div><DashboardCard title="Image quality assessment" icon={<ShieldCheck size={17}/>} description="Integrity, metadata and duplicate metrics are version-specific; unavailable evidence is not treated as a clean result.">{quality?.version_id === version.versionId ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Integrity", quality.integrity.integrity_rate], ["Decode / processing issues", validation ? validation.total_corrupted_images + validation.total_unreadable_images + validation.total_processing_errors + validation.total_unsupported_files + (validation.total_metadata_errors ?? 0) : null], ["Exact duplicate groups", quality.duplicate_impact.exact_duplicate_groups]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-gray-50 p-3"><p className="text-[11px] text-zinc-500">{label}</p><p className="mt-1 text-lg font-semibold text-zinc-900">{value == null ? "Not applicable / unavailable" : show(label === "Integrity" ? `${value}%` : value)}</p></div>)}</div><p className="mt-3 text-xs leading-relaxed text-zinc-600">Image bytes and decoding were assessed for this exact version. Review duplicate groups, class balance and measurement distributions below. CropLens’s composite quality score is intentionally not presented as a scientific measurement.</p>{validation && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><p><strong>Exact-version full decode:</strong> {validation.total_validated_images} of {validation.total_discovered_images} image paths decoded; {validation.total_processing_errors} processing errors, {validation.total_metadata_errors ?? 0} metadata errors, {validation.total_corrupted_images} corrupt, {validation.total_unreadable_images} inaccessible, and {validation.total_unsupported_files} unsupported.</p>{validation.total_processing_errors > 0 && <p className="mt-1">Processing errors are reported separately from corruption. Review each file and reason below; image decoder limits can prevent processing without indicating damaged source bytes.</p>}{(validation.images ?? []).filter(item => item.status !== "valid").map(item => <p key={item.relative_path} className="mt-2 break-all"><code>{item.relative_path}</code> · {item.status} · {item.error_message ?? "No decoder detail was recorded."}</p>)}</div>}<p className="mt-1 text-[10px] text-zinc-500">Assessment {quality.id} · version {quality.version_id} · {quality.quality_score.quality_tier}{quality.quality_score.is_complete ? " · complete inputs" : " · incomplete inputs"}</p>{imageIntelligence?.version_id === version.versionId && <p className="mt-2 text-[10px] text-zinc-500">Near-duplicate group counts belong to separate analyses: this Quality Lab assessment uses its own stored detector; the image-intelligence pHash result below uses threshold {show(imageIntelligence.near_duplicates.distance_threshold)} and complete-link grouping. Do not add these group counts together.</p>}</> : <p className="text-xs text-zinc-500">No Quality assessment for this version. Run analysis to compute it.</p>}</DashboardCard>
          <ClassBalanceCard distribution={eda?.version_id === version.versionId ? eda.class_distribution : null} onSelect={className => { setClassFilter(className); setTab("gallery"); }}/>
          <DashboardCard title="Image measurements and review candidates" icon={<Activity size={17}/>} description="Classical visual descriptors are computed from each selected-version image. Dataset-relative flags are prompts for review, not diagnoses.">{!presentation && <button onClick={() => void runImageIntelligence()} disabled={imageIntelligenceBusy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{imageIntelligenceBusy ? "Analyzing images…" : imageIntelligence?.version_id === version.versionId ? "Re-run image analysis" : "Run image analysis"}</button>}{actionError?.startsWith("Image intelligence:") && <p role="alert" className="mt-2 text-xs text-amber-800">{actionError}</p>}{imageIntelligence?.version_id === version.versionId && <><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{[["Analyzed", imageIntelligence.analyzed_images], ["Unreadable", imageIntelligence.unreadable_images], ["Review candidates", imageIntelligence.quality_flags.candidate_image_count], ["Near duplicate groups", imageIntelligence.near_duplicates.group_count]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-gray-50 p-3"><p className="text-[11px] text-zinc-500">{label}</p><p className="mt-1 text-lg font-semibold">{show(value)}</p></div>)}</div><p className="mt-2 text-[10px] text-zinc-500">Analysis {imageIntelligence.analysis_id} · {imageIntelligence.methodology_version} · version {imageIntelligence.version_id}</p><p className="mt-2 text-[10px] text-zinc-600">Metadata: {Object.entries(imageIntelligence.metadata_consistency.extension_to_format_counts as Record<string, number>).map(([pair, count]) => `${pair}: ${count}`).join(" · ") || "No decoded format pairs"}. Duplicate basenames: {show(imageIntelligence.metadata_consistency.duplicate_filename_count)} · explicit split paths: {imageIntelligence.metadata_consistency.explicit_split_available ? "observed" : "not observed"} · leakage: {imageIntelligence.leakage_investigation.status}.</p>{imageIntelligence.near_duplicates.groups.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold">Near-duplicate groups ({imageIntelligence.near_duplicates.group_count})</summary><div className="mt-2 space-y-3">{imageIntelligence.near_duplicates.groups.slice(0, 10).map(group => <div key={group.representative_path} className="rounded-lg border border-croplens-border p-3"><p className="break-all text-[10px] font-semibold">Representative: {group.representative_path}</p><p className="mt-1 text-[10px] text-zinc-500">Complete-link grouping · bit agreement is not a probability of visual identity.</p><EvidenceImageGrid datasetId={context.selectedId} versionId={version.versionId} images={group.members.map(member => ({ relativePath: member.relative_path, label: `Hamming distance ${member.hamming_distance_to_representative}`, className: "" }))}/></div>)}</div></details>}{imageIntelligence.quality_flags.candidates.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold">Review candidate images ({imageIntelligence.quality_flags.candidates.length})</summary><EvidenceImageGrid datasetId={context.selectedId} versionId={version.versionId} images={imageIntelligence.quality_flags.candidates.slice(0, 8).map(candidate => ({ relativePath: candidate.relative_path, label: Object.keys(candidate.flags).join(", ") || "Review candidate", className: candidate.class_name }))}/><ul className="mt-2 max-h-48 space-y-1 overflow-auto break-all text-[10px] text-zinc-600">{imageIntelligence.quality_flags.candidates.map(candidate => <li key={candidate.relative_path}>{candidate.relative_path} · {Object.keys(candidate.flags).join(", ")}</li>)}</ul><p className="mt-2 text-[10px] text-zinc-500">{imageIntelligence.quality_flags.rule}</p></details> }<div className="mt-3 flex flex-wrap gap-2"><button onClick={downloadImageFeatureCsv} className="rounded-lg border border-croplens-border px-3 py-2 text-xs font-semibold">Download feature matrix CSV</button><a href={"data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(imageIntelligence, null, 2))} download={"image-intelligence-" + imageIntelligence.version_id + ".json"} className="rounded-lg border border-croplens-border px-3 py-2 text-xs font-semibold">Download analysis JSON</a></div><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{["brightness_mean", "contrast_std", "laplacian_variance", "noise_mad_estimate"].map(metric => { const stats = imageIntelligence.numeric_distributions[metric]; return <div key={metric} className="rounded-lg bg-gray-50 p-3 text-[10px]"><p className="font-semibold text-zinc-700">{metric.replaceAll("_", " ")}</p><p className="mt-1 text-zinc-500">Mean {show(stats?.mean)} · Median {show(stats?.median)} · IQR {show(stats?.iqr)}</p></div>; })}</div><p className="mt-2 text-[10px] text-zinc-500">Candidate flags use dataset-relative Tukey 1.5×IQR fences; review candidates are not defects.</p></>}</DashboardCard>
          {imageIntelligence?.version_id === version.versionId && <ImageAnalysisVisuals analysis={imageIntelligence} datasetId={context.selectedId} versionId={version.versionId} scope="measurements"/>}
          {duplicates?.version_id === version.versionId && <DashboardCard title="Exact duplicate evidence" icon={<FileImage size={17}/>} description="Exact matches are groups with equal SHA-256 digests computed from streamed original file bytes. Near-duplicates use perceptual hashes and are shown separately."><p className="text-xs">{show(duplicates.successfully_hashed_images)} / {show(duplicates.total_eligible_images)} images hashed · {show(duplicates.hashing_failures)} failures · {show(duplicates.exact_duplicate_groups)} exact groups.</p>{duplicates.hashing_failures > 0 && <p role="alert" className="mt-2 flex items-center gap-2 text-xs text-amber-800"><AlertTriangle size={14}/>This is a partial scan and cannot support a zero-duplicates conclusion.</p>}{duplicates.warnings.map((warning, index) => <p key={index} className="mt-2 text-[11px] text-amber-800">{warning}</p>)}{duplicates.groups.map(group => <div key={group.group_id} className="mt-3 rounded-lg border border-croplens-border p-3"><p className="text-xs font-semibold">Group {group.group_id} · {group.image_count} members{group.is_cross_class ? " · cross-class" : ""}</p><p className="mt-1 text-[11px] text-zinc-500">SHA-256 byte identity · {group.classes_involved.join(" · ")}</p><EvidenceImageGrid datasetId={context.selectedId} versionId={version.versionId} images={[group.representative, ...group.duplicates].map(member => ({ relativePath: member.relative_path, label: `${member.is_representative ? "Representative" : "Exact match"} · group ${group.group_id} · ${group.image_count} members`, className: member.class_name, fileSizeBytes: member.file_size_bytes, width: member.width ?? undefined, height: member.height ?? undefined, detail: `SHA-256 ${group.sha256_hash}` }))}/></div>)}</DashboardCard>}
          {(quality?.findings ?? []).map(finding => { const decoderLimitFinding = finding.metric_name === "corrupted_image_count" && !!validation && validation.total_processing_errors > 0; return <DashboardCard key={finding.id} title={decoderLimitFinding ? "Large images need decoder-limit review" : finding.title} badge={{ text: decoderLimitFinding ? "review" : finding.severity, variant: decoderLimitFinding ? "amber" : finding.severity === "high" || finding.severity === "critical" ? "amber" : "neutral" }}><p className="text-xs leading-relaxed">{decoderLimitFinding ? `${validation.total_processing_errors} image paths were blocked by the configured decoder pixel limit during full validation. They are recorded as processing errors, not proven corrupt images. See the exact-version file paths and decoder messages above.` : finding.explanation}</p><p className="mt-2 text-xs">{finding.metric_name}: <strong>{show(finding.observed_value)}</strong>{decoderLimitFinding ? " confirmed corrupt files; processing errors are listed separately above" : ""}</p>{finding.affected_image_samples.length > 0 && <EvidenceImageGrid datasetId={context.selectedId} versionId={version.versionId} images={finding.affected_image_samples.map(path => ({ relativePath: path, label: decoderLimitFinding ? "Decoder-limit processing error" : finding.title, className: finding.affected_classes.join(", ") }))}/>}<FindingEvidenceVisuals finding={finding} eda={eda?.version_id === version.versionId ? eda : null} analysis={imageIntelligence?.version_id === version.versionId ? imageIntelligence : null} duplicates={duplicates?.version_id === version.versionId ? duplicates : null} datasetId={context.selectedId} versionId={version.versionId}/></DashboardCard>; })}</section>}

        {validVersion && tab === "gallery" && <section id="gallery" className="space-y-4"><DashboardCard title="Image gallery" icon={<Images size={17}/>} description="Paginated from the selected version. Thumbnails load on demand; source files are not all sent to the browser."><div className="grid gap-2 sm:grid-cols-3"><label className="text-[11px] text-zinc-600">Crop hierarchy<select value={cropFilter} onChange={event => setCropFilter(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-croplens-border bg-white px-2"><option value="">All crops</option>{cropNames.map(name => <option key={name}>{name}</option>)}</select></label><label className="text-[11px] text-zinc-600">Disease / class<select value={classFilter} onChange={event => setClassFilter(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-croplens-border bg-white px-2"><option value="">All classes</option>{visibleClasses.map(item => <option key={item.class_name} value={item.class_name}>{item.class_name} ({item.image_count})</option>)}</select></label><label className="text-[11px] text-zinc-600">Search file<input value={imageSearch} onChange={event => setImageSearch(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-croplens-border px-2" placeholder="Filename contains…"/></label></div>
          {images ? <><p className="mt-3 text-[11px] text-zinc-500">{show(images.total)} matching images · page {images.page} · class mapping {images.class_structure}</p><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{images.items.map(item => <ImageCard key={item.image_id} image={item} datasetId={context.selectedId} versionId={version.versionId} presentation={presentation} measurement={imageIntelligence?.version_id === version.versionId ? imageIntelligence.image_measurements.find(row => row.image_id === item.image_id) : undefined}/>)}</div><div className="mt-4 flex items-center justify-between"><button onClick={() => setGalleryPage(page => Math.max(1, page - 1))} disabled={galleryPage <= 1} className="inline-flex items-center gap-1 rounded-lg border border-croplens-border px-3 py-2 text-xs disabled:opacity-40"><ChevronLeft size={14}/>Previous</button><span className="text-xs text-zinc-500">{galleryPage} / {Math.max(1, Math.ceil(images.total / PAGE_SIZE))}</span><button onClick={() => setGalleryPage(page => Math.min(Math.max(1, Math.ceil(images.total / PAGE_SIZE)), page + 1))} disabled={galleryPage >= Math.ceil(images.total / PAGE_SIZE)} className="inline-flex items-center gap-1 rounded-lg border border-croplens-border px-3 py-2 text-xs disabled:opacity-40">Next<ChevronRight size={14}/></button></div></> : <p className="mt-4 text-xs text-zinc-500">No image listing was returned for this version. The selected version may not contain supported images.</p>}</DashboardCard></section>}

        {validVersion && tab === "preprocessing" && <section id="preprocessing" className="space-y-4"><button type="button" onClick={() => openPythonFunction("image-preprocessing", "AugmentImagesOperation._transform")} className="ml-auto block text-[10px] font-medium text-emerald-800 underline">View preprocessing implementation</button>{presentation && <PreprocessingShowcase versionId={version.versionId}/> }{!presentation && <DashboardCard title="Versioned preprocessing" icon={<FlaskConical size={17}/>} description="Preview changes against the selected source version. Applying creates a derived version and leaves the source version intact."><OperationForm operations={imageOperations} operationType={operationType} setOperationType={setOperationType} parameters={operationParameters} setParameters={setOperationParameters} targetColumns={targetColumns} setTargetColumns={setTargetColumns}/><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void runPreview()} disabled={!operationType || busy} className="rounded-lg border border-croplens-border px-3 py-2 text-xs font-semibold disabled:opacity-40">Preview against source</button><button onClick={() => void applyOperation()} disabled={!operationType || busy || !preview || !("can_apply" in preview ? preview.can_apply : false)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Create derived version</button></div>
          {preview && <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-zinc-950 p-3 text-[10px] text-emerald-100">{JSON.stringify(preview, null, 2)}</pre>}{imageOperations.length === 0 && <p className="mt-3 text-xs text-zinc-500">The API did not report image preprocessing operations for this dataset version.</p>}{lastDerived && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-950">Derived version {lastDerived.version} created; analysis job {lastDerived.job}. Source remains {version.versionId} until you select the derived version after reload.</p>}</DashboardCard>}<div className="flex flex-wrap gap-2 text-xs">{!presentation && <><Link className="rounded-lg border border-croplens-border px-3 py-2" href="/preprocessing">Open full preprocessing workspace</Link><CodeLensExplainability explanationId="preprocess.duplicates" resultTitle="Preprocessing API behavior" datasetVersion={version.versionId}/></>}</div></section>}

        {validVersion && tab === "features" && <section id="features" className="space-y-4">{!presentation && <><DashboardCard title="Feature engineering, selection and PCA" icon={<Activity size={17}/>} description="Only operations that the backend registry declares for image data are shown. PCA is meaningful only when an applicable numeric feature matrix exists."><OperationForm operations={featureOperations} operationType={operationType} setOperationType={setOperationType} parameters={operationParameters} setParameters={setOperationParameters} targetColumns={targetColumns} setTargetColumns={setTargetColumns}/><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void runPreview()} disabled={!operationType || !isFeatureOperation || busy} className="rounded-lg border border-croplens-border px-3 py-2 text-xs font-semibold disabled:opacity-40">Preview feature operation</button><button onClick={() => void applyOperation()} disabled={!operationType || !isFeatureOperation || busy || !(preview && "can_apply" in preview && preview.can_apply)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Create feature version</button></div>
          {preview && "operations" in preview && preview.operations.map((result, index) => <div key={index} className="mt-3 rounded-lg border border-croplens-border p-3"><p className="text-xs font-semibold">{result.operation_type} · {result.status}</p><p className="mt-1 text-xs">Generated: {"generated_features" in result ? result.generated_features.join(", ") || "none" : "—"}</p>{"explained_variance_ratio" in result && result.explained_variance_ratio && <><p className="mt-1 text-xs">Explained variance: {result.explained_variance_ratio.map(value => `${(value * 100).toFixed(2)}%`).join(" · ")}</p><p className="mt-1 text-xs">Cumulative: {result.cumulative_explained_variance?.map(value => `${(value * 100).toFixed(2)}%`).join(" · ")}</p></>}</div>)}
          {featureOperations.length === 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-950">No image-modality feature engineering or PCA operation is available in CropLens’s current feature registry for this dataset. The local Python script below computes a separate color-histogram PCA; it is explicitly not a production CropLens artifact or a disease classifier.</p>}{features?.current_features.map(feature => <p key={feature.feature_id} className="mt-2 text-xs text-zinc-600">{feature.feature_name} · {feature.feature_type} · {feature.description}</p>)}</DashboardCard><CodeLensExplainability explanationId="feature.pca" resultTitle="Production PCA operation" datasetVersion={version.versionId}/></>}</section>}

        {validVersion && tab === "features" && imageIntelligence?.version_id === version.versionId && <><div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-[10px]"><button type="button" onClick={() => openPythonFunction("visual-features", "_image_features")} className="font-medium text-emerald-800 underline">View RGB/HSV/texture extraction</button><button type="button" onClick={() => openPythonFunction("statistics", "_correlation")} className="font-medium text-emerald-800 underline">View feature correlation</button><button type="button" onClick={() => openPythonFunction("pca", "ImageIntelligenceService.analyze")} className="font-medium text-emerald-800 underline">View feature matrix and PCA</button></div><PcaResearchPresentation analysis={imageIntelligence} datasetId={context.selectedId} versionId={version.versionId} selectedPath={pcaSamplePath} onSelect={setPcaSamplePath}/><details className="rounded-lg border border-croplens-border bg-white p-3"><summary className="cursor-pointer text-xs font-semibold text-zinc-800">Explore input feature distributions and relationships</summary><div className="mt-3"><ImageAnalysisVisuals analysis={imageIntelligence} datasetId={context.selectedId} versionId={version.versionId} scope="features"/>{Array.isArray(imageIntelligence.correlation.top_pairs) && imageIntelligence.correlation.top_pairs.length > 0 && <DashboardCard title="Strong numeric feature associations" description="Persisted correlations among extracted numeric image descriptors; association does not establish causation."><ul className="space-y-1 text-[10px] text-zinc-600">{(imageIntelligence.correlation.top_pairs as Array<{feature_a:string;feature_b:string;pearson:number;spearman:number}>).slice(0,12).map(pair=><li key={`${pair.feature_a}:${pair.feature_b}`}>{pair.feature_a} ↔ {pair.feature_b} · Pearson {show(pair.pearson)} · Spearman {show(pair.spearman)}</li>)}</ul></DashboardCard>}</div></details></>}


        {validVersion && tab === "insights" && <InsightsResearchStory datasetId={context.selectedId} versionId={version.versionId} eda={eda?.version_id === version.versionId ? eda : null} validation={validation?.dataset_id === context.selectedId ? validation : null} duplicates={duplicates?.version_id === version.versionId ? duplicates : null} analysis={imageIntelligence?.version_id === version.versionId ? imageIntelligence : null} selectedPath={pcaSamplePath} onSelectPath={setPcaSamplePath} visualEnrichment={context.selectedId === "icar-rice-maize"}/> }
        {validVersion && tab === "insights" && context.selectedId !== "icar-rice-maize" && imageIntelligence?.version_id === version.versionId && <DashboardCard title="PCA image distribution" icon={<Activity size={17}/>} description="Persisted coordinates for selected-version image measurements; exploratory projection, not classification performance."><ImagePcaScatter points={imageIntelligence.pca.coordinates} onSelect={setPcaSamplePath}/>{pcaSamplePath && <EvidenceImageGrid datasetId={context.selectedId} versionId={version.versionId} images={[{relativePath:pcaSamplePath,label:"Selected PCA point",className:imageIntelligence.pca.coordinates.find(point => point.relative_path === pcaSamplePath)?.class_name ?? ""}]}/>}</DashboardCard>}

        {tab === "code" && <section id="code" className="space-y-4"><DashboardCard title="Python Analysis & Code Walkthrough" icon={<Code2 size={17}/>} description="A beginner-friendly analysis script alongside the exact, version-aware CropLens production implementation."><Phase1PythonCodeCenter datasetId={context.selectedId ?? "icar-rice-maize"} versionId={version.versionId ?? ""} fingerprint={activeVersion?.content_fingerprint} analysisId={imageIntelligence?.version_id === version.versionId ? imageIntelligence.analysis_id : undefined} analyzedImages={imageIntelligence?.version_id === version.versionId ? imageIntelligence.analyzed_images : undefined} analysisConfig={imageIntelligence?.version_id === version.versionId ? imageIntelligence.configuration : undefined} provenance={imageIntelligence?.version_id === version.versionId ? imageIntelligence.provenance : undefined} analysis={imageIntelligence?.version_id === version.versionId ? imageIntelligence : undefined} duplicates={duplicates?.version_id === version.versionId ? duplicates : undefined} sampleImages={images?.version_id === version.versionId ? images.items : []} pca={imageIntelligence?.version_id === version.versionId ? imageIntelligence.pca : undefined} requestedFunction={codeSelection}/></DashboardCard></section>}
      </div>

      {!presentation && <aside className="space-y-4">
        <DashboardCard title="Dataset context" icon={<FileImage size={17}/>}><WorkspaceDatasetSelect datasets={context.datasets} value={context.selectedId} onChange={context.select} loading={context.loading}/><div className="mt-2"><WorkspaceVersionSelect versions={version.versions} value={version.versionId} onChange={version.select} loading={version.loading}/></div>{activeVersion && <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 text-[10px] text-zinc-600"><p>Status <strong>{activeVersion.status}</strong> · {show(validation?.total_validated_images ?? activeVersion.image_count)} valid images · {show(activeVersion.class_count)} classes</p><p>Source <code className="break-all">{activeVersion.storage_relative_path}</code></p><p>Fingerprint <code>{activeVersion.content_fingerprint.slice(0, 12)}…</code></p><p>Last analysis {eda?.completed_at || quality?.completed_at ? new Date(eda?.completed_at ?? quality?.completed_at ?? "").toLocaleString() : "Not completed yet"}</p></div>}</DashboardCard>
        {!presentation && <DashboardCard title="Analysis controls" icon={<Activity size={17}/>}><button onClick={() => void runAnalysis()} disabled={!validVersion || busy} className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy ? "Running…" : "Run analysis for this version"}</button><p className="mt-2 text-[10px] text-zinc-500">Runs Quality, EDA, exact duplicate detection, and Insights through CropLens APIs.</p></DashboardCard>}
        <DashboardCard title="Presentation sequence" icon={<Presentation size={17}/>}><ol className="list-inside list-decimal space-y-2 text-xs text-zinc-600">{["Dataset overview", "Exploratory analysis", "Data quality", "Preprocessing", "Feature engineering and PCA", "Evidence-backed insights", "Conclusions"].map((label, index) => <li key={label}><button onClick={() => { setPresentation(true); document.getElementById(["overview", "eda", "quality", "preprocessing", "features", "insights", "insights"][index])?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="text-left hover:text-emerald-800">{label}</button></li>)}</ol></DashboardCard>
        <DashboardCard title="Source code roles" icon={<Code2 size={17}/>}><p className="text-xs leading-relaxed text-zinc-600"><strong>Python Analysis</strong> is a runnable local archive analysis script. <strong>CodeLens</strong> points to the production API algorithm and frontend rendering path. These are not represented as the same implementation.</p><div className="mt-3 flex flex-wrap gap-2 text-[10px]"><Link href="/quality" className="rounded border border-croplens-border px-2 py-1">Quality</Link><Link href="/eda" className="rounded border border-croplens-border px-2 py-1">EDA</Link><Link href="/preprocessing" className="rounded border border-croplens-border px-2 py-1">Preprocessing</Link><Link href="/features" className="rounded border border-croplens-border px-2 py-1">Features</Link></div></DashboardCard>
      </aside>}
    </div>
  </PageContainer>;
}

function ClassBalanceCard({ distribution, onSelect }: { distribution: EdaReport["class_distribution"] | null; onSelect: (className: string) => void }) {
  if (!distribution) return <DashboardCard title="Class balance" icon={<BarChart3 size={17}/>}><p className="text-xs text-zinc-500">No class distribution is persisted for the selected version.</p></DashboardCard>;
  const counts = distribution.distribution.map(row => row.valid_image_count);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const maximum = Math.max(1, ...counts);
  return <DashboardCard title="Class balance by observed folder" icon={<BarChart3 size={17}/>} description="Each bar uses exact image-path counts from the selected version. Select a class to inspect its original images.">
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-lg bg-gray-50 p-2"><p className="text-[10px] text-zinc-500">Classes / images</p><p className="text-sm font-semibold">{distribution.total_classes} / {show(total)}</p></div><div className="rounded-lg bg-gray-50 p-2"><p className="text-[10px] text-zinc-500">Mean / class</p><p className="text-sm font-semibold">{show(distribution.mean_count)}</p></div><div className="rounded-lg bg-gray-50 p-2"><p className="text-[10px] text-zinc-500">Std. deviation</p><p className="text-sm font-semibold">{show(distribution.std_count)}</p></div><div className="rounded-lg bg-gray-50 p-2"><p className="text-[10px] text-zinc-500">Coefficient of variation</p><p className="text-sm font-semibold">{show(distribution.coefficient_of_variation)}</p></div></div>
    <div className="space-y-2">{distribution.distribution.slice().sort((a, b) => a.class_name.localeCompare(b.class_name)).map(row => <div key={row.class_name} className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,1.4fr)_5.5rem] items-center gap-2 text-[10px]"><button type="button" onClick={() => onSelect(row.class_name)} title={`Inspect ${row.valid_image_count} source images`} className="truncate text-left text-emerald-800 underline">{row.class_name}</button><div className="h-2 overflow-hidden rounded bg-gray-100"><div className="h-full rounded bg-emerald-700" style={{width: `${(row.valid_image_count / maximum) * 100}%`}}/></div><span className="text-right tabular-nums">{show(row.valid_image_count)} · {show(total ? row.valid_image_count * 100 / total : 0)}%</span></div>)}</div>
    <p className="mt-3 border-t border-croplens-border pt-2 text-[10px] leading-relaxed text-zinc-600">For ML/DL, class counts describe available labeled examples and can flag sampling imbalance; they do not show real-world disease prevalence. The chart counts all discovered source image paths in the class folders. A low coefficient of variation means counts are similar, but does not prove that images, sites, or conditions are representative.</p>
  </DashboardCard>;
}

function ImageCard({ image, datasetId, versionId, presentation, measurement }: { image: DatasetImage; datasetId: string; versionId: string; presentation: boolean; measurement?: ImageIntelligenceResponse["image_measurements"][number] }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [transformsOpen, setTransformsOpen] = useState(false);
  return <figure className="overflow-hidden rounded-lg border border-croplens-border bg-white"><div className="relative aspect-[4/3] bg-zinc-100">{!failed ? <><Image src={apiClient.imageAssetUrl(image.thumbnail_url)} alt={`${image.class_name}: ${image.filename}`} fill sizes="(max-width: 640px) 100vw, 33vw" unoptimized loading="lazy" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className={`object-contain transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}/>{!loaded && <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500" role="status">Loading thumbnail…</div>}</> : <div className="flex h-full flex-col items-center justify-center gap-1 p-5 text-center text-xs text-zinc-600"><strong>Preview unavailable</strong><span>{image.error_message ?? "The thumbnail endpoint did not return an image."}</span></div>}</div><figcaption className="space-y-1 p-2.5 text-[10px]"><p className="font-semibold">{image.class_name}</p><p className="break-all text-zinc-500">{image.filename}</p><p>{image.width ?? "?"} × {image.height ?? "?"} · {image.format ?? "unknown format"} · {(image.file_size_bytes / 1024).toFixed(1)} KB · {image.color_mode ?? "mode unavailable"}</p><p className="text-zinc-500">{image.status} · {datasetId} / {versionId}</p><a href={apiClient.imageAssetUrl(image.preview_url)} target="_blank" rel="noreferrer" className="inline-block text-emerald-800 underline">Open original image at full size</a>{measurement && <details className="pt-1"><summary className="cursor-pointer font-semibold">Image measurements and flags</summary><p className="mt-1">Brightness {show(measurement.features.brightness_mean)} · contrast {show(measurement.features.contrast_std)} · Laplacian variance {show(measurement.features.laplacian_variance)} · noise estimate {show(measurement.features.noise_mad_estimate)}</p>{Object.keys(measurement.quality_flags ?? {}).length > 0 && <p className="mt-1 text-amber-800">Review flags: {Object.keys(measurement.quality_flags ?? {}).join(", ")} · candidate only</p>}</details>}{!presentation ? <details className="pt-1" onToggle={event => setTransformsOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">Inspect transforms</summary>{transformsOpen && <OriginalTransformPreview datasetId={datasetId} versionId={versionId} imageId={image.image_id} originalUrl={image.preview_url}/>}</details> : <p className="pt-1 text-[9px] text-zinc-500">Precomputed transform examples are in the Preprocessing section.</p>}</figcaption></figure>;
}

function OperationForm({ operations, operationType, setOperationType, parameters, setParameters, targetColumns, setTargetColumns }: { operations: Array<{ operation_type: string; display_name: string; description: string; known_limitations: string[]; parameters_schema: Record<string, unknown> }>; operationType: string; setOperationType: (value: string) => void; parameters: string; setParameters: (value: string) => void; targetColumns: string; setTargetColumns: (value: string) => void }) {
  const selected = operations.find(item => item.operation_type === operationType);
  const schema = (selected?.parameters_schema.properties ?? {}) as Record<string, {type?: string; title?: string; description?: string; default?: unknown; enum?: unknown[]; minimum?: number; maximum?: number; items?: unknown}>;
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(parameters || "{}") as Record<string, unknown>; } catch { current = {}; }
  const setValue = (key: string, value: unknown) => setParameters(JSON.stringify({...current, [key]: value}));
  return <div className="space-y-3"><label className="block text-xs font-medium text-zinc-700">Supported operation<select value={operationType} onChange={event => { setOperationType(event.target.value); setParameters("{}"); }} className="mt-1 h-10 w-full rounded-lg border border-croplens-border bg-white px-3"> <option value="">Select an operation</option>{operations.map(operation => <option key={operation.operation_type} value={operation.operation_type}>{operation.display_name}</option>)}</select></label>{selected && <><p className="text-xs text-zinc-600">{selected.description}</p><p className="text-[10px] text-amber-800">Limitations: {selected.known_limitations.join(" · ") || "No limitations reported by the registry."}</p><div className="grid gap-2 sm:grid-cols-2">{Object.entries(schema).filter(([, field]) => ["number", "integer", "string", "boolean"].includes(field.type ?? "") || field.enum).map(([key, field]) => <label key={key} className="block text-xs text-zinc-600">{field.title ?? key.replaceAll("_", " ")}{field.description && <span className="block text-[10px] text-zinc-500">{field.description}</span>}{field.enum ? <select value={String(current[key] ?? field.default ?? field.enum[0])} onChange={event => setValue(key, event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-croplens-border bg-white px-2">{field.enum.map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select> : field.type === "boolean" ? <input type="checkbox" checked={Boolean(current[key] ?? field.default ?? false)} onChange={event => setValue(key, event.target.checked)} className="ml-2 accent-emerald-700"/> : <input type="number" min={field.minimum} max={field.maximum} step={field.type === "integer" ? 1 : "any"} value={String(current[key] ?? field.default ?? "")} onChange={event => setValue(key, field.type === "integer" ? Number.parseInt(event.target.value || "0", 10) : Number(event.target.value))} className="mt-1 h-9 w-full rounded-lg border border-croplens-border px-2"/>}</label>)}</div><label className="block text-xs text-zinc-600">Target columns, if required<input value={targetColumns} onChange={event => setTargetColumns(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-croplens-border px-2" placeholder="Comma-separated; leave empty if operation requires none"/></label></>}</div>;
}
