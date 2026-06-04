import * as assert from 'assert';
import {
  createKwardQuestionUiState,
  getKwardQuestionAnswerMessage,
  getKwardQuestionAnswers,
  getKwardQuestionCustomChoiceIndex,
  getKwardQuestionNextChoiceIndex,
  getKwardQuestionNextProgressFocusIndex,
  getKwardQuestionNextVerticalFocusTarget,
  getKwardQuestionSelectedAnswerForIndex,
  isKwardQuestionSummaryStep,
  type KwardQuestionUiState
} from '../../webview/kwardQuestion';
import type { KwardQuestionRequest } from '../../webview/types';

suite('Kward question answer collection', () => {
  test('selected radio answers arrive in Kward answer payload', () => {
    const request = questionRequest([{ question: 'Which fix?', answers: ['A', 'B'] }]);
    const uiState = createKwardQuestionUiState(request);
    uiState.selectedAnswers[0] = 'B';

    assert.deepStrictEqual(getKwardQuestionAnswers(request, uiState), [
      { question: 'Which fix?', answer: 'B' }
    ]);
  });

  test('custom text answers arrive in Kward answer payload', () => {
    const request = questionRequest([{ question: 'Which fix?', answers: ['A', 'B'] }]);
    const uiState = createKwardQuestionUiState(request);
    uiState.selectedAnswers[0] = 'A';
    uiState.customAnswers[0] = 'Use the safer migration';

    assert.deepStrictEqual(getKwardQuestionAnswers(request, uiState), [
      { question: 'Which fix?', answer: 'Use the safer migration' }
    ]);
  });

  test('multi-question answers arrive in the correct order', () => {
    const request = questionRequest([
      { question: 'First?', answers: ['A1', 'B1'] },
      { question: 'Second?', answers: ['A2', 'B2'] },
      { question: 'Third?', answers: ['A3', 'B3'] }
    ]);
    const uiState = createKwardQuestionUiState(request);
    uiState.selectedAnswers = ['B1', 'A2', 'B3'];
    uiState.customAnswers = ['', 'Custom second', ''];

    assert.deepStrictEqual(getKwardQuestionAnswers(request, uiState), [
      { question: 'First?', answer: 'B1' },
      { question: 'Second?', answer: 'Custom second' },
      { question: 'Third?', answer: 'B3' }
    ]);
  });


  test('up and down navigation includes the tab row and custom input', () => {
    const request = questionRequest([{ question: 'Which fix?', answers: ['A', 'B'] }]);

    assert.deepStrictEqual(getKwardQuestionNextVerticalFocusTarget(request, 0, 0, -1), { kind: 'progress' });
    assert.deepStrictEqual(getKwardQuestionNextVerticalFocusTarget(request, 0, 0, 1), { kind: 'choice', choiceIndex: 1 });
    assert.deepStrictEqual(getKwardQuestionNextVerticalFocusTarget(request, 0, 1, 1), { kind: 'choice', choiceIndex: getKwardQuestionCustomChoiceIndex(request, 0) });
    assert.deepStrictEqual(getKwardQuestionNextVerticalFocusTarget(request, 0, getKwardQuestionCustomChoiceIndex(request, 0), 1), { kind: 'choice', choiceIndex: 0 });
    assert.strictEqual(getKwardQuestionNextChoiceIndex(request, 0, 1, 1), getKwardQuestionCustomChoiceIndex(request, 0));
  });

  test('left and right navigation moves focus across numbered tabs and review', () => {
    const request = questionRequest([
      { question: 'First?', answers: ['A1', 'B1'] },
      { question: 'Second?', answers: ['A2', 'B2'] }
    ]);

    assert.strictEqual(getKwardQuestionNextProgressFocusIndex(request, 0, 1), 1);
    assert.strictEqual(getKwardQuestionNextProgressFocusIndex(request, 1, 1), 2);
    assert.strictEqual(getKwardQuestionNextProgressFocusIndex(request, 2, 1), 0);
    assert.strictEqual(getKwardQuestionNextProgressFocusIndex(request, 0, -1), 2);
  });

  test('review send builds the exact webview message sent to Kward', () => {
    const request = questionRequest([
      { question: 'First?', answers: ['A1', 'B1'] },
      { question: 'Second?', answers: ['A2', 'B2'] }
    ]);
    const uiState = createKwardQuestionUiState(request);
    uiState.stepIndex = request.questions.length;
    uiState.selectedAnswers = ['B1', 'A2'];
    uiState.customAnswers = ['', 'Typed answer'];

    assert.strictEqual(isKwardQuestionSummaryStep(request, uiState), true);
    assert.deepStrictEqual(getKwardQuestionAnswerMessage(request, uiState), {
      type: 'kwardQuestionAnswer',
      sessionId: 'session-1',
      questionRequestId: 'question-1',
      answers: [
        { question: 'First?', answer: 'B1' },
        { question: 'Second?', answer: 'Typed answer' }
      ]
    });
  });

  test('review still displays selected answer when custom text overrides submitted answer', () => {
    const request = questionRequest([{ question: 'Proceed?', answers: ['Yes', 'No'] }]);
    const uiState: KwardQuestionUiState = createKwardQuestionUiState(request);
    uiState.selectedAnswers[0] = 'No';
    uiState.customAnswers[0] = 'Not until tests pass';

    assert.strictEqual(getKwardQuestionSelectedAnswerForIndex(request, uiState, 0), 'No');
    assert.deepStrictEqual(getKwardQuestionAnswers(request, uiState), [
      { question: 'Proceed?', answer: 'Not until tests pass' }
    ]);
  });
});

function questionRequest(questions: Array<{ question: string; answers: string[] }>): KwardQuestionRequest {
  return {
    sessionId: 'session-1',
    questionRequestId: 'question-1',
    questions: questions.map((question, index) => ({
      question: question.question,
      header: `Q${index + 1}`,
      options: question.answers.map((answer) => ({ label: answer, description: `${answer} description` }))
    }))
  };
}
