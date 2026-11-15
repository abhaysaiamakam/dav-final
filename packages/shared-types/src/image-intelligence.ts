export interface ImageIntelligenceResponse {
  analysis_id: string;
  dataset_id: string;
  version_id: string;
  created_at: string;
  methodology_version: string;
  provenance: Record<string, unknown>;
  configuration: Record<string, unknown>;
  total_images: number;
  analyzed_images: number;
  unreadable_images: number;
  class_distribution: Record<string, number>;
  class_balance: Record<string, unknown>;
  metadata_consistency: Record<string, unknown>;
  numeric_distributions: Record<string, Record<string, number>>;
  correlation: Record<string, unknown>;
  feature_families: Record<string, unknown>;
  pca: {
    status: string;
    feature_names: string[];
    explained_variance_ratio: number[];
    cumulative_explained_variance: number[];
    components: Array<{ component: string; loadings: Array<{ feature: string; loading: number }> }>;
    coordinates: Array<{ relative_path: string; class_name: string; PC1: number; PC2: number }>;
    [key: string]: unknown;
  };
  quality_flags: {
    rule: string;
    metric_counts: Record<string, number>;
    candidate_image_count: number;
    candidates: Array<{ relative_path: string; class_name: string; flags: Record<string, unknown> }>;
  };
  image_measurements: Array<{ image_id: string; relative_path: string; class_name: string; features: Record<string, number>; file_size_bytes?: number; format?: string; mode?: string; quality_flags?: Record<string, unknown> }>;
  near_duplicates: { group_count: number; groups: Array<{ representative_path: string; members: Array<{ relative_path: string; hamming_distance_to_representative: number }> }>; [key: string]: unknown };
  leakage_investigation: { status: string; observed_split_counts: Record<string, number>; candidate_cross_split_exact_groups: Array<Record<string, unknown>>; candidate_cross_split_near_duplicate_groups: Array<Record<string, unknown>>; limitation: string };
  findings: Array<{ id: string; title: string; observation: string; evidence: Record<string, unknown>; suggested_action: string; limitations: string }>;
  limitations: string[];
}
