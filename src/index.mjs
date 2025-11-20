import chalk from 'chalk';
import ora from 'ora';
import {
  intro,
  outro,
  select,
  confirm,
  text,
  note,
  isCancel,
} from '@clack/prompts';
import { spawn } from 'node:child_process';

const DEFAULT_NAMESPACE = 'clustercost';
const HELM_REPO_NAME = 'clustercost';
const HELM_REPO_URL = 'https://charts.clustercost.com';
const AGENT_RELEASE = 'clustercost-agent';
const AGENT_CHART = 'clustercost/clustercost-agent-k8s';
const DASHBOARD_RELEASE = 'clustercost-dashboard';
const DASHBOARD_CHART = 'clustercost/clustercost-dashboard';
const DASHBOARD_SERVICE = 'clustercost-dashboard';
const DASHBOARD_TARGET_PORT = 9090;
const DASHBOARD_LOCAL_PORT = 3000;
const AGENT_SERVICE_HOST = `${AGENT_RELEASE}-${AGENT_CHART.split('/')[1]}`;
const AGENT_SERVICE_PORT = 8080;

let installState = {
  agent: null,
  dashboard: null,
};

class StepError extends Error {
  constructor(step, commandError) {
    super(`Step failed: ${step}`);
    this.name = 'StepError';
    this.step = step;
    this.commandError = commandError;
  }
}

class OperationCancelledError extends Error {
  constructor() {
    super('Operation cancelled by user');
    this.name = 'OperationCancelledError';
  }
}

export async function run() {
  try {
    await displaySplash();
    await ensurePrerequisites();
    installState = await detectInstallState();
    intro(chalk.cyanBright('ClusterCost control center'));

    let running = true;
    while (running) {
      const menuOptions = buildMenuOptions();
      const preferredInitial = hasExistingInstall() ? 'port-forward' : 'install';
      const initialValue =
        menuOptions.find((option) => option.value === preferredInitial)?.value ||
        menuOptions[0]?.value ||
        'install';
      const choice = await select({
        message: 'What would you like to do?',
        options: menuOptions,
        initialValue,
      });
      enforceNotCancelled(choice);

      switch (choice) {
        case 'install':
          await handleInstallFlow();
          break;
        case 'port-forward':
          await handlePortForwardFlow();
          break;
        case 'uninstall':
          await handleUninstallFlow();
          break;
        case 'debug':
          await showDebugInfo();
          break;
        case 'about':
          showClusterCostOverview();
          break;
        case 'exit':
          running = false;
          break;
        default:
          running = false;
      }
    }

    outro('Stay cost-aware. 👋');
  } catch (error) {
    if (error instanceof OperationCancelledError) {
      note('No changes were made.', 'Action cancelled');
      return;
    }

    if (error instanceof StepError) {
      renderStepError(error);
    } else {
      console.error(chalk.red(error.message || 'Unexpected error'));
    }

    process.exitCode = 1;
  }
}

async function displaySplash() {
  const frames = [
    '✦        ',
    ' ✦       ',
    '  ✦      ',
    '   ✦     ',
    '    ✦    ',
    '     ✦   ',
    '      ✦  ',
    '       ✦ ',
    '        ✦',
  ];

  process.stdout.write('\n');
  for (let i = 0; i < frames.length; i += 1) {
    process.stdout.write(`\r${chalk.magentaBright('Booting ClusterCost ')}${frames[i]}`);
    await sleep(70);
  }
  process.stdout.write('\n\n');

  console.log(chalk.hex('#4FC3F7').bold('ClusterCost'));
  console.log(chalk.gray('Know what your clusters really cost.\n'));

  console.log(chalk.dim('Use arrow keys to navigate. Press Enter to select.\n'));
}

async function ensurePrerequisites() {
  const missing = [];

  if (!(await commandExists('kubectl'))) {
    missing.push(
      'kubectl not found. Please install kubectl and configure your cluster context.'
    );
  }

  if (!(await commandExists('helm'))) {
    missing.push('Helm CLI not found. Please install Helm: https://helm.sh/docs/intro/install/');
  }

  if (missing.length > 0) {
    missing.forEach((message) => console.error(chalk.red(`✖ ${message}`)));
    throw new Error('Missing required dependencies.');
  }
}

async function handleInstallFlow() {
  const contextResult = await runShellCommand('kubectl', ['config', 'current-context']).catch(
    (error) => {
      throw new StepError('Detect current Kubernetes context', error);
    }
  );
  let contextName = contextResult.stdout || 'unknown';

  if (!hasExistingInstall()) {
    const confirmInstall = await confirm({
      message: `We detected Kubernetes context: ${chalk.cyan(
        contextName
      )}. Install ClusterCost here?`,
      initialValue: true,
    });
    enforceNotCancelled(confirmInstall);
    if (!confirmInstall) {
      const selectedContext = await promptForContextSelection(contextName);
      if (selectedContext !== contextName) {
        await switchKubectlContext(selectedContext);
      }
      note(`Using context ${chalk.cyan(selectedContext)}`, 'Context selected');
      contextName = selectedContext;
    }
  }

  const namespaceResponse = await text({
    message: 'Namespace to install into',
    placeholder: DEFAULT_NAMESPACE,
    initialValue: resolveDefaultNamespace(),
    validate: validateNamespace,
  });
  enforceNotCancelled(namespaceResponse);
  const namespace = (namespaceResponse || DEFAULT_NAMESPACE).trim();

  const canInstall = await ensureFreshInstallAllowed(namespace);
  if (!canInstall) {
    return;
  }

  if (!(await namespaceExists(namespace))) {
    await runStep(
      `Creating namespace ${namespace}`,
      async () => runShellCommand('kubectl', ['create', 'namespace', namespace]),
      `Namespace ${namespace} created`
    );
  }

  await prepareHelmRepository();
  await deployAgent(namespace);
  await deployDashboard(namespace);
  displayInstallSummary(namespace);
  installState = await detectInstallState();
}

async function handlePortForwardFlow() {
  const namespaceResponse = await text({
    message: 'Namespace containing the dashboard',
    placeholder: DEFAULT_NAMESPACE,
    initialValue: resolveDefaultNamespace(),
    validate: validateNamespace,
  });
  enforceNotCancelled(namespaceResponse);
  const namespace = (namespaceResponse || DEFAULT_NAMESPACE).trim();

  const serviceResponse = await text({
    message: 'Dashboard service name',
    placeholder: DASHBOARD_SERVICE,
    initialValue: DASHBOARD_SERVICE,
    validate: validateServiceName,
  });
  enforceNotCancelled(serviceResponse);
  const serviceName = (serviceResponse || DASHBOARD_SERVICE).trim();

  const portResponse = await text({
    message: 'Local port to bind',
    placeholder: String(DASHBOARD_LOCAL_PORT),
    initialValue: String(DASHBOARD_LOCAL_PORT),
    validate: validatePort,
  });
  enforceNotCancelled(portResponse);
  const localPort = Number(portResponse || DASHBOARD_LOCAL_PORT) || DASHBOARD_LOCAL_PORT;

  await establishPortForward(namespace, serviceName, localPort);
}

async function handleUninstallFlow() {
  const namespaceResponse = await text({
    message: 'Namespace where ClusterCost is installed',
    placeholder: DEFAULT_NAMESPACE,
    initialValue: resolveDefaultNamespace(),
    validate: validateNamespace,
  });
  enforceNotCancelled(namespaceResponse);
  const namespace = (namespaceResponse || DEFAULT_NAMESPACE).trim();

  const confirmRemoval = await confirm({
    message: `Remove ClusterCost agent and dashboard from ${chalk.cyan(namespace)}?`,
    initialValue: false,
  });
  enforceNotCancelled(confirmRemoval);
  if (!confirmRemoval) {
    note('ClusterCost removal cancelled.', 'Cancelled');
    return;
  }

  await uninstallRelease(AGENT_RELEASE, namespace, 'ClusterCost agent');
  await uninstallRelease(DASHBOARD_RELEASE, namespace, 'ClusterCost dashboard');

  console.log(chalk.greenBright('\n✔ ClusterCost removed.'));
  console.log(
    chalk.gray('You can reinstall anytime via "Install ClusterCost (agent + dashboard)".\n')
  );
  installState = await detectInstallState();
}

async function uninstallRelease(release, namespace, label) {
  const exists = await helmReleaseExists(release, namespace);
  if (!exists) {
    console.log(chalk.gray(`• ${label} not found in ${namespace}, skipping.`));
    return;
  }

  await runStep(
    `Uninstalling ${label}`,
    async () => runShellCommand('helm', ['uninstall', release, '-n', namespace]),
    `${label} removed`
  );
}

async function promptForContextSelection(currentContext) {
  let contextsResult;
  try {
    contextsResult = await runShellCommand('kubectl', ['config', 'get-contexts', '-o', 'name']);
  } catch (error) {
    throw new StepError('List Kubernetes contexts', error);
  }

  const contexts = (contextsResult.stdout || '')
    .split('\n')
    .map((context) => context.trim())
    .filter(Boolean);

  if (contexts.length === 0) {
    throw new StepError('List Kubernetes contexts', new Error('No Kubernetes contexts found.'));
  }

  console.log(chalk.bold('\nAvailable Kubernetes contexts:'));
  contexts.forEach((ctx) => {
    const marker = ctx === currentContext ? chalk.cyan('•') : chalk.gray('•');
    const label = ctx === currentContext ? chalk.cyan(ctx) : ctx;
    console.log(` ${marker} ${label}`);
  });
  console.log();

  const initialValue = contexts.includes(currentContext) ? currentContext : contexts[0];
  const selectedContext = await select({
    message: 'Choose a Kubernetes context for installation',
    options: contexts.map((ctx) => ({
      label: ctx === currentContext ? `${ctx} (current)` : ctx,
      value: ctx,
    })),
    initialValue,
  });
  enforceNotCancelled(selectedContext);
  return selectedContext;
}

async function switchKubectlContext(targetContext) {
  await runStep(
    `Switching kubectl context to ${targetContext}`,
    async () => runShellCommand('kubectl', ['config', 'use-context', targetContext]),
    `kubectl context set to ${targetContext}`
  );
}

export function validateNamespace(value) {
  if (value === undefined || value === null) {
    return 'Namespace cannot be empty.';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Namespace cannot be empty.';
  }
  if (/\s/.test(trimmed)) {
    return 'Namespace cannot contain spaces.';
  }
  return undefined;
}

export function validateServiceName(value) {
  if (value === undefined || value === null) {
    return 'Service name is required.';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Service name is required.';
  }
  if (/\s/.test(trimmed)) {
    return 'Service name cannot contain spaces.';
  }
  return undefined;
}

export function validatePort(value) {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  const numeric = Number(trimmed);
  if (Number.isNaN(numeric) || numeric <= 0 || numeric > 65535) {
    return 'Enter a valid TCP port (1-65535).';
  }
  return undefined;
}

async function ensureFreshInstallAllowed(namespace) {
  const agentExists = await helmReleaseExists(AGENT_RELEASE, namespace);
  const dashboardExists = await helmReleaseExists(DASHBOARD_RELEASE, namespace);

  if (!agentExists && !dashboardExists) {
    return true;
  }

  const installed = [
    agentExists ? 'agent' : null,
    dashboardExists ? 'dashboard' : null,
  ].filter(Boolean);

  const message = `ClusterCost ${installed.join(
    ' + '
  )} already detected in ${chalk.cyan(namespace)}. Reinstall and upgrade the existing release?`;

  const confirmReinstall = await confirm({
    message,
    initialValue: true,
  });
  enforceNotCancelled(confirmReinstall);

  if (!confirmReinstall) {
    note('Reinstall cancelled; existing deployment left untouched.', 'Existing install');
    return false;
  }

  note(
    `Proceeding with reinstall in ${chalk.cyan(namespace)}. Helm will upgrade the current release in place.`,
    'Reinstall confirmed'
  );
  return true;
}

function buildMenuOptions() {
  if (!hasExistingInstall()) {
    return [
      { label: 'Install ClusterCost (agent + dashboard)', value: 'install' },
      { label: 'What is ClusterCost?', value: 'about' },
      { label: 'Exit', value: 'exit' },
    ];
  }

  const namespace = resolveDefaultNamespace();
  const portForwardLabel = namespace
    ? `Launch dashboard (port-forward · ns: ${namespace})`
    : 'Launch dashboard (port-forward)';

  return [
    { label: portForwardLabel, value: 'port-forward' },
    { label: 'Upgrade ClusterCost (agent + dashboard)', value: 'install' },
    { label: 'Uninstall ClusterCost', value: 'uninstall' },
    { label: 'Show debug info', value: 'debug' },
    { label: 'What is ClusterCost?', value: 'about' },
    { label: 'Exit', value: 'exit' },
  ];
}

function hasExistingInstall(state = installState) {
  return Boolean(state.agent || state.dashboard);
}

function resolveDefaultNamespace() {
  return (
    installState.agent?.namespace ||
    installState.dashboard?.namespace ||
    DEFAULT_NAMESPACE
  );
}

async function detectInstallState() {
  try {
    const result = await runShellCommand('helm', ['list', '-A', '-o', 'json']);
    const stdout = (result.stdout || '').trim();
    const releases = stdout ? JSON.parse(stdout) : [];
    return {
      agent: findReleaseInfo(releases, AGENT_RELEASE),
      dashboard: findReleaseInfo(releases, DASHBOARD_RELEASE),
    };
  } catch {
    return installState;
  }
}

function findReleaseInfo(releases, releaseName) {
  const match = releases.find((release) => release.name === releaseName);
  if (!match) {
    return null;
  }
  return {
    namespace: match.namespace,
    revision: match.revision,
    updated: match.updated,
    status: match.status,
  };
}

function buildAgentBaseUrl(namespace) {
  return `http://${AGENT_SERVICE_HOST}.${namespace}.svc.cluster.local:${AGENT_SERVICE_PORT}`;
}

export function buildDashboardHelmArgs(namespace) {
  const args = [
    'upgrade',
    '--install',
    DASHBOARD_RELEASE,
    DASHBOARD_CHART,
    '-n',
    namespace,
  ];

  if (namespace !== DEFAULT_NAMESPACE) {
    args.push('--set-string', `agents[0].baseUrl=${buildAgentBaseUrl(namespace)}`);
  }

  return args;
}

function showClusterCostOverview() {
  console.log(chalk.bold('\n• What is ClusterCost?'));
  console.log(
    'ClusterCost is a lightweight Kubernetes add-on composed of two pieces: an agent that scrapes cluster cost signals and a dashboard that presents live spend, efficiency, and savings insights.'
  );
  console.log(
    '\nIn the open-source distribution, all metrics stay inside your cluster. Nothing is shipped to our cloud—you remain in full control of data residency.'
  );
  console.log(
    `\nDocs: ${chalk.cyan('https://clustercost.com/docs/introduction/welcome/')} (installation, architecture, and roadmap).\n`
  );
}

async function showDebugInfo() {
  console.log(chalk.bold('\n• Debug info'));

  const context = await safeCommandOutput('kubectl', [
    'config',
    'current-context',
  ]);
  console.log(`${chalk.cyan('Context:')} ${context || 'n/a'}`);

  const namespaces = await safeCommandOutput('kubectl', ['get', 'ns']);
  console.log(`\n${chalk.cyan('Namespaces:')}\n${namespaces || 'n/a'}`);

  const helmVersion = await safeCommandOutput('helm', ['version']);
  console.log(`\n${chalk.cyan('Helm version:')} ${helmVersion || 'n/a'}`);

  const helmList = await safeCommandOutput('helm', ['list', '-n', DEFAULT_NAMESPACE]);
  console.log(`\n${chalk.cyan(`Helm releases (${DEFAULT_NAMESPACE}):`)}\n${helmList || 'n/a'}\n`);
}

async function runShellCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
      } else {
        const error = new Error(`Command failed: ${command} ${args.join(' ')}`.trim());
        error.code = code;
        error.stdout = stdout.trim();
        error.stderr = stderr.trim();
        error.command = `${command} ${args.join(' ')}`.trim();
        reject(error);
      }
    });
  });
}

async function commandExists(binary) {
  try {
    await runShellCommand('which', [binary]);
    return true;
  } catch {
    return false;
  }
}

async function namespaceExists(namespace) {
  try {
    await runShellCommand('kubectl', ['get', 'namespace', namespace]);
    return true;
  } catch {
    return false;
  }
}

async function prepareHelmRepository() {
  const repoExists = await helmRepoExists(HELM_REPO_NAME);

  if (!repoExists) {
    await runStep(
      'Adding ClusterCost Helm repository',
      async () => runShellCommand('helm', ['repo', 'add', HELM_REPO_NAME, HELM_REPO_URL]),
      'ClusterCost Helm repository added'
    );
  } else {
    console.log(chalk.gray('• Helm repository already configured.'));
  }

  await runStep(
    'Updating Helm repositories',
    async () => runShellCommand('helm', ['repo', 'update']),
    'Helm repositories updated'
  );
}

async function helmRepoExists(name) {
  try {
    const result = await runShellCommand('helm', ['repo', 'list', '-o', 'json']);
    if (!result.stdout) {
      return false;
    }
    const repositories = JSON.parse(result.stdout);
    return Array.isArray(repositories) && repositories.some((repo) => repo.name === name);
  } catch {
    return false;
  }
}

async function helmReleaseExists(release, namespace) {
  try {
    await runShellCommand('helm', ['status', release, '-n', namespace]);
    return true;
  } catch {
    return false;
  }
}

async function deployAgent(namespace) {
  await runStep(
    'Deploying ClusterCost agent',
    async () =>
      runShellCommand('helm', [
        'upgrade',
        '--install',
        AGENT_RELEASE,
        AGENT_CHART,
        '-n',
        namespace,
        '--create-namespace',
      ]),
    'ClusterCost agent deployed'
  );
}

async function deployDashboard(namespace) {
  await runStep(
    'Deploying ClusterCost dashboard',
    async () => runShellCommand('helm', buildDashboardHelmArgs(namespace)),
    'ClusterCost dashboard deployed'
  );
}

function displayInstallSummary(namespace) {
  console.log(chalk.greenBright('\n✔ ClusterCost installation complete!'));
  console.log(`${chalk.gray('Namespace:')} ns: ${chalk.cyan(namespace)}`);
  console.log(`${chalk.gray('Agent release:')} ${AGENT_RELEASE}`);
  console.log(`${chalk.gray('Dashboard release:')} ${DASHBOARD_RELEASE}`);
  console.log(
    chalk.gray('\nNext steps: select "Open dashboard (port-forward)" from the main menu to launch the UI.\n')
  );
}

async function establishPortForward(namespace, serviceName, localPort) {
  const args = [
    'port-forward',
    '-n',
    namespace,
    `svc/${serviceName}`,
    `${localPort}:${DASHBOARD_TARGET_PORT}`,
  ];

  const forwardSpinner = ora('Establishing port-forward...').start();

  const child = spawn('kubectl', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let connected = false;

  child.stdout.on('data', (data) => {
    const text = data.toString();
    stdout += text;
    if (!connected && text.toLowerCase().includes('forwarding from')) {
      connected = true;
      forwardSpinner.succeed('Dashboard tunnel established');
      console.log(chalk.green(`Dashboard available at http://localhost:${localPort}`));
      console.log(chalk.dim('Press Ctrl+C to stop the port-forward.\n'));
    }
    process.stdout.write(text);
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const exitPromise = new Promise((resolve, reject) => {
    child.on('error', (error) => {
      if (!connected) {
        forwardSpinner.fail('Failed to establish port-forward');
      }
      const wrapped = new StepError('Open dashboard port-forward', error);
      reject(wrapped);
    });

    child.on('close', (code, signal) => {
      if (!connected) {
        forwardSpinner.fail('Failed to establish port-forward');
        const error = new Error('kubectl port-forward exited early');
        error.command = `kubectl ${args.join(' ')}`;
        error.stderr = stderr.trim() || stdout.trim();
        reject(new StepError('Open dashboard port-forward', error));
        return;
      }

      if (signal === 'SIGINT' || code === 0) {
        resolve();
      } else {
        const error = new Error('kubectl port-forward exited unexpectedly');
        error.command = `kubectl ${args.join(' ')}`;
        error.stderr = stderr.trim() || stdout.trim();
        reject(new StepError('Open dashboard port-forward', error));
      }
    });
  });

  await exitPromise;
}

async function runStep(label, fn, successLabel) {
  const spinner = ora(label).start();
  try {
    const result = await fn();
    spinner.succeed(successLabel || label);
    return result;
  } catch (error) {
    spinner.fail(label);
    if (error instanceof StepError) {
      throw error;
    }
    throw new StepError(label, error);
  }
}

async function safeCommandOutput(command, args) {
  try {
    const result = await runShellCommand(command, args);
    return result.stdout;
  } catch (error) {
    return chalk.red(
      error.stderr || error.message || `Unable to execute ${command} ${args.join(' ')}`
    );
  }
}

function enforceNotCancelled(value) {
  if (isCancel(value)) {
    throw new OperationCancelledError();
  }
}

function renderStepError(error) {
  console.error(chalk.red(`\n✖ ${error.step}`));
  if (error.commandError?.command) {
    console.error(chalk.red(`Command: ${error.commandError.command}`));
  }
  if (error.commandError?.stderr) {
    console.error(chalk.gray(error.commandError.stderr));
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
