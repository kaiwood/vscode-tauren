export type ReasoningEffortOption = { value: string; label: string };

const defaultOptions: ReasoningEffortOption[] = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X High' }
];

const openAiOptions: ReasoningEffortOption[] = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' }
];

const openAiMaxOptions = [...openAiOptions, { value: 'max', label: 'Max' }];
const reasoningOptions = openAiOptions.slice(1);
const gpt6Options = [...reasoningOptions, { value: 'max', label: 'Max' }];

export function getReasoningEffortOptions(provider: string, modelId: string): ReasoningEffortOption[] {
  const providerName = provider.trim().toLowerCase();
  const id = modelId.toLowerCase().replace(/^openai\//, '');

  if (providerName === 'codex' || providerName === 'openrouter') {
    if (/^gpt-5\.[23]-codex/.test(id)) return reasoningOptions;
    if (/^gpt-5\.6(?:$|-)/.test(id)) return openAiMaxOptions;
    if (/^gpt-6-luna(?:$|-)/.test(id)) return openAiMaxOptions;
    if (/^gpt-6\.1-sol(?:$|-)|^gpt-6-astra(?:$|-)/.test(id)) return gpt6Options;
    return openAiOptions;
  }

  if (providerName === 'openai') {
    return /^gpt-6(?:\.1)?-(?:astra|sol)(?:$|-)/.test(id) ? gpt6Options : defaultOptions;
  }

  if (providerName === 'copilot' && /^gpt-(?:5|6)(?:\.|-|$)/.test(id)) {
    return /^gpt-5\.[23]-codex/.test(id) ? reasoningOptions : openAiOptions;
  }

  if (providerName === 'anthropic') {
    if (/^claude-(?:fable|mythos|opus|sonnet)-5(?:$|-)|^claude-opus-4-(?:7|8)(?:$|-)/.test(id)) {
      return [...reasoningOptions, { value: 'max', label: 'Max' }];
    }
    if (/^claude-(?:opus-4-6|sonnet-4-6)(?:$|-)/.test(id)) return [...reasoningOptions.slice(0, 3), { value: 'max', label: 'Max' }];
    if (/^claude-opus-4-5(?:$|-)/.test(id)) return reasoningOptions.slice(0, 3);
  }

  return defaultOptions;
}
