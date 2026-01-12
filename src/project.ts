import { getGraphqlClient } from './client.js';
import type { ProjectField, ProjectItem, ProjectConfig } from './types.js';

export async function detectProjectForRepo(owner: string, repo: string): Promise<ProjectConfig | null> {
  try {
    const repoName = repo.split('/')[1];
    const repoWords = repoName.split('-');
    const searchTerm = repoWords[0];

    const graphqlClient = await getGraphqlClient();

    const result: any = await graphqlClient(
      `query($org: String!, $search: String!) {
        organization(login: $org) {
          projectsV2(first: 10, query: $search) {
            nodes {
              id
              title
              number
            }
          }
        }
      }`,
      { org: owner, search: searchTerm }
    );

    const projects = result?.organization?.projectsV2?.nodes;
    if (!projects || projects.length === 0) {
      return null;
    }

    const exactMatch = projects.find((p: any) =>
      p.title.toLowerCase() === searchTerm.toLowerCase()
    );

    const project = exactMatch || projects[0];

    return {
      project_number: project.number,
      owner,
      enabled: true,
    };
  } catch {
    return null;
  }
}

export async function getOrCreateProjectConfig(owner: string, repo: string): Promise<ProjectConfig | null> {
  const { readFile, writeFile } = await import('fs/promises');

  // check if user has configured a project
  try {
    const configData = await readFile('.issync/config.json', 'utf-8');
    const config = JSON.parse(configData);
    if (config.project) {
      return config.project;
    }
  } catch {
    // no config file yet
  }

  // try to auto-detect
  const detected = await detectProjectForRepo(owner, repo);

  if (detected) {
    // fetch project title for display
    try {
      const graphqlClient = await getGraphqlClient();
      const result: any = await graphqlClient(
        `query($owner: String!, $number: Int!) {
          organization(login: $owner) {
            projectV2(number: $number) {
              title
            }
          }
        }`,
        { owner: detected.owner, number: detected.project_number }
      );
      const projectTitle = result?.organization?.projectV2?.title;
      if (projectTitle) {
        console.log(`auto-detected project #${detected.project_number} "${projectTitle}" for ${owner}`);
      } else {
        console.log(`auto-detected project #${detected.project_number} for ${owner}`);
      }
    } catch {
      console.log(`auto-detected project #${detected.project_number} for ${owner}`);
    }

    // save it for next time
    try {
      const config = { project: detected };
      await writeFile('.issync/config.json', JSON.stringify(config, null, 2), 'utf-8');
      console.log('saved project config to .issync/config.json');
    } catch (error) {
      console.warn(`warning: failed to save config: ${error}`);
    }
  }

  return detected;
}

export async function getProjectId(projectNumber: number, owner: string): Promise<string> {
  const graphqlClient = await getGraphqlClient();
  const result: any = await graphqlClient(
    `query($owner: String!, $number: Int!) {
      organization(login: $owner) {
        projectV2(number: $number) {
          id
        }
      }
    }`,
    { owner, number: projectNumber }
  );

  const projectId = result?.organization?.projectV2?.id;
  if (!projectId) {
    throw new Error(`project #${projectNumber} not found for ${owner}`);
  }

  return projectId;
}

export async function getProjectFields(
  projectNumber: number,
  owner: string,
  cachedFields?: ProjectField[],
  cacheAge?: string
): Promise<ProjectField[]> {
  // use cache if less than 24 hours old
  if (cachedFields && cacheAge) {
    const age = Date.now() - new Date(cacheAge).getTime();
    const hoursOld = age / (1000 * 60 * 60);
    if (hoursOld < 24) {
      console.log('using cached project fields');
      return cachedFields;
    }
  }

  try {
    const graphqlClient = await getGraphqlClient();
    const result: any = await graphqlClient(
      `query($owner: String!, $number: Int!) {
        organization(login: $owner) {
          projectV2(number: $number) {
            fields(first: 100) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    id
                    name
                  }
                }
                ... on ProjectV2IterationField {
                  id
                  name
                  dataType
                  configuration {
                    iterations {
                      id
                      title
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { owner, number: projectNumber }
    );

    const fields = result?.organization?.projectV2?.fields?.nodes || [];
    return fields.map((field: any) => ({
      id: field.id,
      name: field.name,
      dataType: field.dataType,
      options: field.options?.map((opt: any) => ({
        id: opt.id,
        name: opt.name,
      })) || field.configuration?.iterations?.map((iter: any) => ({
        id: iter.id,
        name: iter.title,
      })),
    }));
  } catch (error: any) {
    throw new Error(`failed to fetch project fields: ${error.message}`);
  }
}

export async function getProjectItemsForIssues(
  projectNumber: number,
  owner: string,
  repoOwner: string,
  repoName: string,
  issueNumbers: number[]
): Promise<Map<number, ProjectItem>> {
  // fetch project items for specific issues using their node ids
  // this is much more efficient than fetching all project items

  const itemsMap = new Map<number, ProjectItem>();

  // batch issues into groups to avoid too many api calls
  const batchSize = 50;
  for (let i = 0; i < issueNumbers.length; i += batchSize) {
    const batch = issueNumbers.slice(i, i + batchSize);

    // build query to fetch multiple issues and their project items
    const issueQueries = batch.map((num, idx) => `
      issue${idx}: repository(owner: "${repoOwner}", name: "${repoName}") {
        issue(number: ${num}) {
          id
          number
          projectItems(first: 10) {
            nodes {
              id
              project {
                number
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
                  }
                  ... on ProjectV2ItemFieldTextValue {
                    text
                    field {
                      ... on ProjectV2Field {
                        name
                      }
                    }
                  }
                  ... on ProjectV2ItemFieldDateValue {
                    date
                    field {
                      ... on ProjectV2Field {
                        name
                      }
                    }
                  }
                  ... on ProjectV2ItemFieldNumberValue {
                    number
                    field {
                      ... on ProjectV2Field {
                        name
                      }
                    }
                  }
                  ... on ProjectV2ItemFieldIterationValue {
                    title
                    field {
                      ... on ProjectV2IterationField {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `).join('\n');

    const query = `query { ${issueQueries} }`;

    try {
      const graphqlClient = await getGraphqlClient();
      const result: any = await graphqlClient(query);

      // process each issue in the batch
      batch.forEach((issueNum, idx) => {
        const issueData = result?.[`issue${idx}`]?.issue;
        if (!issueData) return;

        // find project item matching our project number
        const projectItem = issueData.projectItems?.nodes?.find(
          (item: any) => item.project?.number === projectNumber
        );

        if (projectItem) {
          const converted: any = {
            id: projectItem.id,
            content: {
              number: issueNum,
              repository: { name: repoName }
            }
          };

          // extract field values
          if (projectItem.fieldValues?.nodes) {
            for (const fieldValue of projectItem.fieldValues.nodes) {
              if (!fieldValue.field?.name) continue;

              const fieldName = fieldValue.field.name;
              const value = fieldValue.name || fieldValue.text || fieldValue.date || fieldValue.number || fieldValue.title || null;
              converted[fieldName] = value;
            }
          }

          itemsMap.set(issueNum, converted);
        }
      });
    } catch (error: any) {
      console.warn(`warning: failed to fetch project items for batch: ${error.message}`);
    }
  }

  return itemsMap;
}

export async function getProjectItems(projectNumber: number, owner: string, repoName?: string): Promise<ProjectItem[]> {
  // this function is kept for backward compatibility but is inefficient
  // use getProjectItemsForIssues instead when possible
  throw new Error('getProjectItems is deprecated - use getProjectItemsForIssues instead');
}

export async function getProjectItemForIssue(
  projectNumber: number,
  owner: string,
  repoOwner: string,
  repoName: string,
  issueNumber: number
): Promise<ProjectItem | null> {
  const itemsMap = await getProjectItemsForIssues(
    projectNumber,
    owner,
    repoOwner,
    repoName,
    [issueNumber]
  );
  return itemsMap.get(issueNumber) || null;
}

export async function updateProjectField(
  projectId: string,
  itemId: string,
  fieldId: string,
  field: ProjectField,
  value: string | number | null
): Promise<void> {
  const graphqlClient = await getGraphqlClient();

  if (value === null) {
    // clear field
    await graphqlClient(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
        clearProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
        }) {
          projectV2Item { id }
        }
      }`,
      { projectId, itemId, fieldId }
    );
    return;
  }

  try {
    switch (field.dataType) {
      case 'TEXT':
        await graphqlClient(
          `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: { text: $value }
            }) {
              projectV2Item { id }
            }
          }`,
          { projectId, itemId, fieldId, value: String(value) }
        );
        break;

      case 'NUMBER':
        await graphqlClient(
          `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Float!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: { number: $value }
            }) {
              projectV2Item { id }
            }
          }`,
          { projectId, itemId, fieldId, value: Number(value) }
        );
        break;

      case 'DATE':
        await graphqlClient(
          `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Date!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: { date: $value }
            }) {
              projectV2Item { id }
            }
          }`,
          { projectId, itemId, fieldId, value: String(value) }
        );
        break;

      case 'SINGLE_SELECT': {
        const option = field.options?.find(opt => opt.name === value);
        if (!option) {
          throw new Error(`unknown option "${value}" for field "${field.name}"`);
        }
        await graphqlClient(
          `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: { singleSelectOptionId: $optionId }
            }) {
              projectV2Item { id }
            }
          }`,
          { projectId, itemId, fieldId, optionId: option.id }
        );
        break;
      }

      case 'ITERATION': {
        const iteration = field.options?.find(opt => opt.name === value);
        if (!iteration) {
          throw new Error(`unknown iteration "${value}" for field "${field.name}"`);
        }
        await graphqlClient(
          `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: { iterationId: $iterationId }
            }) {
              projectV2Item { id }
            }
          }`,
          { projectId, itemId, fieldId, iterationId: iteration.id }
        );
        break;
      }

      default:
        throw new Error(`unsupported field type: ${field.dataType}`);
    }
  } catch (error: any) {
    throw new Error(`failed to update project field: ${error.message}`);
  }
}

export function extractProjectFieldValues(item: ProjectItem, fields: ProjectField[]): Record<string, string | number | null> {
  const values: Record<string, string | number | null> = {};
  const fieldMap = new Map(fields.map(f => [f.name, f]));

  // skip special keys and redundant fields
  const skipKeys = new Set([
    'id', 'content', 'title', 'assignees', 'labels', 'repository',
    'number', 'url', 'type', 'body',
    'Title',  // redundant with issue title
    'Assignees',  // redundant with issue assignees
    'Labels',  // redundant with issue labels
    'Milestone',  // redundant with issue milestone
  ]);

  for (const [key, value] of Object.entries(item)) {
    if (skipKeys.has(key)) continue;
    if (value === undefined) continue;

    const field = fieldMap.get(key);
    if (!field) {
      // field exists in item but not in field definitions
      // store it anyway for display purposes
      values[key] = value;
      continue;
    }

    // normalise value based on field type
    if (value === null) {
      values[key] = null;
    } else if (typeof value === 'string' || typeof value === 'number') {
      values[key] = value;
    } else {
      values[key] = String(value);
    }
  }

  return values;
}
