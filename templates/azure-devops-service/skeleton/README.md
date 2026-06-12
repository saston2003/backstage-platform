# ${{ values.name }}

${{ values.description }}

This service was created from Backstage and published to Azure DevOps.

## Governance Standard

This repository was generated from the governed Azure DevOps service template.

- Repo names must be lowercase kebab-case.
- Deployments must use `pipelines/standard-deploy.yml`.
- Pipeline environments are limited to `dev`, `test`, and `prod`.
- Ownership and Azure DevOps access are declared in `.azuredevops/rbac.yml`.

## Developer Workflow

- Open the source repo from the Backstage component page.
- Track delivery work in Azure Boards.
- Use the included Azure Pipeline definition to automate build and release.
- Keep `catalog-info.yaml` updated so Backstage remains the developer-facing source of truth.

## Run Locally

```bash
npm install
npm start
```
