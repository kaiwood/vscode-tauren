import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentSession, SettingsManager } from '@earendil-works/pi-coding-agent';
import { ErrorCodes, ResponseError, type MessageConnection } from 'vscode-jsonrpc';
import { Requests, TaurenErrorCodes, type SettingResult } from './protocol/index.js';

type RuntimeModel = ReturnType<AgentSession['modelRuntime']['getModels']>[number];
const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const deliveryModes = ['all', 'one-at-a-time'] as const;
const transports = ['auto', 'sse', 'websocket', 'websocket-cached'] as const;

// Only errors created by this boundary are safe to send back. SDK/provider errors
// can contain request headers, credential values or credential storage paths.
class InvalidParams extends ResponseError<void> {
  constructor() {
    super(ErrorCodes.InvalidParams, 'Invalid runtime control parameters');
    // vscode-jsonrpc resets the prototype in ResponseError's constructor.
    Object.setPrototypeOf(this, InvalidParams.prototype);
  }
}
function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !keys.includes(key))) throw new InvalidParams();
  return input as Record<string, unknown>;
}
function noParams(input: unknown): void {
  if (input !== null && input !== undefined) throw new InvalidParams();
}
function string(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) throw new InvalidParams();
  return input.trim();
}
function boolean(input: unknown): boolean {
  if (typeof input !== 'boolean') throw new InvalidParams();
  return input;
}
function enumeration<T extends string>(input: unknown, values: readonly T[]): T {
  if (typeof input !== 'string' || !values.includes(input as T)) throw new InvalidParams();
  return input as T;
}
function modelReference(input: unknown): { provider: string; modelId: string } {
  const value = string(input);
  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) throw new InvalidParams();
  return { provider: value.slice(0, separator), modelId: value.slice(separator + 1) };
}
/** Catalog models can carry configured HTTP headers; never serialize them. */
function publicModel(model: RuntimeModel): Omit<RuntimeModel, 'headers'> {
  const { headers: _headers, ...metadata } = model;
  return metadata;
}
async function selectableModels(session: AgentSession): Promise<RuntimeModel[]> {
  const runtime = session.modelRuntime;
  const all = runtime.getModels();
  const available = await runtime.getAvailable();
  const availableProviders = new Set(available.map(model => model.provider));
  const configured = new Set(all.filter(model => availableProviders.has(model.provider)
    || runtime.getProviderAuthStatus(model.provider).configured).map(model => model.provider));
  const models = configured.size ? all.filter(model => configured.has(model.provider)) : available;
  return session.model && !models.some(model => model.provider === session.model?.provider && model.id === session.model?.id)
    ? [...models, session.model] : [...models];
}
async function selectModel(session: AgentSession, provider: string, modelId: string): Promise<RuntimeModel> {
  const model = (await selectableModels(session)).find(candidate => candidate.provider === provider && candidate.id === modelId);
  if (!model) throw new InvalidParams();
  await session.setModel(model);
  return model;
}
async function flushSettings(settings: SettingsManager): Promise<void> {
  // Settings writes are queued by the SDK; flush alone does not report failures.
  // Drain even after a rejected flush, without exposing SDK error/path details.
  let failed = false;
  try { await settings.flush(); } catch { failed = true; }
  if (settings.drainErrors().length > 0 || failed) throw new Error('Settings persistence failed');
}
async function updateSetting(session: AgentSession, input: unknown): Promise<SettingResult> {
  const { settingId, value } = object(input, ['settingId', 'value']);
  const settings = session.settingsManager;
  let result: SettingResult = { applied: 'live' };
  switch (settingId) {
    case 'defaultProvider':
      settings.setDefaultProvider(string(value));
      result = { applied: 'reload', message: 'Saved for new Pi sessions.' };
      break;
    case 'defaultModel': {
      const ref = modelReference(value);
      await selectModel(session, ref.provider, ref.modelId);
      result.message = 'Model updated for this session.';
      break;
    }
    case 'defaultThinkingLevel':
      session.setThinkingLevel(enumeration(value, thinkingLevels));
      result.message = 'Thinking level updated for this session.';
      break;
    case 'hideThinkingBlock':
      settings.setHideThinkingBlock(boolean(value));
      result.message = 'Thinking block visibility updated.';
      break;
    case 'quietStartup':
      settings.setQuietStartup(boolean(value));
      result.message = 'Quiet startup updated.';
      break;
    case 'compaction.enabled':
      session.setAutoCompactionEnabled(boolean(value));
      result.message = 'Auto-compaction updated.';
      break;
    case 'retry.enabled':
      session.setAutoRetryEnabled(boolean(value));
      result.message = 'Auto-retry updated.';
      break;
    case 'steeringMode':
      session.setSteeringMode(enumeration(value, deliveryModes));
      result.message = 'Steering delivery updated.';
      break;
    case 'followUpMode':
      session.setFollowUpMode(enumeration(value, deliveryModes));
      result.message = 'Follow-up delivery updated.';
      break;
    case 'transport':
      settings.setTransport(enumeration(value, transports));
      result.applied = 'reload';
      break;
    case 'images.blockImages':
      settings.setBlockImages(boolean(value));
      result.applied = 'reload';
      break;
    case 'images.autoResize':
      settings.setImageAutoResize(boolean(value));
      result.applied = 'reload';
      break;
    case 'enableSkillCommands':
      settings.setEnableSkillCommands(boolean(value));
      result.applied = 'reload';
      break;
    case 'enabledModels': {
      if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) throw new InvalidParams();
      const enabled = value.map(entry => {
        modelReference(entry);
        return entry as string;
      });
      const models = await selectableModels(session);
      // Reject unknown references instead of silently dropping malformed scope entries.
      const scoped = enabled.map(id => {
        const model = models.find(candidate => `${candidate.provider}/${candidate.id}` === id);
        if (!model) throw new InvalidParams();
        return { model };
      });
      session.setScopedModels(scoped);
      settings.setEnabledModels(enabled.length > 0 && scoped.length === models.length
        ? undefined : scoped.map(({ model }) => `${model.provider}/${model.id}`));
      result.message = 'Scoped models updated.';
      break;
    }
    default: throw new InvalidParams();
  }
  await flushSettings(settings);
  if (result.applied === 'reload' && !result.message) result.message = 'Saved. Reload Pi or start a new session to apply.';
  return result;
}

/** Register standalone SDK runtime controls and return their advertised methods.
 * active() resolves the current session on each request, including after switches.
 */
export function registerRuntimeControls(
  connection: MessageConnection,
  active: () => AgentSession,
  diagnostic: (message: string) => void
): string[] {
  const capabilities: string[] = [];
  const refreshed = new WeakSet<AgentSession>();
  function report(message: string): void {
    try { diagnostic(message); } catch { /* Diagnostics must not alter RPC outcomes. */ }
  }
  function register(method: string, handler: (session: AgentSession, input: unknown) => unknown): void {
    capabilities.push(method);
    connection.onRequest(method, async (input: unknown) => {
      // Lifecycle errors belong to active(); do not turn NotInitialized into InternalError.
      const session = active();
      try {
        const result = await handler(session, input);
        // Strip undefined fields and SDK prototypes at the JSON boundary.
        return JSON.parse(JSON.stringify(result)) as unknown;
      } catch (error) {
        if (error instanceof InvalidParams) throw error;
        report(`${method} failed`);
        throw new ResponseError(ErrorCodes.InternalError, 'Runtime control failed');
      }
    });
  }

  // SDK getters are the source of truth for live session state and effective settings.
  register(Requests.getState.method, (session, input) => {
    noParams(input);
    const settings = session.settingsManager;
    return {
      model: session.model ? publicModel(session.model) : undefined, thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming, isCompacting: session.isCompacting,
      steeringMode: session.steeringMode, followUpMode: session.followUpMode,
      sessionFile: session.sessionFile, sessionId: session.sessionId, sessionName: session.sessionName,
      autoCompactionEnabled: session.autoCompactionEnabled, autoRetryEnabled: session.autoRetryEnabled,
      defaultProvider: settings.getDefaultProvider(), defaultModel: settings.getDefaultModel(),
      defaultThinkingLevel: settings.getDefaultThinkingLevel(), hideThinkingBlock: settings.getHideThinkingBlock(),
      quietStartup: settings.getQuietStartup(), transport: settings.getTransport(),
      blockImages: settings.getBlockImages(), imageAutoResize: settings.getImageAutoResize(),
      enabledModels: settings.getEnabledModels(), enableSkillCommands: settings.getEnableSkillCommands(),
      messageCount: session.messages.length, pendingMessageCount: session.pendingMessageCount
    };
  });
  // SDK accounting spans all persisted entries; OAuth readiness identifies subscription use.
  register(Requests.getSessionStats.method, (session, input) => {
    noParams(input);
    return { ...session.getSessionStats(), sessionName: session.sessionName,
      usingSubscription: session.model ? session.modelRuntime.isUsingOAuth(session.model.provider) : false,
      autoCompactionEnabled: session.autoCompactionEnabled };
  });
  // SDK modelRuntime supplies configured-provider models, preserving a restored current model.
  // Refresh the catalog once per session in the background, as in PiSdkClient.
  register(Requests.getAvailableModels.method, async (session, input) => {
    noParams(input);
    const models = await selectableModels(session);
    if (!refreshed.has(session)) {
      refreshed.add(session);
      void session.modelRuntime.refresh().catch(() => report('Pi model catalog refresh failed'));
    }
    return { models: models.map(publicModel) };
  });
  // SDK command invocation names, templates and skills retain their original source information.
  register(Requests.getCommands.method, (session, input) => {
    noParams(input);
    return { commands: [
      ...session.extensionRunner.getRegisteredCommands().map(command => ({
        name: command.invocationName, description: command.description, source: 'extension', sourceInfo: command.sourceInfo
      })),
      ...session.promptTemplates.map(template => ({
        name: template.name, description: template.description, source: 'prompt', sourceInfo: template.sourceInfo
      })),
      ...session.resourceLoader.getSkills().skills.map(skill => ({
        name: `skill:${skill.name}`, description: skill.description, source: 'skill', sourceInfo: skill.sourceInfo
      }))
    ] };
  });
  // SDK resource discovery owns startup contents; local label helpers preserve compact display.
  register(Requests.getStartupResources.method, (session, input) => {
    noParams(input);
    const loader = session.resourceLoader;
    const sections: { name: string; items: string[] }[] = [];
    const context = loader.getAgentsFiles().agentsFiles;
    if (context.length) sections.push({ name: 'Context', items: context.map(file => formatContextResourcePath(file.path, session.sessionManager.getCwd())) });
    const skills = loader.getSkills().skills;
    if (skills.length) sections.push({ name: 'Skills', items: sortStartupResourceLabels(skills.map(skill => skill.name)) });
    if (session.promptTemplates.length) sections.push({ name: 'Prompts', items: sortStartupResourceLabels(session.promptTemplates.map(template => `/${template.name}`)) });
    const extensions = loader.getExtensions();
    for (const _error of extensions.errors) report('Pi extension failed to load');
    if (extensions.extensions.length) sections.push({ name: 'Extensions', items: sortStartupResourceLabels(getCompactExtensionLabels(extensions.extensions)) });
    const themes = loader.getThemes().themes.filter(theme => theme.sourcePath);
    if (themes.length) sections.push({ name: 'Themes', items: sortStartupResourceLabels(themes.map(theme => theme.name ?? getCompactPathLabel(theme.sourcePath ?? '', theme.sourceInfo))) });
    return { sections };
  });
  // SDK setModel checks auth and records the model change; only catalog models cross this boundary.
  register(Requests.setModel.method, async (session, input) => {
    const params = object(input, ['provider', 'modelId']);
    return publicModel(await selectModel(session, string(params.provider), string(params.modelId)));
  });
  // SDK clamps a valid thinking level to model capabilities, but does not validate arbitrary strings.
  register(Requests.setThinkingLevel.method, (session, input) => {
    const params = object(input, ['level']);
    session.setThinkingLevel(enumeration(params.level, thinkingLevels));
    return null;
  });
  // SDK session mutators handle live behavior; SettingsManager persists preferences and reports queued errors.
  register(Requests.updateSetting.method, updateSetting);
  // SDK readiness is enough for UI status. Never enumerate credentials or expose source/label/path metadata.
  register(Requests.getAuthProviders.method, (session, input) => {
    noParams(input);
    const runtime = session.modelRuntime;
    const providers: { id: string; name: string; authType: string; configured: boolean; canLogout: boolean }[] = [];
    for (const provider of runtime.getProviders()) {
      const configured = Boolean(runtime.getProviderAuthStatus(provider.id).configured);
      if (provider.auth.oauth) providers.push({ id: provider.id, name: provider.auth.oauth.name, authType: 'oauth', configured, canLogout: false });
      if (provider.auth.apiKey?.login) providers.push({ id: provider.id, name: provider.name, authType: 'api_key', configured, canLogout: false });
    }
    providers.sort((a, b) => a.name.localeCompare(b.name) || a.authType.localeCompare(b.authType));
    return { providers };
  });
  // SDK login(api_key) mutates credential storage: forbidden regardless of payload or initialization.
  connection.onRequest(Requests.loginWithApiKey.method, () => {
    throw new ResponseError(TaurenErrorCodes.CredentialPolicy, 'Credential changes are disabled');
  });
  // SDK OAuth login requires credential callbacks and token writes: never start that flow over this wire.
  connection.onRequest(Requests.loginWithOAuth.method, () => {
    throw new ResponseError(TaurenErrorCodes.CredentialPolicy, 'Credential changes are disabled');
  });
  // SDK logout deletes credentials: this server must not inspect or mutate them on request.
  connection.onRequest(Requests.logout.method, () => {
    throw new ResponseError(TaurenErrorCodes.CredentialPolicy, 'Credential changes are disabled');
  });
  capabilities.push(Requests.loginWithApiKey.method, Requests.loginWithOAuth.method, Requests.logout.method);
  return capabilities;
}

// Standalone copies of PiSdkClient startup-resource presentation helpers.
type StartupResourceSourceInfo = {
  source?: string;
  baseDir?: string;
};

type StartupResourcePathItem = {
  path: string;
  sourceInfo?: StartupResourceSourceInfo;
};

function sortStartupResourceLabels(labels: string[]): string[] {
  return labels
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function formatDisplayPath(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

function formatContextResourcePath(filePath: string, cwd: string): string {
  const resolvedCwd = path.resolve(cwd);
  const absolutePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(resolvedCwd, filePath);
  const relativePath = path.relative(resolvedCwd, absolutePath);

  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath.replace(/\\/g, '/');
  }

  if (relativePath === '') {
    return path.basename(absolutePath);
  }

  return formatDisplayPath(absolutePath);
}

function getShortPath(filePath: string, sourceInfo: StartupResourceSourceInfo | undefined): string {
  const baseDir = sourceInfo?.baseDir;

  if (baseDir && isPackageSource(sourceInfo)) {
    const relativePath = path.relative(path.resolve(baseDir), path.resolve(filePath));

    if (relativePath
      && relativePath !== '.'
      && !relativePath.startsWith('..')
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath)) {
      return relativePath.replace(/\\/g, '/');
    }
  }

  const source = sourceInfo?.source ?? '';
  const npmMatch = filePath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
  if (npmMatch && source.startsWith('npm:')) {
    return npmMatch[2] ?? filePath;
  }

  const gitMatch = filePath.match(/git\/[^/]+\/[^/]+\/(.*)/);
  if (gitMatch && source.startsWith('git:')) {
    return gitMatch[1] ?? filePath;
  }

  return formatDisplayPath(filePath);
}

function getCompactPathLabel(resourcePath: string, sourceInfo?: StartupResourceSourceInfo): string {
  const shortPath = getShortPath(resourcePath, sourceInfo);
  const segments = shortPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '~');

  return segments.at(-1) ?? shortPath;
}

function getCompactPackageSourceLabel(sourceInfo: StartupResourceSourceInfo | undefined): string {
  const source = sourceInfo?.source ?? '';

  if (source.startsWith('npm:')) {
    return source.slice('npm:'.length) || source;
  }

  if (source.startsWith('git:')) {
    const gitSource = source.slice('git:'.length).replace(/\.git$/, '');
    return gitSource.split('/').filter(Boolean).slice(-2).join('/') || gitSource || source;
  }

  return source;
}

function getCompactExtensionLabel(resourcePath: string, sourceInfo: StartupResourceSourceInfo | undefined): string {
  if (!isPackageSource(sourceInfo)) {
    return getCompactPathLabel(resourcePath, sourceInfo);
  }

  const sourceLabel = getCompactPackageSourceLabel(sourceInfo);
  if (!sourceLabel) {
    return getCompactPathLabel(resourcePath, sourceInfo);
  }

  const shortPath = getShortPath(resourcePath, sourceInfo).replace(/\\/g, '/');
  const packagePath = shortPath.startsWith('extensions/') ? shortPath.slice('extensions/'.length) : shortPath;
  const parsedPath = path.posix.parse(packagePath);

  if (parsedPath.name === 'index') {
    return !parsedPath.dir || parsedPath.dir === '.' ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
  }

  return `${sourceLabel}:${packagePath}`;
}

function getCompactDisplayPathSegments(resourcePath: string): string[] {
  return formatDisplayPath(resourcePath)
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '~');
}

function getCompactNonPackageExtensionLabel(resourcePath: string, index: number, allPaths: Array<{ segments: string[] }>): string {
  const segments = allPaths[index]?.segments;

  if (!segments || segments.length === 0) {
    return getCompactPathLabel(resourcePath);
  }

  for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
    const candidate = segments.slice(-segmentCount).join('/');
    const isUnique = allPaths.every((item, itemIndex) => itemIndex === index || item.segments.slice(-segmentCount).join('/') !== candidate);

    if (isUnique) {
      return candidate;
    }
  }

  return segments.join('/');
}

function getCompactExtensionLabels(extensions: StartupResourcePathItem[]): string[] {
  const nonPackageExtensions = extensions
    .map((extension) => {
      const segments = getCompactDisplayPathSegments(extension.path);
      const lastSegment = segments.at(-1);

      if (segments.length > 1 && (lastSegment === 'index.ts' || lastSegment === 'index.js')) {
        segments.pop();
      }

      return { ...extension, segments };
    })
    .filter((extension) => !isPackageSource(extension.sourceInfo));

  return extensions.map((extension) => {
    if (isPackageSource(extension.sourceInfo)) {
      return getCompactExtensionLabel(extension.path, extension.sourceInfo);
    }

    const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
    return nonPackageIndex === -1
      ? getCompactPathLabel(extension.path, extension.sourceInfo)
      : getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);
  });
}

function isPackageSource(sourceInfo: StartupResourceSourceInfo | undefined): boolean {
  const source = sourceInfo?.source ?? '';
  return source.startsWith('npm:') || source.startsWith('git:');
}
