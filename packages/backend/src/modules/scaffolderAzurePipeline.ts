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
        );
      },
    });
  },
});