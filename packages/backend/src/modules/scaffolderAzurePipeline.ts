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

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'azure-pipeline-runner',
  register(reg) {
    reg.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
      },
      async init({ scaffolder }) {
        scaffolder.addActions(createRunAzurePipelineAction());
      },
    });
  },
});