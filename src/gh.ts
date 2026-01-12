import { getOctokit, getCurrentRepo as getRepo } from './client.js';
import type { Issue } from './types.js';

export { getCurrentRepo } from './client.js';

export async function fetchIssues(
  repo: string,
  includeClosed: boolean = false,
  updatedSince?: string
): Promise<Issue[]> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');

  const state = includeClosed ? 'all' : 'open';
  const per_page = 100;
  let page = 1;
  const allIssues: Issue[] = [];

  while (true) {
    const params: any = {
      owner,
      repo: repoName,
      state,
      per_page,
      page,
      sort: 'updated',
      direction: 'desc',
    };

    if (updatedSince) {
      params.since = updatedSince;
    }

    const { data } = await octokit.rest.issues.listForRepo(params);

    if (data.length === 0) {
      break;
    }

    for (const issue of data) {
      if (issue.pull_request) {
        continue;
      }

      allIssues.push({
        number: issue.number,
        title: issue.title,
        body: (issue.body || '').trim(),
        state: issue.state as 'open' | 'closed',
        labels: issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name)),
        assignees: issue.assignees?.map((a: any) => a.login) || [],
        milestone: issue.milestone?.title || null,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at || null,
        url: issue.html_url,
      });
    }

    if (data.length < per_page) {
      break;
    }

    page++;
  }

  return allIssues;
}

export async function updateIssue(
  repo: string,
  number: number,
  updates: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: string[];
    assignees?: string[];
    milestone?: string | null;
  }
): Promise<void> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');

  const params: any = {
    owner,
    repo: repoName,
    issue_number: number,
  };

  if (updates.title !== undefined) {
    params.title = updates.title;
  }

  if (updates.body !== undefined) {
    params.body = updates.body;
  }

  if (updates.state !== undefined) {
    params.state = updates.state;
  }

  if (updates.labels !== undefined) {
    params.labels = updates.labels;
  }

  if (updates.assignees !== undefined) {
    params.assignees = updates.assignees;
  }

  if (updates.milestone !== undefined) {
    if (updates.milestone === null) {
      params.milestone = null;
    } else {
      const { data: milestones } = await octokit.rest.issues.listMilestones({
        owner,
        repo: repoName,
      });
      const milestone = milestones.find(m => m.title === updates.milestone);
      if (milestone) {
        params.milestone = milestone.number;
      }
    }
  }

  try {
    await octokit.rest.issues.update(params);
  } catch (error: any) {
    throw new Error(`failed to update issue ${number}: ${error.message}`);
  }
}

export async function createIssue(
  repo: string,
  issue: Omit<Issue, 'number' | 'created_at' | 'updated_at' | 'closed_at' | 'url'>
): Promise<number> {
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split('/');

  const params: any = {
    owner,
    repo: repoName,
    title: issue.title,
    body: issue.body,
  };

  if (issue.labels.length > 0) {
    params.labels = issue.labels;
  }

  if (issue.assignees.length > 0) {
    params.assignees = issue.assignees;
  }

  if (issue.milestone) {
    const { data: milestones } = await octokit.rest.issues.listMilestones({
      owner,
      repo: repoName,
    });
    const milestone = milestones.find(m => m.title === issue.milestone);
    if (milestone) {
      params.milestone = milestone.number;
    }
  }

  try {
    const { data } = await octokit.rest.issues.create(params);
    return data.number;
  } catch (error: any) {
    throw new Error(`failed to create issue: ${error.message}`);
  }
}
