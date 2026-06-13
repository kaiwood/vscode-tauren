export type TaurenBackend = 'pi' | 'kward';

export type TaurenSettingId =
  | 'tauren.backend'
  | 'tauren.kward.path'
  | 'tauren.outputColors'
  | 'tauren.animationsEnabled'
  | 'tauren.showWelcome'
  | 'tauren.useTaurenShareViewer'
  | 'tauren.customUiTheme'
  | 'tauren.extensions.aboveWidgetsEnabled'
  | 'tauren.extensions.belowWidgetsEnabled'
  | 'tauren.extensions.statusBarEnabled'
  | 'tauren.extensions.backgroundColorsEnabled'
  | 'tauren.extensions.monospaceFontEnabled'
  | 'tauren.blockHttpsImages'
  | 'tauren.confirmSessionDeletion'
  | 'tauren.restrictFileReferencesToWorkspace'
  | 'tauren.rejectEditWriteOutsideWorkspace'
  | 'tauren.debugPerformance'
  | 'tauren.readyScript'
  | 'tauren.readyScriptEnabled';

export type PiSettingId =
  | 'defaultProvider'
  | 'defaultModel'
  | 'defaultThinkingLevel'
  | 'hideThinkingBlock'
  | 'quietStartup'
  | 'compaction.enabled'
  | 'retry.enabled'
  | 'steeringMode'
  | 'followUpMode'
  | 'transport'
  | 'images.blockImages'
  | 'images.autoResize'
  | 'enabledModels'
  | 'enableSkillCommands';

export type TaurenSettingsSection = 'appearance' | 'login' | 'extensions' | 'runtime' | 'scopedModels' | 'workspaceSafety' | 'advanced';
export type SettingsOwner = 'tauren' | 'pi';
export type SettingControl = 'toggle' | 'select' | 'text' | 'readonlyList' | 'scopedModels';
export type SettingValue = boolean | string | string[];
export type SettingId = TaurenSettingId | PiSettingId;

export type SettingOption = {
  value: string;
  label: string;
};

export type SettingDefinition = {
  id: SettingId;
  owner: SettingsOwner;
  section: TaurenSettingsSection;
  label: string;
  description: string;
  control: SettingControl;
  options?: readonly SettingOption[];
  defaultValue: SettingValue;
  helper?: string;
  liveBehavior?: 'immediate' | 'reload';
  danger?: boolean;
  subtle?: boolean;
  readOnly?: boolean;
};

export const thinkingLevelOptions = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X High' }
] as const satisfies readonly SettingOption[];

const deliveryModeOptions = [
  { value: 'one-at-a-time', label: 'One at a time' },
  { value: 'all', label: 'All queued' }
] as const satisfies readonly SettingOption[];

const transportOptions = [
  { value: 'sse', label: 'SSE' },
  { value: 'websocket', label: 'WebSocket' },
  { value: 'auto', label: 'Auto' }
] as const satisfies readonly SettingOption[];

const backendOptions = [
  { value: 'pi', label: 'Pi' },
  { value: 'kward', label: 'Kward' }
] as const satisfies readonly SettingOption[];

const customUiThemeOptions = [
  { value: 'default', label: 'Default' },
  { value: 'modern', label: 'Modern' },
  { value: 'crt', label: 'CRT' },
  { value: 'amber', label: 'Amber' },
  { value: 'matrix', label: 'Matrix' }
] as const satisfies readonly SettingOption[];

export const settingsSections = [
  {
    id: 'login',
    label: 'Login',
    eyebrow: 'Backend auth',
    title: 'Login',
    description: 'Configure runtime provider authentication for the selected backend.'
  },
  {
    id: 'appearance',
    label: 'Appearance',
    eyebrow: 'Tauren host',
    title: 'Appearance',
    description: 'Tauren-owned presentation controls for the sidebar and Pi extension UI.'
  },
  {
    id: 'extensions',
    label: 'Extensions',
    eyebrow: 'Pi extensions',
    title: 'Extensions',
    description: 'Sidebar-only controls for Pi extension surfaces in Tauren.'
  },
  {
    id: 'runtime',
    label: 'Runtime',
    eyebrow: 'Agent runtime',
    title: 'Runtime',
    description: 'Backend defaults and runtime behavior. The selected backend remains the source of truth.'
  },
  {
    id: 'scopedModels',
    label: 'Scoped Models',
    eyebrow: 'Agent runtime',
    title: 'Scoped Models',
    description: 'Choose and order the models Tauren sends to the selected backend for model cycling.'
  },
  {
    id: 'workspaceSafety',
    label: 'Safety',
    eyebrow: 'Guardrails',
    title: 'Workspace / Safety',
    description: 'Explicit workflow and workspace safety controls.'
  },
  {
    id: 'advanced',
    label: 'Advanced',
    eyebrow: 'Advanced',
    title: 'Advanced',
    description: 'Less common controls shown plainly, without turning Tauren into a settings dump.'
  }
] as const;

export const settingDefinitions = [
  {
    id: 'tauren.backend',
    owner: 'tauren',
    section: 'runtime',
    label: 'Backend',
    description: 'Agent backend Tauren should use for sidebar chat.',
    control: 'select',
    options: backendOptions,
    defaultValue: 'pi',
    helper: 'Kward is experimental and uses a local RPC process.',
    liveBehavior: 'reload'
  },
  {
    id: 'tauren.kward.path',
    owner: 'tauren',
    section: 'runtime',
    label: 'Kward path',
    description: 'Local Kward source directory or executable path used when Backend is Kward.',
    control: 'text',
    defaultValue: '',
    helper: 'Directories launch with bundle exec ruby lib/main.rb rpc; executable files launch with rpc.',
    liveBehavior: 'reload'
  },
  {
    id: 'tauren.outputColors',
    owner: 'tauren',
    section: 'appearance',
    label: 'Output colors',
    description: 'Render ANSI and syntax colors in Tauren output.',
    control: 'toggle',
    defaultValue: true,
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.animationsEnabled',
    owner: 'tauren',
    section: 'appearance',
    label: 'Animations',
    description: 'Use subtle surface and counter animations.',
    control: 'toggle',
    defaultValue: true,
    helper: 'Reduced-motion preferences still disable motion.',
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.showWelcome',
    owner: 'tauren',
    section: 'appearance',
    label: 'Welcome message',
    description: 'Show the Welcome to Tauren empty state for new chats.',
    control: 'toggle',
    defaultValue: true,
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.useTaurenShareViewer',
    owner: 'tauren',
    section: 'appearance',
    label: 'Tauren export style',
    description: 'Use Tauren docs styling for HTML exports and new shared session links.',
    control: 'toggle',
    defaultValue: true,
    helper: 'When disabled, exports keep Pi styling and /share uses pi.dev unless PI_SHARE_VIEWER_URL is set.',
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.customUiTheme',
    owner: 'tauren',
    section: 'appearance',
    label: 'Custom UI theme',
    description: 'Theme for Pi extension custom UI terminal panels.',
    control: 'select',
    options: customUiThemeOptions,
    defaultValue: 'default',
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.extensions.aboveWidgetsEnabled',
    owner: 'tauren',
    section: 'extensions',
    label: 'Enable above widgets',
    description: 'Show Pi extension widgets above the composer.',
    control: 'toggle',
    defaultValue: true,
    helper: 'Sidebar-only setting; turning this off clears current above widgets.',
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.extensions.belowWidgetsEnabled',
    owner: 'tauren',
    section: 'extensions',
    label: 'Enable below widgets',
    description: 'Show Pi extension widgets below the composer.',
    control: 'toggle',
    defaultValue: true,
    helper: 'Sidebar-only setting; turning this off clears current below widgets.',
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.extensions.statusBarEnabled',
    owner: 'tauren',
    section: 'extensions',
    label: 'Enable status bar',
    description: 'Show one-line Pi extension status updates below the composer.',
    control: 'toggle',
    defaultValue: true,
    helper: 'Sidebar-only setting; turning this off clears current statuses.',
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.extensions.backgroundColorsEnabled',
    owner: 'tauren',
    section: 'extensions',
    label: 'Enable background colors',
    description: 'Render background colors sent by Pi extension widgets.',
    control: 'toggle',
    defaultValue: true,
    helper: 'Foreground colors still follow Output colors.',
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.extensions.monospaceFontEnabled',
    owner: 'tauren',
    section: 'extensions',
    label: 'Use monospace font',
    description: 'Use the editor monospace font for Pi extension widgets and status.',
    control: 'toggle',
    defaultValue: true,
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.blockHttpsImages',
    owner: 'tauren',
    section: 'workspaceSafety',
    label: 'Block HTTPS images',
    description: 'Block remote HTTPS images in chat markdown.',
    control: 'toggle',
    defaultValue: true,
    helper: 'Turn this off to allow external HTTPS image requests while keeping local/workspace images available.',
    liveBehavior: 'immediate',
    danger: true
  },
  {
    id: 'defaultProvider',
    owner: 'pi',
    section: 'runtime',
    label: 'Default provider',
    description: 'Provider Pi should prefer for new model defaults.',
    control: 'select',
    defaultValue: '',
    helper: 'Provider-only changes are persisted for new sessions.',
    liveBehavior: 'reload'
  },
  {
    id: 'defaultModel',
    owner: 'pi',
    section: 'runtime',
    label: 'Default model',
    description: 'Model used by Pi for this session and future defaults.',
    control: 'select',
    defaultValue: '',
    liveBehavior: 'immediate'
  },
  {
    id: 'defaultThinkingLevel',
    owner: 'pi',
    section: 'runtime',
    label: 'Thinking level',
    description: 'Default reasoning effort for models that support thinking.',
    control: 'select',
    options: thinkingLevelOptions,
    defaultValue: 'off',
    liveBehavior: 'immediate'
  },
  {
    id: 'hideThinkingBlock',
    owner: 'pi',
    section: 'runtime',
    label: 'Hide thinking blocks',
    description: 'Hide model thinking content in the Tauren transcript.',
    control: 'toggle',
    defaultValue: false,
    liveBehavior: 'immediate'
  },
  {
    id: 'quietStartup',
    owner: 'pi',
    section: 'runtime',
    label: 'Quiet startup',
    description: 'Show a blank Tauren transcript for empty new sessions.',
    control: 'toggle',
    defaultValue: false,
    liveBehavior: 'immediate'
  },
  {
    id: 'compaction.enabled',
    owner: 'pi',
    section: 'runtime',
    label: 'Auto-compaction',
    description: 'Let Pi summarize older context when the conversation grows too large.',
    control: 'toggle',
    defaultValue: true,
    liveBehavior: 'immediate'
  },
  {
    id: 'retry.enabled',
    owner: 'pi',
    section: 'runtime',
    label: 'Auto-retry',
    description: 'Let Pi retry transient provider failures.',
    control: 'toggle',
    defaultValue: true,
    liveBehavior: 'immediate'
  },
  {
    id: 'steeringMode',
    owner: 'pi',
    section: 'runtime',
    label: 'Steering delivery',
    description: 'How steering messages are delivered while Pi is running.',
    control: 'select',
    options: deliveryModeOptions,
    defaultValue: 'one-at-a-time',
    liveBehavior: 'immediate'
  },
  {
    id: 'followUpMode',
    owner: 'pi',
    section: 'runtime',
    label: 'Follow-up delivery',
    description: 'How follow-up prompts are delivered after the current run.',
    control: 'select',
    options: deliveryModeOptions,
    defaultValue: 'one-at-a-time',
    liveBehavior: 'immediate'
  },
  {
    id: 'tauren.confirmSessionDeletion',
    owner: 'tauren',
    section: 'workspaceSafety',
    label: 'Confirm deletion',
    description: 'Ask before moving Tauren sessions to Trash.',
    control: 'toggle',
    defaultValue: true,
    liveBehavior: 'immediate',
    danger: true
  },
  {
    id: 'tauren.restrictFileReferencesToWorkspace',
    owner: 'tauren',
    section: 'workspaceSafety',
    label: 'Restrict file links',
    description: 'Only open Tauren sidebar file references when they resolve inside the workspace.',
    control: 'toggle',
    defaultValue: true,
    helper: 'Turn this off to allow Tauren sidebar links to open absolute local files outside the workspace.',
    liveBehavior: 'immediate',
    danger: true
  },
  {
    id: 'tauren.rejectEditWriteOutsideWorkspace',
    owner: 'tauren',
    section: 'workspaceSafety',
    label: 'Reject external edits',
    description: 'Reject Pi edit/write mutations outside the active workspace folder.',
    control: 'toggle',
    defaultValue: false,
    helper: 'This guardrail does not restrict bash commands.',
    liveBehavior: 'immediate',
    danger: true
  },
  {
    id: 'tauren.debugPerformance',
    owner: 'tauren',
    section: 'advanced',
    label: 'Debug performance',
    description: 'Collect Tauren performance diagnostics in the output channel and diagnostics view.',
    control: 'toggle',
    defaultValue: false,
    liveBehavior: 'immediate',
    subtle: true
  },
  {
    id: 'tauren.readyScript',
    owner: 'tauren',
    section: 'advanced',
    label: 'Ready script',
    description: 'Executable script Tauren runs when Pi becomes ready.',
    control: 'text',
    defaultValue: '',
    helper: 'Relative paths resolve from the workspace folder.',
    liveBehavior: 'immediate',
    subtle: true
  },
  {
    id: 'tauren.readyScriptEnabled',
    owner: 'tauren',
    section: 'advanced',
    label: 'Run ready script',
    description: 'Temporarily enable or disable the ready script without clearing its path.',
    control: 'toggle',
    defaultValue: true,
    liveBehavior: 'immediate',
    subtle: true
  },
  {
    id: 'transport',
    owner: 'pi',
    section: 'advanced',
    label: 'Transport',
    description: 'Preferred provider transport when multiple transports are available.',
    control: 'select',
    options: transportOptions,
    defaultValue: 'sse',
    helper: 'Persisted for Pi; takes effect after reload or a new session.',
    liveBehavior: 'reload',
    subtle: true
  },
  {
    id: 'images.blockImages',
    owner: 'pi',
    section: 'advanced',
    label: 'Block LLM images',
    description: 'Prevent images from being sent to the model.',
    control: 'toggle',
    defaultValue: false,
    helper: 'Persisted for Pi; takes effect after reload or a new session.',
    liveBehavior: 'reload',
    subtle: true
  },
  {
    id: 'images.autoResize',
    owner: 'pi',
    section: 'advanced',
    label: 'Auto-resize images',
    description: 'Let Pi resize images before sending them to the model.',
    control: 'toggle',
    defaultValue: true,
    helper: 'Persisted for Pi; takes effect after reload or a new session.',
    liveBehavior: 'reload',
    subtle: true
  },
  {
    id: 'enabledModels',
    owner: 'pi',
    section: 'scopedModels',
    label: 'Model cycling scope',
    description: 'Enable, disable, and order models used for model cycling.',
    control: 'scopedModels',
    defaultValue: [],
    helper: 'Saved immediately to Pi enabledModels. Unselected models are hidden from the model picker.',
    liveBehavior: 'immediate'
  },
  {
    id: 'enableSkillCommands',
    owner: 'pi',
    section: 'advanced',
    label: 'Skill commands',
    description: 'Register loaded skills as slash commands.',
    control: 'toggle',
    defaultValue: true,
    helper: 'Persisted for Pi; takes effect after reload or a new session.',
    liveBehavior: 'reload',
    subtle: true
  }
] as const satisfies readonly SettingDefinition[];

export function getSettingDefinition(id: string): SettingDefinition | undefined {
  return (settingDefinitions as readonly SettingDefinition[]).find((definition) => definition.id === id);
}

export function getSettingsForSection(section: TaurenSettingsSection): SettingDefinition[] {
  return (settingDefinitions as readonly SettingDefinition[]).filter((definition) => definition.section === section);
}

export function isSettingId(value: unknown): value is SettingId {
  return typeof value === 'string' && Boolean(getSettingDefinition(value));
}

export function isTaurenSettingId(value: unknown): value is TaurenSettingId {
  const definition = typeof value === 'string' ? getSettingDefinition(value) : undefined;
  return definition?.owner === 'tauren';
}

export function isPiSettingId(value: unknown): value is PiSettingId {
  const definition = typeof value === 'string' ? getSettingDefinition(value) : undefined;
  return definition?.owner === 'pi';
}

export function normalizeSettingValue(id: SettingId, value: unknown): SettingValue | undefined {
  const definition = getSettingDefinition(id);

  if (!definition) {
    return undefined;
  }

  if (definition.control === 'toggle') {
    return typeof value === 'boolean' ? value : undefined;
  }

  if (definition.control === 'readonlyList' || definition.control === 'scopedModels') {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
      ? value.map((entry) => entry.trim()).filter(Boolean)
      : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = definition.control === 'text' ? value.trim() : value;

  if (definition.options && !definition.options.some((option) => option.value === trimmed)) {
    return undefined;
  }

  return trimmed;
}
