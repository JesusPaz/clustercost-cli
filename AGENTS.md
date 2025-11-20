# Repository Guidelines

## Project Structure & Module Organization
The CLI ships as an ES module. `bin/cli.mjs` is the published entry point referenced by `package.json`’s `bin` field, and it simply wires CLI execution to `src/index.mjs`, where the prompt flows, spinner helpers, and Helm/kubectl orchestration live. Keep shared helpers inside `src/` and favor new files (for example `src/port-forward.mjs`) when a flow grows beyond ~150 lines for easier testing. Assets such as ASCII art or configuration snippets should sit near the code that consumes them—there is no separate assets directory yet.

## Build, Test, and Development Commands
- `npm install` – installs the Node 18+ dependency set (`chalk`, `ora`, `@clack/prompts`).
- `npm start` – runs the bundled CLI (`node ./bin/cli.mjs`) for rapid local validation.
- `node ./src/index.mjs` – helpful when debugging exported helpers without the bin wrapper.
- `npm test` – currently a placeholder; replace the script once automated tests are introduced.
- `npx @clustercost/cli` – mirrors how end users consume the package from npm.

## Coding Style & Naming Conventions
Follow the established two-space indentation, trailing commas in arrays/objects, and camelCase for functions and variables. Reserve UPPER_SNAKE_CASE for constants that represent Kubernetes or Helm names (e.g., `DEFAULT_NAMESPACE`). Import Node built-ins via `node:` specifiers and keep all files as `.mjs` to retain ESM consistency. Prefer small pure helpers and keep side-effecting shell calls inside clearly named functions such as `ensurePrerequisites`.

## Testing Guidelines
No automated suite exists yet, but new work should introduce tests under `src/__tests__/` using a light framework like `vitest` or `uvu` so we can assert prompt flows without a cluster. Mock `kubectl`/`helm` invocations via dependency injection rather than spawning real binaries. Aim to cover each menu flow (install, port-forward, debug) and simulate cancellation paths. Until formal tests land, manually run `npm start` against a kind cluster or `kubectl --context` targeting a sandbox and capture logs in the PR.

## Commit & Pull Request Guidelines
Write imperative, scope-aware commits (`feat: add dashboard port-forward helper`). Group related changes; avoid mixing formatting and behavior in one commit. Pull requests should describe the scenario being solved, list manual/automated test evidence, and include any relevant screenshots or terminal recordings when UX output changes. Reference Jira/GitHub issues in the description, note breaking changes explicitly, and request at least one reviewer familiar with Kubernetes tooling.

## Security & Configuration Tips
Never hardcode kubeconfig paths, tokens, or Helm repo credentials. All commands should honor the active `kubectl` context and namespace inputs. When adding new shell integrations, sanitize user input before passing it to `spawn`, log only high-level statuses, and document any required environment variables in the README.
