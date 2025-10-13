import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let cachedToken: string | null = null;
let cachedOctokit: Octokit | null = null;
let cachedGraphql: typeof graphql | null = null;

async function getGitHubToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }

  // check for env var first
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) {
    cachedToken = envToken;
    return cachedToken;
  }

  // fallback to gh cli
  try {
    const { stdout } = await execAsync('gh auth token');
    cachedToken = stdout.trim();

    if (!cachedToken) {
      throw new Error('gh auth token returned empty string');
    }

    return cachedToken;
  } catch (error: any) {
    if (error.message?.includes('command not found') || error.code === 'ENOENT') {
      throw new Error(
        'github authentication required. either:\n' +
        '  1. set GITHUB_TOKEN or GH_TOKEN environment variable, or\n' +
        '  2. install gh cli (https://cli.github.com/) and run: gh auth login'
      );
    }

    if (error.message?.includes('not logged in') || error.stderr?.includes('not logged in')) {
      throw new Error(
        'not authenticated with github. either:\n' +
        '  1. set GITHUB_TOKEN or GH_TOKEN environment variable, or\n' +
        '  2. run: gh auth login'
      );
    }

    throw new Error(`failed to get github token: ${error.message}`);
  }
}

export async function getOctokit(): Promise<Octokit> {
  if (cachedOctokit) {
    return cachedOctokit;
  }

  const token = await getGitHubToken();
  cachedOctokit = new Octokit({ auth: token });

  return cachedOctokit;
}

export async function getGraphqlClient(): Promise<typeof graphql> {
  if (cachedGraphql) {
    return cachedGraphql;
  }

  const token = await getGitHubToken();
  cachedGraphql = graphql.defaults({
    headers: {
      authorization: `token ${token}`,
    },
  });

  return cachedGraphql;
}

export async function getCurrentRepo(): Promise<string> {
  try {
    const { stdout } = await execAsync('git remote get-url origin');
    const url = stdout.trim();

    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (!match) {
      throw new Error('could not parse github repo from git remote');
    }

    return match[1].replace(/\.git$/, '');
  } catch (error: any) {
    throw new Error(`failed to get current repo: ${error.message}`);
  }
}
