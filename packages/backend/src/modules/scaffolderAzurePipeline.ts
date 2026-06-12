import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  createTemplateAction,
  scaffolderActionsExtensionPoint,
} from '@backstage/plugin-scaffolder-node';

const createRunAzurePipelineAction = () =>
  createTemplateAction({
    id: 'azure:pipeline:run',
    description: 'Triggers an Azure DevOps pipeline run',
    schema: {
      input: {
        organization: z =>
          z.string({
            description: 'Azure DevOps organization name',
          }),
        project: z =>
          z.string({
            description: 'Azure DevOps project name',
          }),
        pipelineId: z =>
          z.number({
            description: 'Azure DevOps pipeline ID to run',
          }),
        branch: z =>
          z
            .string({
              description: 'Branch to run the pipeline against',
            })
            .default('main'),
      },
      output: {
        runId: z => z.number().describe('Azure DevOps pipeline run ID'),
        runUrl: z => z.string().describe('Azure DevOps pipeline run URL'),
      },
    },
    async handler(ctx) {
      const token = process.env.AZURE_DEVOPS_TOKEN;
      if (!token) {
        throw new Error('AZURE_DEVOPS_TOKEN is not configured');
      }

      const { organization, project, pipelineId, branch } = ctx.input;
      const refName = branch.startsWith('refs/')
        ? branch
        : `refs/heads/${branch}`;
      const url = `https://dev.azure.com/${encodeURIComponent(
        organization,
      )}/${encodeURIComponent(
        project,
      )}/_apis/pipelines/${pipelineId}/runs?api-version=7.1-preview.1`;

      ctx.logger.info(
        `Triggering Azure DevOps pipeline ${pipelineId} in ${organization}/${project}`,
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resources: {
            repositories: {
              self: {
                refName,
              },
            },
          },
        }),
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `Azure DevOps pipeline trigger failed with ${response.status}: ${responseText.slice(0, 500)}`,
        );
      }

      const run = JSON.parse(responseText) as {
        id: number;
        _links?: { web?: { href?: string } };
      };
      const runUrl =
        run._links?.web?.href ??
        `https://dev.azure.com/${encodeURIComponent(
          organization,
        )}/${encodeURIComponent(project)}/_build/results?buildId=${run.id}`;

      ctx.output('runId', run.id);
      ctx.output('runUrl', runUrl);
      ctx.logger.info(`Queued Azure DevOps pipeline run ${run.id}`);
    },
  });

const azureDevOpsAuthHeader = () => {
  const token = process.env.AZURE_DEVOPS_TOKEN;
  if (!token) {
    throw new Error('AZURE_DEVOPS_TOKEN is not configured');
  }

  return `Basic ${Buffer.from(`:${token}`).toString('base64')}`;
};

const azureDevOpsApiUrl = (
  organization: string,
  project: string,
  path: string,
) =>
  `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(
    project,
  )}${path}`;

const createCreateAzurePipelineAction = () =>
  createTemplateAction({
    id: 'azure:pipeline:create',
    description: 'Creates an Azure DevOps YAML pipeline for an Azure Repos Git repository',
    schema: {
      input: {
        organization: z =>
          z.string({
            description: 'Azure DevOps organization name',
          }),
        project: z =>
          z.string({
            description: 'Azure DevOps project name',
          }),
        repo: z =>
          z.string({
            description: 'Azure DevOps repository name',
          }),
        pipelineName: z =>
          z.string({
            description: 'Azure DevOps pipeline name',
          }),
        yamlPath: z =>
          z
            .string({
              description: 'Path to the Azure Pipelines YAML file in the repository',
            })
            .default('/azure-pipelines.yml'),
      },
      output: {
        pipelineId: z => z.number().describe('Azure DevOps pipeline ID'),
        pipelineUrl: z => z.string().describe('Azure DevOps pipeline URL'),
      },
    },
    async handler(ctx) {
      const { organization, project, repo, pipelineName, yamlPath } = ctx.input;
      const authorization = azureDevOpsAuthHeader();

      ctx.logger.info(
        `Creating Azure DevOps pipeline ${pipelineName} for repository ${repo}`,
      );

      const repositoryResponse = await fetch(
        azureDevOpsApiUrl(
          organization,
          project,
          `/_apis/git/repositories/${encodeURIComponent(repo)}?api-version=7.1-preview.1`,
        ),
        {
          headers: { Authorization: authorization },
        },
      );
      const repositoryText = await repositoryResponse.text();
      if (!repositoryResponse.ok) {
        throw new Error(
          `Azure DevOps repository lookup failed with ${repositoryResponse.status}: ${repositoryText.slice(0, 500)}`,
        );
      }

      const repository = JSON.parse(repositoryText) as {
        id: string;
        name: string;
      };

      const existingPipelinesResponse = await fetch(
        azureDevOpsApiUrl(
          organization,
          project,
          `/_apis/pipelines?api-version=7.1-preview.1`,
        ),
        {
          headers: { Authorization: authorization },
        },
      );
      const existingPipelinesText = await existingPipelinesResponse.text();
      if (!existingPipelinesResponse.ok) {
        throw new Error(
          `Azure DevOps pipeline lookup failed with ${existingPipelinesResponse.status}: ${existingPipelinesText.slice(0, 500)}`,
        );
      }

      const existingPipelines = JSON.parse(existingPipelinesText) as {
        value?: Array<{ id: number; name: string; url?: string; _links?: { web?: { href?: string } } }>;
      };
      const existingPipeline = existingPipelines.value?.find(
        pipeline => pipeline.name === pipelineName,
      );
      if (existingPipeline) {
        const pipelineUrl =
          existingPipeline._links?.web?.href ??
          `https://dev.azure.com/${encodeURIComponent(
            organization,
          )}/${encodeURIComponent(project)}/_build?definitionId=${existingPipeline.id}`;
        ctx.output('pipelineId', existingPipeline.id);
        ctx.output('pipelineUrl', pipelineUrl);
        ctx.logger.info(`Azure DevOps pipeline already exists as ${existingPipeline.id}`);
        return;
      }

      const createPipelineResponse = await fetch(
        azureDevOpsApiUrl(
          organization,
          project,
          `/_apis/pipelines?api-version=7.1-preview.1`,
        ),
        {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: pipelineName,
            configuration: {
              type: 'yaml',
              path: yamlPath,
              repository: {
                id: repository.id,
                name: repository.name,
                type: 'azureReposGit',
              },
            },
          }),
        },
      );
      const createPipelineText = await createPipelineResponse.text();
      if (!createPipelineResponse.ok) {
        throw new Error(
          `Azure DevOps pipeline creation failed with ${createPipelineResponse.status}: ${createPipelineText.slice(0, 500)}`,
        );
      }

      const pipeline = JSON.parse(createPipelineText) as {
        id: number;
        _links?: { web?: { href?: string } };
      };
      const pipelineUrl =
        pipeline._links?.web?.href ??
        `https://dev.azure.com/${encodeURIComponent(
          organization,
        )}/${encodeURIComponent(project)}/_build?definitionId=${pipeline.id}`;

      ctx.output('pipelineId', pipeline.id);
      ctx.output('pipelineUrl', pipelineUrl);
      ctx.logger.info(`Created Azure DevOps pipeline ${pipeline.id}`);
    },
  });

const findAzureDevOpsServiceConnection = async (
  organization: string,
  project: string,
  serviceConnectionName: string,
  authorization: string,
) => {
  const serviceConnectionsResponse = await fetch(
    azureDevOpsApiUrl(
      organization,
      project,
      `/_apis/serviceendpoint/endpoints?type=github&api-version=7.1-preview.4`,
    ),
    {
      headers: { Authorization: authorization },
    },
  );
  const serviceConnectionsText = await serviceConnectionsResponse.text();
  if (!serviceConnectionsResponse.ok) {
    throw new Error(
      `Azure DevOps service connection lookup failed with ${serviceConnectionsResponse.status}: ${serviceConnectionsText.slice(0, 500)}`,
    );
  }

  const serviceConnections = JSON.parse(serviceConnectionsText) as {
    value?: Array<{ id: string; name: string }>;
  };
  const expectedServiceConnectionName = serviceConnectionName.trim();
  const serviceConnection = serviceConnections.value?.find(
    endpoint =>
      endpoint.name.localeCompare(expectedServiceConnectionName, undefined, {
        sensitivity: 'accent',
      }) === 0,
  );

  if (!serviceConnection) {
    const availableServiceConnectionNames = serviceConnections.value
      ?.map(endpoint => endpoint.name)
      .filter(Boolean)
      .sort();
    const availableServiceConnections = availableServiceConnectionNames?.length
      ? availableServiceConnectionNames.join(', ')
      : 'none found';
    throw new Error(
      `Azure DevOps GitHub service connection '${expectedServiceConnectionName}' was not found in ${organization}/${project}. Available GitHub service connections: ${availableServiceConnections}. Create one from Project settings > Service connections > New service connection > GitHub, then use its exact name here.`,
    );
  }

  return serviceConnection;
};

const createCreateAzurePipelineForGitHubAction = () =>
  createTemplateAction({
    id: 'azure:pipeline:create:github',
    description: 'Creates an Azure DevOps YAML pipeline for a GitHub repository',
    schema: {
      input: {
        organization: z =>
          z.string({
            description: 'Azure DevOps organization name',
          }),
        project: z =>
          z.string({
            description: 'Azure DevOps project name',
          }),
        repoOwner: z =>
          z.string({
            description: 'GitHub organization or user that owns the repository',
          }),
        repo: z =>
          z.string({
            description: 'GitHub repository name',
          }),
        pipelineName: z =>
          z.string({
            description: 'Azure DevOps pipeline name',
          }),
        serviceConnectionName: z =>
          z
            .string({
              description: 'Azure DevOps GitHub service connection name',
            })
            .default('GitHub'),
        yamlPath: z =>
          z
            .string({
              description: 'Path to the Azure Pipelines YAML file in the repository',
            })
            .default('/azure-pipelines.yml'),
      },
      output: {
        pipelineId: z => z.number().describe('Azure DevOps pipeline ID'),
        pipelineUrl: z => z.string().describe('Azure DevOps pipeline URL'),
      },
    },
    async handler(ctx) {
      const {
        organization,
        project,
        repoOwner,
        repo,
        pipelineName,
        serviceConnectionName,
        yamlPath,
      } = ctx.input;
      const authorization = azureDevOpsAuthHeader();
      const githubRepository = `${repoOwner}/${repo}`;

      ctx.logger.info(
        `Creating Azure DevOps pipeline ${pipelineName} for GitHub repository ${githubRepository}`,
      );

      const serviceConnection = await findAzureDevOpsServiceConnection(
        organization,
        project,
        serviceConnectionName,
        authorization,
      );

      const existingPipelinesResponse = await fetch(
        azureDevOpsApiUrl(
          organization,
          project,
          `/_apis/pipelines?api-version=7.1-preview.1`,
        ),
        {
          headers: { Authorization: authorization },
        },
      );
      const existingPipelinesText = await existingPipelinesResponse.text();
      if (!existingPipelinesResponse.ok) {
        throw new Error(
          `Azure DevOps pipeline lookup failed with ${existingPipelinesResponse.status}: ${existingPipelinesText.slice(0, 500)}`,
        );
      }

      const existingPipelines = JSON.parse(existingPipelinesText) as {
        value?: Array<{ id: number; name: string; _links?: { web?: { href?: string } } }>;
      };
      const existingPipeline = existingPipelines.value?.find(
        pipeline => pipeline.name === pipelineName,
      );
      if (existingPipeline) {
        const pipelineUrl =
          existingPipeline._links?.web?.href ??
          `https://dev.azure.com/${encodeURIComponent(
            organization,
          )}/${encodeURIComponent(project)}/_build?definitionId=${existingPipeline.id}`;
        ctx.output('pipelineId', existingPipeline.id);
        ctx.output('pipelineUrl', pipelineUrl);
        ctx.logger.info(`Azure DevOps pipeline already exists as ${existingPipeline.id}`);
        return;
      }

      const createPipelineResponse = await fetch(
        azureDevOpsApiUrl(
          organization,
          project,
          `/_apis/pipelines?api-version=7.1-preview.1`,
        ),
        {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: pipelineName,
            configuration: {
              type: 'yaml',
              path: yamlPath,
              repository: {
                id: githubRepository,
                name: githubRepository,
                fullName: githubRepository,
                type: 'github',
                connection: {
                  id: serviceConnection.id,
                },
              },
            },
          }),
        },
      );
      const createPipelineText = await createPipelineResponse.text();
      if (!createPipelineResponse.ok) {
        throw new Error(
          `Azure DevOps GitHub pipeline creation failed with ${createPipelineResponse.status}: ${createPipelineText.slice(0, 500)}`,
        );
      }

      const pipeline = JSON.parse(createPipelineText) as {
        id: number;
        _links?: { web?: { href?: string } };
      };
      const pipelineUrl =
        pipeline._links?.web?.href ??
        `https://dev.azure.com/${encodeURIComponent(
          organization,
        )}/${encodeURIComponent(project)}/_build?definitionId=${pipeline.id}`;

      ctx.output('pipelineId', pipeline.id);
      ctx.output('pipelineUrl', pipelineUrl);
      ctx.logger.info(`Created Azure DevOps GitHub pipeline ${pipeline.id}`);
    },
  });

const createDeleteGitHubRepositoryAction = () =>
  createTemplateAction({
    id: 'github:repo:delete',
    description: 'Deletes a GitHub repository',
    schema: {
      input: {
        owner: z =>
          z.string({
            description: 'GitHub organization or user that owns the repository',
          }),
        repo: z =>
          z.string({
            description: 'GitHub repository name to delete',
          }),
        confirmRepoName: z =>
          z.string({
            description: 'Repository name confirmation',
          }),
      },
      output: {
        deleted: z => z.boolean().describe('Whether the repository was deleted'),
        repositoryUrl: z => z.string().describe('Deleted repository URL'),
      },
    },
    async handler(ctx) {
      const { owner, repo, confirmRepoName } = ctx.input;
      if (repo !== confirmRepoName) {
        throw new Error(
          `Repository confirmation did not match. Expected '${repo}'.`,
        );
      }

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        throw new Error('GITHUB_TOKEN is not configured');
      }

      const repositoryUrl = `https://github.com/${owner}/${repo}`;
      ctx.logger.info(`Deleting GitHub repository ${owner}/${repo}`);

      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(
          owner,
        )}/${encodeURIComponent(repo)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );

      if (response.status !== 204) {
        const responseText = await response.text();
        if (response.status === 403) {
          throw new Error(
            `GitHub repository deletion failed with 403. The GITHUB_TOKEN used by Backstage must have admin access to ${owner}/${repo} and deletion permission. For a classic GitHub PAT, add the delete_repo scope. For a fine-grained token, grant repository Administration read/write permission. GitHub response: ${responseText.slice(0, 500)}`,
          );
        }
        throw new Error(
          `GitHub repository deletion failed with ${response.status}: ${responseText.slice(0, 500)}`,
        );
      }

      ctx.output('deleted', true);
      ctx.output('repositoryUrl', repositoryUrl);
      ctx.logger.info(`Deleted GitHub repository ${owner}/${repo}`);
    },
  });

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'azure-pipeline-runner',
  register(reg) {
    reg.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
      },
      async init({ scaffolder }) {
        scaffolder.addActions(
          createRunAzurePipelineAction(),
          createCreateAzurePipelineAction(),
          createCreateAzurePipelineForGitHubAction(),
          createDeleteGitHubRepositoryAction(),
        );
      },
    });
  },
});