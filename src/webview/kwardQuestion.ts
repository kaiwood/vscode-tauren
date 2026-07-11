import type { KwardQuestionRequest } from './types';

export type KwardQuestionUiState = {
  requestKey: string;
  stepIndex: number;
  selectedAnswers: string[];
  customAnswers: string[];
};

export type KwardQuestionAnswerMessage = {
  type: 'kwardQuestionAnswer';
  sessionId: string;
  questionRequestId: string;
  answers: KwardQuestionAnswer[];
};

export type KwardQuestionAnswer = {
  question: string;
  answer: string;
};

export type KwardQuestionVerticalFocusTarget =
  | { kind: 'progress' }
  | { kind: 'choice'; choiceIndex: number };

export function createKwardQuestionUiState(request: KwardQuestionRequest): KwardQuestionUiState {
  return {
    requestKey: getKwardQuestionRequestKey(request),
    stepIndex: 0,
    selectedAnswers: request.questions.map((question) => question.options[0]?.label ?? ''),
    customAnswers: request.questions.map(() => '')
  };
}

export function getKwardQuestionAnswerMessage(request: KwardQuestionRequest, uiState: KwardQuestionUiState): KwardQuestionAnswerMessage {
  return {
    type: 'kwardQuestionAnswer',
    sessionId: request.sessionId,
    questionRequestId: request.questionRequestId,
    answers: getKwardQuestionAnswers(request, uiState)
  };
}

export function getKwardQuestionAnswers(request: KwardQuestionRequest, uiState: KwardQuestionUiState): KwardQuestionAnswer[] {
  return request.questions.map((question, index) => ({
    question: question.question,
    answer: getKwardQuestionAnswerForIndex(request, uiState, index)
  }));
}

export function getKwardQuestionAnswerForIndex(request: KwardQuestionRequest, uiState: KwardQuestionUiState, index: number): string {
  return getKwardQuestionCustomAnswerForIndex(uiState, index)
    || getKwardQuestionSelectedAnswerForIndex(request, uiState, index)
    || '';
}

export function getKwardQuestionSelectedAnswerForIndex(request: KwardQuestionRequest, uiState: KwardQuestionUiState, index: number): string {
  return uiState.selectedAnswers[index]
    || request.questions[index]?.options[0]?.label
    || '';
}

export function getKwardQuestionCustomAnswerForIndex(uiState: KwardQuestionUiState, index: number): string {
  return (uiState.customAnswers[index] ?? '').trim();
}

export function getKwardQuestionRequestKey(request: KwardQuestionRequest): string {
  return `${request.sessionId}\u0000${request.questionRequestId}`;
}

export function getKwardQuestionLastStepIndex(request: KwardQuestionRequest): number {
  return request.questions.length;
}

export function getKwardQuestionNextProgressFocusIndex(request: KwardQuestionRequest, currentIndex: number, delta: number): number {
  const stepCount = getKwardQuestionLastStepIndex(request) + 1;
  return moduloIndex(currentIndex, delta, stepCount);
}

function getKwardQuestionChoiceCount(request: KwardQuestionRequest, questionIndex: number): number {
  return (request.questions[questionIndex]?.options.length ?? 0) + 1;
}

export function getKwardQuestionCustomChoiceIndex(request: KwardQuestionRequest, questionIndex: number): number {
  return Math.max(0, getKwardQuestionChoiceCount(request, questionIndex) - 1);
}

export function getKwardQuestionNextChoiceIndex(request: KwardQuestionRequest, questionIndex: number, currentIndex: number, delta: number): number {
  const target = getKwardQuestionNextVerticalFocusTarget(request, questionIndex, currentIndex, delta);
  return target.kind === 'choice' ? target.choiceIndex : currentIndex;
}

export function getKwardQuestionNextVerticalFocusTarget(request: KwardQuestionRequest, questionIndex: number, currentIndex: number, delta: number): KwardQuestionVerticalFocusTarget {
  const choiceCount = getKwardQuestionChoiceCount(request, questionIndex);
  if (choiceCount <= 0) {
    return { kind: 'progress' };
  }

  if (delta < 0 && currentIndex <= 0) {
    return { kind: 'progress' };
  }

  return { kind: 'choice', choiceIndex: moduloIndex(currentIndex, delta, choiceCount) };
}

export function isKwardQuestionSummaryStep(request: KwardQuestionRequest, uiState: KwardQuestionUiState): boolean {
  return uiState.stepIndex >= request.questions.length;
}

export function getKwardQuestionTitle(request: KwardQuestionRequest, uiState: KwardQuestionUiState): string {
  if (request.questions.length === 1) {
    return 'Kward needs your input';
  }

  return isKwardQuestionSummaryStep(request, uiState)
    ? `Kward needs your input · Review (${request.questions.length + 1}/${request.questions.length + 1})`
    : `Kward needs your input · Question ${uiState.stepIndex + 1}/${request.questions.length}`;
}

export function getKwardQuestionAriaLabel(request: KwardQuestionRequest, uiState: KwardQuestionUiState): string {
  return isKwardQuestionSummaryStep(request, uiState)
    ? 'Kward question review'
    : 'Kward question';
}

export function getKwardQuestionRenderSignature(request: KwardQuestionRequest, uiState: KwardQuestionUiState): string {
  return JSON.stringify({
    key: uiState.requestKey,
    questions: request.questions,
    stepIndex: uiState.stepIndex,
    selectedAnswers: uiState.selectedAnswers,
    customAnswers: uiState.customAnswers
  });
}

function moduloIndex(currentIndex: number, delta: number, count: number): number {
  if (count <= 0) {
    return 0;
  }

  return (currentIndex + delta + count) % count;
}
