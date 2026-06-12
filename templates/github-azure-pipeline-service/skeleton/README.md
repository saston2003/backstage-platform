# ${{ values.name }}

${{ values.description }}

This service was created from Backstage, published to GitHub, and connected to an Azure DevOps Pipeline.

## Governance Standard

This repository was generated from the GitHub service with Azure Pipeline template.

- Repo names must be lowercase kebab-case.
- Deployments must use `pipelines/standard-deploy.yml`.
- Pipeline environments are limited to `dev`, `test`, and `prod`.
- `catalog-info.yaml` keeps Backstage as the developer-facing source of truth.

## Developer Workflow

- Open the source repo from the Backstage component page.
- Track delivery work in Azure Boards.
- Use the included Azure Pipeline definition to automate build and release.
- Keep `catalog-info.yaml` updated so Backstage remains current.

## Run Locally

```bash
npm install
npm start
```