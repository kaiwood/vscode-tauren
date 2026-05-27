import type { AgentToolResult, MessageRenderer, Theme, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { renderComponentContent } from '../extensionUi/renderContent';
import { taurenTheme } from '../extensionUi/customUiHost';
import type { PiEvent, PiRenderedContent } from '../pi/types';

const defaultRenderWidth = 100;

type ToolRenderContext = Parameters<NonNullable<ToolDefinition['renderResult']>>[3];
type MessageRendererInput = Parameters<MessageRenderer>[0];

type RenderableRuntime = {
  cwd: string;
  session: {
    extensionRunner: {
      getToolDefinition(toolName: string): ToolDefinition | undefined;
      getMessageRenderer(customType: string): MessageRenderer | undefined;
    };
  };
};

type ToolRenderState = {
  state: Record<string, unknown>;
  args?: unknown;
  callComponent?: unknown;
  resultComponent?: unknown;
};

export class PiSdkRenderer {
  private readonly toolStates = new Map<string, ToolRenderState>();

  public constructor(private readonly getToolsExpanded: () => boolean) {}

  public enrichEvent(runtime: RenderableRuntime, event: PiEvent): PiEvent {
    if (isToolExecutionEvent(event)) {
      const rendered = this.renderToolEvent(runtime, event);

      if (event.type === 'tool_execution_end') {
        this.deleteToolState(event);
      }

      return rendered ? { ...event, taurenRenderedTool: rendered } : event;
    }

    if ((event.type === 'message_start' || event.type === 'message_end') && isRecord(event.message)) {
      const rendered = this.renderCustomMessage(runtime, event.message);

      if (rendered) {
        return {
          ...event,
          message: {
            ...event.message,
            taurenRenderedMessage: rendered
          }
        };
      }
    }

    return event;
  }

  public renderCustomMessage(runtime: RenderableRuntime, message: Record<string, unknown>): PiRenderedContent | undefined {
    const customType = getRecordString(message, 'customType');

    if (!customType) {
      return undefined;
    }

    const renderer = runtime.session.extensionRunner.getMessageRenderer(customType);

    if (!renderer) {
      return undefined;
    }

    const render = (expanded: boolean): string | undefined => {
      const component = safeRender(() => renderer(message as unknown as MessageRendererInput, { expanded }, taurenTheme as Theme));
      return component ? renderComponentText(component) : undefined;
    };
    const collapsed = render(false);
    const expanded = render(true);

    return renderedContent(collapsed, expanded);
  }

  private renderToolEvent(runtime: RenderableRuntime, event: PiEvent): PiRenderedContent | undefined {
    const toolName = getRecordString(event, 'toolName');

    if (!toolName) {
      return undefined;
    }

    const definition = runtime.session.extensionRunner.getToolDefinition(toolName);

    if (!definition) {
      return undefined;
    }

    const toolCallId = getToolCallId(event, toolName);
    const state = this.getToolState(toolCallId);

    if ('args' in event) {
      state.args = event.args;
    }

    if (event.type === 'tool_execution_start' && definition.renderCall) {
      return this.renderToolCall(definition, state, toolCallId, runtime.cwd);
    }

    if ((event.type === 'tool_execution_update' || event.type === 'tool_execution_end') && definition.renderResult) {
      const result = event.type === 'tool_execution_update' ? event.partialResult : event.result;
      return this.renderToolResult(definition, result, state, toolCallId, runtime.cwd, {
        isPartial: event.type === 'tool_execution_update',
        isError: event.type === 'tool_execution_end' && event.isError === true
      });
    }

    return undefined;
  }

  private renderToolCall(
    definition: ToolDefinition,
    state: ToolRenderState,
    toolCallId: string,
    cwd: string
  ): PiRenderedContent | undefined {
    const component = safeRender(() => definition.renderCall?.(
      state.args as never,
      taurenTheme as Theme,
      this.createRenderContext(toolCallId, state, state.callComponent, cwd, {
        expanded: this.getToolsExpanded(),
        isPartial: false,
        isError: false
      })
    ));

    if (!component) {
      return undefined;
    }

    state.callComponent = component;
    const body = renderComponentText(component);
    return body ? { body, code: true } : undefined;
  }

  private renderToolResult(
    definition: ToolDefinition,
    result: unknown,
    state: ToolRenderState,
    toolCallId: string,
    cwd: string,
    options: { isPartial: boolean; isError: boolean }
  ): PiRenderedContent | undefined {
    const toolResult = normalizeToolResult(result, options.isError);
    const render = (expanded: boolean): string | undefined => {
      const component = safeRender(() => definition.renderResult?.(
        toolResult as never,
        { expanded, isPartial: options.isPartial },
        taurenTheme as Theme,
        this.createRenderContext(toolCallId, state, state.resultComponent, cwd, {
          expanded,
          isPartial: options.isPartial,
          isError: options.isError
        })
      ));

      if (!component) {
        return undefined;
      }

      state.resultComponent = component;
      return renderComponentText(component);
    };
    const collapsed = render(false);
    const expanded = render(true);

    return renderedContent(collapsed, expanded);
  }

  private createRenderContext(
    toolCallId: string,
    state: ToolRenderState,
    lastComponent: unknown,
    cwd: string,
    options: { expanded: boolean; isPartial: boolean; isError: boolean }
  ): ToolRenderContext {
    return {
      args: state.args as never,
      toolCallId,
      invalidate: () => undefined,
      lastComponent: lastComponent as never,
      state: state.state,
      cwd,
      executionStarted: true,
      argsComplete: true,
      isPartial: options.isPartial,
      expanded: options.expanded,
      showImages: false,
      isError: options.isError
    } as ToolRenderContext;
  }

  private getToolState(toolCallId: string): ToolRenderState {
    let state = this.toolStates.get(toolCallId);

    if (!state) {
      state = { state: {} };
      this.toolStates.set(toolCallId, state);
    }

    return state;
  }

  private deleteToolState(event: PiEvent): void {
    const toolName = getRecordString(event, 'toolName') ?? 'tool';
    this.toolStates.delete(getToolCallId(event, toolName));
  }
}

function isToolExecutionEvent(event: PiEvent): boolean {
  return event.type === 'tool_execution_start'
    || event.type === 'tool_execution_update'
    || event.type === 'tool_execution_end';
}

function getToolCallId(event: PiEvent, toolName: string): string {
  return getRecordString(event, 'toolCallId') ?? `${toolName}:current`;
}

function normalizeToolResult(value: unknown, _isError: boolean): AgentToolResult<unknown> {
  if (isRecord(value) && Array.isArray(value.content)) {
    return {
      content: value.content as AgentToolResult<unknown>['content'],
      details: value.details
    };
  }

  return {
    content: typeof value === 'string'
      ? [{ type: 'text', text: value }]
      : [{ type: 'text', text: value === undefined ? '' : formatJson(value) }],
    details: undefined
  };
}

function renderedContent(collapsed: string | undefined, expanded: string | undefined): PiRenderedContent | undefined {
  const body = collapsed || expanded;

  if (!body) {
    return undefined;
  }

  return {
    body,
    ...(expanded && expanded !== body ? { expandedBody: expanded } : {}),
    code: true
  };
}

function renderComponentText(component: unknown): string | undefined {
  const lines = trimBlankLines(renderComponentContent(component, defaultRenderWidth).lines);
  const text = stripAnsiBackgroundStyles(lines.join('\n'));
  return text.trim() ? text : undefined;
}

function stripAnsiBackgroundStyles(value: string): string {
  return value.replace(/\x1b\[([0-?]*)([ -/]*)?m/g, (sequence, parameters: string, intermediates: string | undefined) => {
    if (intermediates) {
      return sequence;
    }

    const rewritten = stripAnsiBackgroundParameters(parameters);
    return rewritten.length > 0 ? `\x1b[${rewritten.join(';')}m` : '';
  });
}

function stripAnsiBackgroundParameters(parameters: string): number[] {
  const codes = parseAnsiCodes(parameters);
  const next: number[] = [];

  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];

    if (code === 7 || code === 27 || code === 49 || isBasicAnsiBackground(code) || isBrightAnsiBackground(code)) {
      continue;
    }

    if (code === 48 && codes[index + 1] === 5) {
      index += 2;
      continue;
    }

    if (code === 48 && codes[index + 1] === 2) {
      index += 4;
      continue;
    }

    next.push(code);
  }

  return next;
}

function parseAnsiCodes(parameters: string): number[] {
  if (!parameters || parameters === '?') {
    return [0];
  }

  return parameters
    .split(';')
    .map((part) => part === '' ? 0 : Number(part))
    .filter((part) => Number.isInteger(part));
}

function isBasicAnsiBackground(code: number): boolean {
  return code >= 40 && code <= 47;
}

function isBrightAnsiBackground(code: number): boolean {
  return code >= 100 && code <= 107;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.trim() === '') {
    start += 1;
  }

  while (end > start && lines[end - 1]?.trim() === '') {
    end -= 1;
  }

  return lines.slice(start, end);
}

function safeRender<T>(render: () => T): T | undefined {
  try {
    return render();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
