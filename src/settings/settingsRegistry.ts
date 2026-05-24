export type TauSettingId =
  | 'tau.outputColors'
  | 'tau.animationsEnabled'
  | 'tau.showWelcome'
  | 'tau.customUiTheme'
  | 'tau.blockHttpsImages'
  | 'tau.confirmSessionDeletion'
  | 'tau.rejectEditWriteOutsideWorkspace'
  | 'tau.readyScript'
  | 'tau.readyScriptEnabled';

export type PiSettingId =
  | 'defaultProvider'
  | 'defaultModel'
  | 'defaultThinkingLevel'
  | 'compaction.enabled'
  | 'retry.enabled'
  | 'steeringMode'
  | 'followUpMode'
  | 'transport'
  | 'images.blockImages'
  | 'images.autoResize'
  | 'enabledModels'
  | 'enableSkillCommands';

export type TauSettingsSection = 'appearance' | 'login' | 'runtime' | 'workspaceSafety' | 'advanced';
export type SettingsOwner = 'tau' | 'pi';
export type SettingControl = 'toggle' | 'select' | 'text' | 'readonlyList';
export type SettingValue = boolean | string | string[];
export type SettingId = TauSettingId | PiSettingId;

export type SettingOption = {
  value: string;
  label: string;
};

export type SettingDefinition = {
  id: SettingId;
  owner: SettingsOwner;
  section: TauSettingsSection;
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

export const deliveryModeOptions = [
  { value: 'one-at-a-time', label: 'One at a time' },
  { value: 'all', label: 'All queued' }
] as const satisfies readonly SettingOption[];

export const transportOptions = [
  { value: 'sse', label: 'SSE' },
  { value: 'websocket', label: 'WebSocket' },
  { value: 'auto', label: 'Auto' }
] as const satisfies readonly SettingOption[];

export const customUiThemeOptions = [
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
    eyebrow: 'Pi auth',
    title: 'Login',
    description: 'Configure built-in Pi provider authentication. Credentials are stored in Pi auth.json.'
  },
  {
    id: 'appearance',
    label: 'Appearance',
    eyebrow: 'Tau host',
    title: 'Appearance',
    description: 'Tau-owned presentation controls for the sidebar and Pi extension UI.'
  },
  {
    id: 'runtime',
    label: 'Runtime',
    eyebrow: 'Pi engine',
    title: 'Runtime',
    description: 'Pi engine defaults and runtime behavior. Pi remains the source of truth.'
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
    description: 'Less common controls shown plainly, without turning Tau into a settings dump.'
  }
] as const;

export const settingDefinitions = [
  {
    id: 'tau.outputColors',
    owner: 'tau',
    section: 'appearance',
    label: 'Output colors',
    description: 'Render ANSI and syntax colors in Tau output.',
    control: 'toggle',
    defaultValue: true,
    liveBehavior: 'immediate'
  },
  {
    id: 'tau.animationsEnabled',
    owner: 'tau',
    section: 'appearance',
    label: 'Animations',
    description: 'Use subtle surface and counter animations.',
    control: 'toggle',
    defaultValue: true,
    helper: 'Reduced-motion preferences still disable motion.',
    liveBehavior: 'immediate'
  },
  {
    id: 'tau.showWelcome',
    owner: 'tau',
    section: 'appearance',
    label: 'Welcome message',
    description: 'Show the Welcome to Tau empty state for new chats.',
    control: 'toggle',
    defaultValue: true,
    liveBehavior: 'immediate'
  },
  {
    id: 'tau.customUiTheme',
    owner: 'tau',
    section: 'appearance',
    label: 'Custom UI theme',
    description: 'Theme for Pi extension custom UI terminal panels.',
    control: 'select',
    options: customUiThemeOptions,
    defaultValue: 'default',
    liveBehavior: 'immediate'
  },
  {
    id: 'tau.blockHttpsImages',
    owner: 'tau',
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
    id: 'tau.confirmSessionDeletion',
    owner: 'tau',
    section: 'workspaceSafety',
    label: 'Confirm deletion',
    description: 'Ask before moving Tau sessions to Trash.',
    control: 'toggle',
    defaultValue: true,
    liveBehavior: 'immediate',
    danger: true
  },
  {
    id: 'tau.rejectEditWriteOutsideWorkspace',
    owner: 'tau',
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
    id: 'tau.readyScript',
    owner: 'tau',
    section: 'advanced',
    label: 'Ready script',
    description: 'Executable script Tau runs when Pi becomes ready.',
    control: 'text',
    defaultValue: '',
    helper: 'Relative paths resolve from the workspace folder.',
    liveBehavior: 'immediate',
    subtle: true
  },
  {
    id: 'tau.readyScriptEnabled',
    owner: 'tau',
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
    section: 'advanced',
    label: 'Enabled models',
    description: 'Model patterns Pi uses for model cycling.',
    control: 'readonlyList',
    defaultValue: [],
    helper: 'Read-only in Tau for now to avoid saving malformed model patterns.',
    liveBehavior: 'reload',
    readOnly: true,
    subtle: true
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

export function getSettingsForSection(section: TauSettingsSection): SettingDefinition[] {
  return (settingDefinitions as readonly SettingDefinition[]).filter((definition) => definition.section === section);
}

export function isSettingId(value: unknown): value is SettingId {
  return typeof value === 'string' && Boolean(getSettingDefinition(value));
}

export function isTauSettingId(value: unknown): value is TauSettingId {
  const definition = typeof value === 'string' ? getSettingDefinition(value) : undefined;
  return definition?.owner === 'tau';
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

  if (definition.control === 'readonlyList') {
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
