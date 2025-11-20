# ClusterCost CLI

An interactive, stylish installer that deploys the ClusterCost agent and dashboard into your Kubernetes cluster. It guides you through Helm-based installation, opens a port-forward to the dashboard, and surfaces helpful debug info when needed.

## Requirements

- Node.js 18 or later
- `kubectl` configured for the target cluster
- `helm` available in your `PATH`

## Usage

```bash
npx @clustercost/cli
```

From the main menu you can:

- Install the ClusterCost agent and dashboard Helm charts
- Open a `kubectl port-forward` to the dashboard service
- Print handy debug information (context, namespaces, Helm status)

## Development

```bash
npm install        # install dependencies
npm run lint       # eslint check for all .mjs modules
npm test           # vitest unit tests
```

CI runs the same lint + test steps via `.github/workflows/ci.yml` on every push and pull request.

## Publishing

1. Ensure you are authenticated with npm (`npm login`) and have access to the `@clustercost` scope.
2. Bump the `version` field in `package.json` following semver.
3. Run `npm run lint && npm test` (or `npm run release` to lint, test, and publish in one go).
4. Publish with `npm publish --access public`.

After the publish completes, consumers can install or run directly via `npx @clustercost/cli`.

### Automated publishing

The workflow in `.github/workflows/release.yml` can publish for you when a GitHub Release is published (or when manually triggered). Configure the `NPM_TOKEN` repository secret with an npm token that has publish rights to the `@clustercost` scope before running it.
