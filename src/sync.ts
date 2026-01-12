import {
  fetchIssues,
  updateIssue,
  createIssue,
  getCurrentRepo,
} from './gh.js';
import {
  ensureStorageDir,
  saveIssue,
  loadIssue,
  loadAllLocalIssues,
  loadSyncState,
  saveSyncState,
  getLocalFileModTime,
  loadConfig,
  saveConfig,
} from './storage.js';
import {
  getProjectFields,
  getProjectItemForIssue,
  extractProjectFieldValues,
  updateProjectField,
  getOrCreateProjectConfig,
  getProjectItemsForIssues,
  getProjectId,
} from './project.js';
import type { Issue, ConflictInfo } from './types.js';

export async function syncDown(includeClosed: boolean = false, fullSync: boolean = false, syncProjects: boolean = false): Promise<void> {
  console.log('syncing issues from github...');

  const repo = await getCurrentRepo();
  console.log(`repository: ${repo}`);

  await ensureStorageDir();

  const state = await loadSyncState();

  // calculate last sync time for incremental fetch
  let lastSync: string | undefined;
  if (!fullSync) {
    const syncTimes = Object.values(state.issues).map(s => s.last_synced_at).filter(Boolean);
    if (syncTimes.length > 0) {
      lastSync = syncTimes.sort().pop();
      console.log(`fetching issues updated since ${lastSync?.split('T')[0]}...`);
    }
  }

  const remoteIssues = await fetchIssues(repo, includeClosed, lastSync);
  console.log(`fetched ${remoteIssues.length} issue(s)`);

  // auto-detect or load project config
  const [owner, repoName] = repo.split('/');

  // fetch project data if --projects flag is set
  let projectFields = null;
  let projectItemsMap = null;
  let projectConfig = null;

  if (syncProjects) {
    projectConfig = await getOrCreateProjectConfig(owner, repo);
  }

  if (syncProjects && projectConfig?.enabled && projectConfig.project_number && projectConfig.owner) {
    try {
      console.log(`fetching project data from project #${projectConfig.project_number}...`);
      projectFields = await getProjectFields(
        projectConfig.project_number,
        projectConfig.owner,
        projectConfig.cached_fields,
        projectConfig.fields_cached_at
      );

      // update cache if fields were fetched
      if (!projectConfig.cached_fields || projectFields !== projectConfig.cached_fields) {
        projectConfig.cached_fields = projectFields;
        projectConfig.fields_cached_at = new Date().toISOString();
        await saveConfig({ project: projectConfig });
      }

      // fetch project items for our specific issues (efficient approach)
      const issueNumbers = remoteIssues.map(i => i.number);
      projectItemsMap = await getProjectItemsForIssues(
        projectConfig.project_number!,
        projectConfig.owner!,
        owner,
        repoName,
        issueNumbers
      );

      console.log(`fetched project data for ${projectItemsMap.size} issues`);
    } catch (error) {
      console.warn(`warning: failed to fetch project data: ${error}`);
    }
  }

  for (const issue of remoteIssues) {
    // add project field values if available
    if (projectItemsMap && projectFields) {
      const projectItem = projectItemsMap.get(issue.number);
      if (projectItem) {
        issue.project_fields = extractProjectFieldValues(projectItem, projectFields);

        if (!state.issues[issue.number]) {
          state.issues[issue.number] = {
            github_updated_at: issue.updated_at,
            local_updated_at: issue.updated_at,
            last_synced_at: new Date().toISOString(),
          };
        }
        state.issues[issue.number].project_item_id = projectItem.id;
        state.issues[issue.number].project_fields_updated_at = new Date().toISOString();
      }
    }

    await saveIssue(issue);

    state.issues[issue.number] = {
      ...state.issues[issue.number],
      github_updated_at: issue.updated_at,
      local_updated_at: issue.updated_at,
      last_synced_at: new Date().toISOString(),
    };
  }

  await saveSyncState(state);
  console.log('sync complete');
}

export async function syncUp(force: boolean = false, dryRun: boolean = false, syncProjects: boolean = false): Promise<void> {
  console.log(dryRun ? 'checking for local changes...' : 'syncing local changes to github...');

  const repo = await getCurrentRepo();
  console.log(`repository: ${repo}`);

  const localIssues = await loadAllLocalIssues();
  const remoteIssues = await fetchIssues(repo, true);
  const state = await loadSyncState();

  // auto-detect or load project config
  const [owner, repoName] = repo.split('/');

  // load project data if --projects flag is set
  let projectFields = null;
  let projectId = null;
  let projectConfig = null;

  if (syncProjects) {
    projectConfig = await getOrCreateProjectConfig(owner, repo);
  }

  if (syncProjects && projectConfig?.enabled && projectConfig.project_number && projectConfig.owner) {
    try {
      projectFields = await getProjectFields(
        projectConfig.project_number,
        projectConfig.owner,
        projectConfig.cached_fields,
        projectConfig.fields_cached_at
      );
      projectId = await getProjectId(projectConfig.project_number, projectConfig.owner);
    } catch (error) {
      console.warn(`warning: failed to load project data: ${error}`);
    }
  }

  const remoteMap = new Map(remoteIssues.map(i => [i.number, i]));
  let updated = 0;

  for (const local of localIssues) {
    const remote = remoteMap.get(local.number);
    const syncInfo = state.issues[local.number];

    if (!remote) {
      console.log(`issue #${local.number} not found on github (skipping)`);
      continue;
    }

    if (!syncInfo) {
      console.log(`issue #${local.number} has no sync history (skipping)`);
      continue;
    }

    const fileModTime = await getLocalFileModTime(local.number);
    const localModified = fileModTime ? fileModTime > syncInfo.last_synced_at : false;
    const remoteModified = remote.updated_at > syncInfo.github_updated_at;

    if (remoteModified && localModified && !force) {
      console.log(`⚠ conflict detected for issue #${local.number} (use --force to override)`);
      continue;
    }

    if (!localModified) {
      continue;
    }

    const updates: any = {};
    if (local.title !== remote.title) updates.title = local.title;
    if (local.body !== remote.body) updates.body = local.body;
    if (local.state !== remote.state) updates.state = local.state;

    if (JSON.stringify(local.labels) !== JSON.stringify(remote.labels)) {
      updates.labels = local.labels;
    }
    if (JSON.stringify(local.assignees) !== JSON.stringify(remote.assignees)) {
      updates.assignees = local.assignees;
    }

    if (Object.keys(updates).length > 0) {
      if (dryRun) {
        console.log(`would update issue #${local.number}: ${local.title}`);
        const changes = Object.keys(updates).join(', ');
        console.log(`  changes: ${changes}`);
      } else {
        console.log(`updating issue #${local.number}: ${local.title}`);
        await updateIssue(repo, local.number, updates);

        state.issues[local.number] = {
          github_updated_at: new Date().toISOString(),
          local_updated_at: local.updated_at,
          last_synced_at: new Date().toISOString(),
        };
      }

      updated++;
    }

    // sync project fields if configured
    if (projectFields && projectId && syncInfo.project_item_id && local.project_fields) {
      const remoteProjectItem = await getProjectItemForIssue(
        projectConfig!.project_number!,
        projectConfig!.owner!,
        owner,
        repoName,
        local.number
      );

      if (remoteProjectItem) {
        const remoteFields = extractProjectFieldValues(remoteProjectItem, projectFields);
        const fieldMap = new Map(projectFields.map(f => [f.name, f]));

        for (const [fieldName, localValue] of Object.entries(local.project_fields)) {
          const remoteValue = remoteFields[fieldName];
          const field = fieldMap.get(fieldName);

          if (!field) continue;

          if (JSON.stringify(localValue) !== JSON.stringify(remoteValue)) {
            if (dryRun) {
              console.log(`would update issue #${local.number} project field "${fieldName}": ${remoteValue} -> ${localValue}`);
            } else {
              try {
                await updateProjectField(projectId, syncInfo.project_item_id, field.id, field, localValue);
                console.log(`updated issue #${local.number} project field "${fieldName}"`);
              } catch (error) {
                console.warn(`warning: failed to update issue #${local.number} project field "${fieldName}": ${error}`);
              }
            }
          }
        }

        if (!dryRun) {
          state.issues[local.number].project_fields_updated_at = new Date().toISOString();
        }
      }
    }
  }

  if (!dryRun) {
    await saveSyncState(state);
  }

  console.log(dryRun
    ? `found ${updated} issue(s) with local changes`
    : `sync complete (${updated} issues updated)`);
}

export async function detectConflicts(): Promise<ConflictInfo[]> {
  const repo = await getCurrentRepo();
  const localIssues = await loadAllLocalIssues();
  const remoteIssues = await fetchIssues(repo, true);
  const state = await loadSyncState();

  const conflicts: ConflictInfo[] = [];
  const remoteMap = new Map(remoteIssues.map(i => [i.number, i]));

  for (const local of localIssues) {
    const remote = remoteMap.get(local.number);
    const syncInfo = state.issues[local.number];

    if (!remote || !syncInfo) continue;

    const localModified = local.updated_at > syncInfo.last_synced_at;
    const remoteModified = remote.updated_at > syncInfo.github_updated_at;

    if (localModified && remoteModified) {
      conflicts.push({
        number: local.number,
        title: local.title,
        github_updated: remote.updated_at,
        local_updated: local.updated_at,
        last_synced: syncInfo.last_synced_at,
      });
    }
  }

  return conflicts;
}
