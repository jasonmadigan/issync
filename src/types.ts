export interface Issue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  milestone: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  project_fields?: Record<string, ProjectFieldValue>;
}

export type ProjectFieldValue = string | number | null;

export interface ProjectField {
  id: string;
  name: string;
  dataType: 'TEXT' | 'NUMBER' | 'DATE' | 'SINGLE_SELECT' | 'ITERATION';
  options?: ProjectFieldOption[];
}

export interface ProjectFieldOption {
  id: string;
  name: string;
}

export interface ProjectItem {
  id: string;
  content?: {
    number?: number;
    type?: string;
  };
  [key: string]: any; // fields are returned at top level in REST API
}

export interface ProjectConfig {
  project_number?: number;
  owner?: string;
  enabled: boolean;
  cached_fields?: ProjectField[];
  fields_cached_at?: string;
}

export interface SyncState {
  issues: Record<number, {
    github_updated_at: string;
    local_updated_at: string;
    last_synced_at: string;
    project_item_id?: string;
    project_fields_updated_at?: string;
  }>;
}

export interface ConflictInfo {
  number: number;
  title: string;
  github_updated: string;
  local_updated: string;
  last_synced: string;
}
