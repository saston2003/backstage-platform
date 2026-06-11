import { stringifyEntityRef } from '@backstage/catalog-model';
import {
  discoveryApiRef,
  fetchApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import {
  Link,
  ResponseErrorPanel,
  StatusAborted,
  StatusError,
  StatusOK,
  StatusPending,
  StatusRunning,
  StatusWarning,
  Table,
  TableColumn,
} from '@backstage/core-components';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { EntityContentBlueprint } from '@backstage/plugin-catalog-react/alpha';
import { isAzurePipelinesAvailable } from '@backstage/plugin-azure-devops';
import Box from '@material-ui/core/Box';
import Grid from '@material-ui/core/Grid';
import Typography from '@material-ui/core/Typography';
import React from 'react';
import useAsync from 'react-use/esm/useAsync';

type BuildRun = {
  id?: number;
  title?: string;
  link?: string;
  status?: number;
  result?: number;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  source?: string;
  uniqueName?: string;
};

const getAzureDevOpsAnnotations = (
  annotations: Record<string, string> = {},
) => {
  const hostOrg = annotations['dev.azure.com/host-org'];
  const projectRepo = annotations['dev.azure.com/project-repo'];
  const definition = annotations['dev.azure.com/build-definition'];
  const project = annotations['dev.azure.com/project'];

  const [host, org] = hostOrg?.split('/') ?? [];
  const [repoProject, repo] = projectRepo?.split('/') ?? [];

  return {
    host,
    org,
    project: project ?? repoProject,
    repo,
    definition,
  };
};

const buildStatus = (status?: number, result?: number) => {
  if (status === 1) {
    return (
      <Typography component="span">
        <StatusRunning /> In Progress
      </Typography>
    );
  }
  if (status === 4) {
    return (
      <Typography component="span">
        <StatusAborted /> Cancelling
      </Typography>
    );
  }
  if (status === 8) {
    return (
      <Typography component="span">
        <StatusPending /> Postponed
      </Typography>
    );
  }
  if (status === 32) {
    return (
      <Typography component="span">
        <StatusAborted /> Not Started
      </Typography>
    );
  }
  if (status === 2 && result === 2) {
    return (
      <Typography component="span">
        <StatusOK /> Succeeded
      </Typography>
    );
  }
  if (status === 2 && result === 4) {
    return (
      <Typography component="span">
        <StatusWarning /> Partially Succeeded
      </Typography>
    );
  }
  if (status === 2 && result === 8) {
    return (
      <Typography component="span">
        <StatusError /> Failed
      </Typography>
    );
  }
  if (status === 2 && result === 32) {
    return (
      <Typography component="span">
        <StatusAborted /> Canceled
      </Typography>
    );
  }

  return (
    <Typography component="span">
      <StatusWarning /> Unknown
    </Typography>
  );
};

const duration = (startTime?: string, finishTime?: string) => {
  if (!startTime) {
    return '';
  }
  const start = new Date(startTime).getTime();
  const finish = finishTime ? new Date(finishTime).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((finish - start) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
};

const age = (queueTime?: string) => {
  if (!queueTime) {
    return '';
  }
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(queueTime).getTime()) / 1000),
  );
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  return `${Math.floor(minutes / 60)}h ago`;
};

const columns: TableColumn<BuildRun>[] = [
  { title: 'ID', field: 'id', width: 'auto' },
  {
    title: 'Build',
    field: 'title',
    width: 'auto',
    render: row => <Link to={row.link ?? ''}>{row.title}</Link>,
  },
  { title: 'Source', field: 'source', width: 'auto' },
  {
    title: 'State',
    width: 'auto',
    render: row => (
      <Box display="flex" alignItems="center">
        {buildStatus(row.status, row.result)}
      </Box>
    ),
  },
  {
    title: 'Duration',
    width: 'auto',
    render: row => duration(row.startTime, row.finishTime),
  },
  { title: 'Age', width: 'auto', render: row => age(row.queueTime) },
];

const AzureDevOpsPipelinesContent = () => {
  const { entity } = useEntity();
  const discoveryApi = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);

  const { value, loading, error } = useAsync(async () => {
    const { project, repo, definition, host, org } = getAzureDevOpsAnnotations(
      entity.metadata.annotations,
    );
    const baseUrl = await discoveryApi.getBaseUrl('azure-devops');
    const query = new URLSearchParams({
      entityRef: stringifyEntityRef(entity),
      top: '10',
    });

    if (repo) {
      query.set('repoName', repo);
    }
    if (definition) {
      query.set('definitionName', definition);
    }
    if (host) {
      query.set('host', host);
    }
    if (org) {
      query.set('org', org);
    }

    const response = await fetch(
      `${baseUrl}/builds/${encodeURIComponent(project)}?${query}`,
    );
    if (!response.ok) {
      throw new Error(
        `Azure DevOps builds request failed with ${response.status}`,
      );
    }
    return (await response.json()) as BuildRun[];
  }, [discoveryApi, entity, fetch]);

  if (error) {
    return <ResponseErrorPanel error={error} />;
  }

  return (
    <Table
      title={`Azure Pipelines - Builds (${value?.length ?? 0})`}
      isLoading={loading}
      columns={columns}
      data={value ?? []}
      options={{
        search: true,
        paging: true,
        pageSize: 5,
        showEmptyDataSourceMessage: !loading,
      }}
    />
  );
};

const azureDevOpsPipelinesEntityContent = EntityContentBlueprint.make({
  name: 'azure-devops-pipelines',
  params: {
    path: '/pipelines',
    title: 'Pipelines',
    group: 'deployment',
    filter: isAzurePipelinesAvailable,
    loader: async () => (
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <AzureDevOpsPipelinesContent />
        </Grid>
      </Grid>
    ),
  },
});

export const azureDevOpsModule = createFrontendModule({
  pluginId: 'catalog',
  extensions: [azureDevOpsPipelinesEntityContent],
});
