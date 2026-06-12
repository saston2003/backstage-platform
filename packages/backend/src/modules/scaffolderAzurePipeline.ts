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

const azureDevOpsOrganizationApiUrl = (organization: string, path: string) =>
  `https://dev.azure.com/${encodeURIComponent(organization)}${path}`;

const delay = (durationMs: number) =>
  new Promise(resolve => {
    setTimeout(resolve, durationMs);
  });

const githubToken = () => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is not configured');
  }

  return token;
};

const githubAuthHeader = () => {
  return `Bearer ${githubToken()}`;
};

const createDeleteGitHubRepositoryAction = () =>
  createTemplateAction({
    id: 'github:repo:delete',
    description: 'Deletes a GitHub repository',
    schema: {
      input: {
        repoOwner: z =>
          z.string({
            description: 'GitHub organization or user that owns the repository',
          }),
        repo: z =>
          z.string({
            description: 'GitHub repository name',
          }),
        confirmRepositoryName: z =>
          z.string({
            description: 'Repository name confirmation',
          }),
      },
      output: {
        deleted: z => z.boolean().describe('Whether the repository was deleted'),
        repositoryUrl: z => z.string().describe('GitHub repository URL'),
      },
    },
    async handler(ctx) {
      const { repoOwner, repo, confirmRepositoryName } = ctx.input;
      if (confirmRepositoryName !== repo) {
        throw new Error('Repository confirmation does not match the repository name');
      }

      const repositoryUrl = `https://github.com/${encodeURIComponent(
        repoOwner,
      )}/${encodeURIComponent(repo)}`;

      ctx.logger.info(`Deleting GitHub repository ${repoOwner}/${repo}`);

      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(
          repoOwner,
        )}/${encodeURIComponent(repo)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: githubAuthHeader(),
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );

      const responseText = await response.text();
      if (response.status === 404) {
        throw new Error(`GitHub repository was not found: ${repoOwner}/${repo}`);
      }
      if (!response.ok) {
        throw new Error(
          `GitHub repository deletion failed with ${response.status}: ${responseText.slice(0, 500)}`,
        );
      }

      ctx.output('deleted', true);
      ctx.output('repositoryUrl', repositoryUrl);
      ctx.logger.info(`Deleted GitHub repository ${repoOwner}/${repo}`);
    },
  });

const createCreateAzureProjectAction = () =>
  createTemplateAction({
    id: 'azure:project:create',
    description: 'Creates an Azure DevOps project',
    schema: {
      input: {
        organization: z =>
          z.string({
            description: 'Azure DevOps organization name',
          }),
        projectName: z =>
          z.string({
            description: 'Azure DevOps project name',
          }),
        description: z =>
          z
            .string({
              description: 'Azure DevOps project description',
            })
            .default('Created from Backstage'),
        visibility: z =>
          z
            .enum(['private', 'public'], {
              description: 'Azure DevOps project visibility',
            })
            .default('private'),
        processTemplateId: z =>
          z
            .string({
              description: 'Azure DevOps process template ID',
            })
            .default('adcc42ab-9882-485e-a3ed-7678f01f66bc'),
        waitForCompletion: z =>
          z
            .boolean({
              description: 'Wait for Azure DevOps project provisioning to finish',
            })
            .default(false),
      },
      output: {
        projectUrl: z => z.string().describe('Azure DevOps project URL'),
        operationUrl: z =>
          z.string().optional().describe('Azure DevOps project creation operation URL'),
        created: z => z.boolean().describe('Whether the project was created'),
      },
    },
    async handler(ctx) {
      const {
        organization,
        projectName,
        description,
        visibility,
        processTemplateId,
        waitForCompletion,
      } = ctx.input;
      const authorization = azureDevOpsAuthHeader();
      const projectUrl = `https://dev.azure.com/${encodeURIComponent(
        organization,
      )}/${encodeURIComponent(projectName)}`;

      ctx.logger.info(`Creating Azure DevOps project ${organization}/${projectName}`);

      const existingProjectResponse = await fetch(
        azureDevOpsOrganizationApiUrl(
          organization,
          `/_apis/projects/${encodeURIComponent(projectName)}?api-version=7.1-preview.4`,
        ),
        { headers: { Authorization: authorization } },
      );
      const existingProjectText = await existingProjectResponse.text();
      if (existingProjectResponse.ok) {
        ctx.output('projectUrl', projectUrl);
        ctx.output('created', false);
        ctx.logger.info(`Azure DevOps project already exists: ${projectName}`);
        return;
      }
      if (existingProjectResponse.status !== 404) {
        throw new Error(
          `Azure DevOps project lookup failed with ${existingProjectResponse.status}: ${existingProjectText.slice(0, 500)}`,
        );
      }

      const createProjectResponse = await fetch(
        azureDevOpsOrganizationApiUrl(
          organization,
          '/_apis/projects?api-version=7.1-preview.4',
        ),
        {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: projectName,
            description,
            visibility,
            capabilities: {
              versioncontrol: {
                sourceControlType: 'Git',
              },
              processTemplate: {
                templateTypeId: processTemplateId,
              },
            },
          }),
        },
      );
      const createProjectText = await createProjectResponse.text();
      if (!createProjectResponse.ok) {
        throw new Error(
          `Azure DevOps project creation failed with ${createProjectResponse.status}: ${createProjectText.slice(0, 500)}`,
        );
      }

      const operation = JSON.parse(createProjectText) as { url?: string };
      if (waitForCompletion && operation.url) {
        ctx.logger.info(`Waiting for Azure DevOps project ${projectName} to be ready`);

        for (let attempt = 1; attempt <= 24; attempt += 1) {
          await delay(5000);

          const operationResponse = await fetch(operation.url, {
            headers: { Authorization: authorization },
          });
          const operationText = await operationResponse.text();
          if (!operationResponse.ok) {
            throw new Error(
              `Azure DevOps project creation status check failed with ${operationResponse.status}: ${operationText.slice(0, 500)}`,
            );
          }

          const currentOperation = JSON.parse(operationText) as {
            status?: string;
            resultMessage?: string;
            detailedMessage?: string;
          };
          const status = currentOperation.status?.toLowerCase();

          if (status === 'succeeded') {
            ctx.logger.info(`Azure DevOps project ${projectName} is ready`);
            break;
          }
          if (status === 'failed' || status === 'cancelled') {
            throw new Error(
              `Azure DevOps project creation ${status}: ${currentOperation.resultMessage ?? currentOperation.detailedMessage ?? operationText.slice(0, 500)}`,
            );
          }
          if (attempt === 24) {
            throw new Error(
              `Timed out waiting for Azure DevOps project ${projectName} to be ready`,
            );
          }
        }
      }

      ctx.output('projectUrl', projectUrl);
      ctx.output('operationUrl', operation.url);
      ctx.output('created', true);
      ctx.logger.info(`Queued Azure DevOps project creation for ${projectName}`);
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
      '/_apis/serviceendpoint/endpoints?type=github&api-version=7.1-preview.4',
    ),
    { headers: { Authorization: authorization } },
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
      `Azure DevOps GitHub service connection '${expectedServiceConnectionName}' was not found in ${organization}/${project}. Available GitHub service connections: ${availableServiceConnections}.`,
    );
  }

  return serviceConnection;
};

const lookupAzureDevOpsServiceConnection = async (
  organization: string,
  project: string,
  serviceConnectionName: string,
  authorization: string,
) => {
  const serviceConnectionsResponse = await fetch(
    azureDevOpsApiUrl(
      organization,
      project,
      '/_apis/serviceendpoint/endpoints?type=github&api-version=7.1-preview.4',
    ),
    { headers: { Authorization: authorization } },
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

  return serviceConnections.value?.find(
    endpoint =>
      endpoint.name.localeCompare(expectedServiceConnectionName, undefined, {
        sensitivity: 'accent',
      }) === 0,
  );
};

const getAzureDevOpsProject = async (
  organization: string,
  project: string,
  authorization: string,
) => {
  const projectResponse = await fetch(
    azureDevOpsOrganizationApiUrl(
      organization,
      `/_apis/projects/${encodeURIComponent(project)}?api-version=7.1-preview.4`,
    ),
    { headers: { Authorization: authorization } },
  );
  const projectText = await projectResponse.text();
  if (!projectResponse.ok) {
    throw new Error(
      `Azure DevOps project lookup failed with ${projectResponse.status}: ${projectText.slice(0, 500)}`,
    );
  }

  return JSON.parse(projectText) as { id: string; name: string };
};

const createCreateAzureGitHubServiceConnectionAction = () =>
  createTemplateAction({
    id: 'azure:github:service-connection:create',
    description: 'Creates or reuses an Azure DevOps GitHub service connection',
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
        serviceConnectionName: z =>
          z
            .string({
              description: 'Azure DevOps GitHub service connection name',
            })
            .default('Github'),
      },
      output: {
        serviceConnectionId: z =>
          z.string().describe('Azure DevOps service connection ID'),
        serviceConnectionName: z =>
          z.string().describe('Azure DevOps service connection name'),
        created: z => z.boolean().describe('Whether the service connection was created'),
      },
    },
    async handler(ctx) {
      const { organization, project, serviceConnectionName } = ctx.input;
      const authorization = azureDevOpsAuthHeader();
      const expectedServiceConnectionName = serviceConnectionName.trim();

      const existingServiceConnection = await lookupAzureDevOpsServiceConnection(
        organization,
        project,
        expectedServiceConnectionName,
        authorization,
      );

      if (existingServiceConnection) {
        ctx.output('serviceConnectionId', existingServiceConnection.id);
        ctx.output('serviceConnectionName', existingServiceConnection.name);
        ctx.output('created', false);
        ctx.logger.info(
          `Azure DevOps GitHub service connection already exists: ${existingServiceConnection.name}`,
        );
        return;
      }

      const projectDetails = await getAzureDevOpsProject(
        organization,
        project,
        authorization,
      );

      ctx.logger.info(
        `Creating Azure DevOps GitHub service connection ${expectedServiceConnectionName} in ${organization}/${project}`,
      );

      const createServiceConnectionResponse = await fetch(
        azureDevOpsApiUrl(
          organization,
          project,
          '/_apis/serviceendpoint/endpoints?api-version=7.1-preview.4',
        ),
        {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: expectedServiceConnectionName,
            type: 'github',
            url: 'https://github.com',
            authorization: {
              scheme: 'PersonalAccessToken',
              parameters: {
                accessToken: githubToken(),
              },
            },
            isReady: true,
            isShared: false,
            serviceEndpointProjectReferences: [
              {
                name: expectedServiceConnectionName,
                projectReference: {
                  id: projectDetails.id,
                  name: projectDetails.name,
                },
              },
            ],
          }),
        },
      );
      const createServiceConnectionText = await createServiceConnectionResponse.text();
      if (!createServiceConnectionResponse.ok) {
        throw new Error(
          `Azure DevOps GitHub service connection creation failed with ${createServiceConnectionResponse.status}: ${createServiceConnectionText.slice(0, 500)}`,
        );
      }

      const serviceConnection = JSON.parse(createServiceConnectionText) as {
        id: string;
        name: string;
      };

      ctx.output('serviceConnectionId', serviceConnection.id);
      ctx.output('serviceConnectionName', serviceConnection.name);
      ctx.output('created', true);
      ctx.logger.info(
        `Created Azure DevOps GitHub service connection ${serviceConnection.name}`,
      );
    },
  });

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
            .default('Github'),
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
          '/_apis/pipelines?api-version=7.1-preview.1',
        ),
        { headers: { Authorization: authorization } },
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
          '/_apis/pipelines?api-version=7.1-preview.1',
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
                properties: {
                  fullName: githubRepository,
                },
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
          createDeleteGitHubRepositoryAction(),
          createCreateAzureProjectAction(),
          createCreateAzureGitHubServiceConnectionAction(),
          createCreateAzurePipelineAction(),
          createCreateAzurePipelineForGitHubAction(),
        );
      },
    });
  },
});