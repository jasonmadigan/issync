import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import matter from 'gray-matter';
import YAML from 'yaml';
import type { Issue, SyncState, ProjectConfig } from './types.js';

const ISSUES_DIR = '.issync/issues';
const STATE_FILE = '.issync/state.json';
const CONFIG_FILE = '.issync/config.json';

export async function ensureStorageDir(): Promise<void> {
  await mkdir(ISSUES_DIR, { recursive: true });
}

export async function saveIssue(issue: Issue): Promise<void> {
  const filename = join(ISSUES_DIR, `${issue.number}.md`);
  const frontmatter: any = {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: issue.labels,
    assignees: issue.assignees,
    milestone: issue.milestone,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
  };

  if (issue.project_fields && Object.keys(issue.project_fields).length > 0) {
    frontmatter.project_fields = issue.project_fields;
  }

  const content = matter.stringify(issue.body, frontmatter);
  await writeFile(filename, content, 'utf-8');
}

export async function loadIssue(number: number): Promise<Issue | null> {
  const filename = join(ISSUES_DIR, `${number}.md`);

  try {
    const content = await readFile(filename, 'utf-8');
    const { data, content: body } = matter(content);

    const issue: Issue = {
      number: data.number,
      title: data.title,
      body: body.trim(),
      state: data.state,
      labels: data.labels || [],
      assignees: data.assignees || [],
      milestone: data.milestone || null,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at || null,
    };

    if (data.project_fields) {
      issue.project_fields = data.project_fields;
    }

    return issue;
  } catch {
    return null;
  }
}

export async function loadAllLocalIssues(): Promise<Issue[]> {
  try {
    const files = await readdir(ISSUES_DIR);
    const issueNumbers = files
      .filter(f => f.endsWith('.md'))
      .map(f => parseInt(f.replace('.md', ''), 10));

    const issues = await Promise.all(
      issueNumbers.map(n => loadIssue(n))
    );

    return issues.filter((i): i is Issue => i !== null);
  } catch {
    return [];
  }
}

export async function loadSyncState(): Promise<SyncState> {
  try {
    const content = await readFile(STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { issues: {} };
  }
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export async function getLocalFileModTime(number: number): Promise<string | null> {
  const filename = join(ISSUES_DIR, `${number}.md`);
  const { stat } = await import('fs/promises');

  try {
    const stats = await stat(filename);
    return new Date(stats.mtimeMs).toISOString();
  } catch {
    return null;
  }
}

export async function loadConfig(): Promise<{ project?: ProjectConfig }> {
  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveConfig(config: { project?: ProjectConfig }): Promise<void> {
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}
