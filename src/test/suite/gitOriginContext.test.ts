import * as assert from 'assert';
import { findTraceLinkedGitCommit, type GitCommandRunner } from '../../origin/gitOriginContext';

suite('GitOriginContext', () => {
  test('finds the first trace-linked commit touching traced paths', async () => {
    const calls: string[][] = [];
    const runner: GitCommandRunner = async (args) => {
      calls.push(args);

      if (args[0] === 'rev-parse') {
        return '/repo\n';
      }

      if (args[0] === 'log') {
        assert.ok(args.includes('--reverse'));
        assert.ok(args.includes('--after=2026-01-01T00:00:00.000Z'));
        assert.ok(args.every((arg) => !arg.includes('\0')));
        assert.deepStrictEqual(args.slice(args.indexOf('--') + 1), ['src/old.ts', 'src/current.ts']);
        return [
          'abcdef1234567890',
          'abcdef1',
          '2026-01-01T00:05:00+00:00',
          '2026-01-01T00:04:00+00:00',
          'Explain traced change',
          'Longer rationale from commit body.'
        ].join('\x1f') + '\x1e';
      }

      if (args[0] === 'show') {
        assert.ok(args.includes('--name-only'));
        assert.deepStrictEqual(args.slice(args.indexOf('--') + 1), ['src/old.ts', 'src/current.ts']);
        return 'src/current.ts\n';
      }

      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };

    const commit = await findTraceLinkedGitCommit({
      cwd: '/repo',
      sessionCwd: '/repo',
      historicalPath: 'src/old.ts',
      currentRelativePath: 'src/current.ts',
      after: '2026-01-01T00:00:00.000Z',
      runner
    });

    assert.deepStrictEqual(commit, {
      sha: 'abcdef1234567890',
      shortSha: 'abcdef1',
      subject: 'Explain traced change',
      body: 'Longer rationale from commit body.',
      authorDate: '2026-01-01T00:04:00.000Z',
      commitDate: '2026-01-01T00:05:00.000Z',
      touchedTracedPath: true,
      touchedPaths: ['src/current.ts'],
      relation: 'commit_touches_traced_path',
      confidence: 'high'
    });
    assert.strictEqual(calls.length, 3);
  });

  test('omits git context when no path-touching post-trace commit exists', async () => {
    const runner: GitCommandRunner = async (args) => {
      if (args[0] === 'rev-parse') {
        return '/repo\n';
      }

      if (args[0] === 'log') {
        return '';
      }

      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };

    const commit = await findTraceLinkedGitCommit({
      cwd: '/repo',
      historicalPath: 'src/old.ts',
      currentRelativePath: 'src/current.ts',
      after: '2026-01-01T00:00:00.000Z',
      runner
    });

    assert.strictEqual(commit, undefined);
  });
});
