import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'test/fixtures/**', 'app/**', '.angular/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  // Plain Node scripts (script/*.mjs): the Node globals they use.
  { files: ['script/**/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } } },
  {
    // The board's rules are open-backlog's (D1): the server reads, checks, writes and commits
    // through it, never with its own YAML or schema code, or by running git itself (D2).
    files: ['server/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [
        { name: 'yaml', message: 'read and write items through open-backlog' },
        { name: 'ajv', message: 'validate through open-backlog' },
        { name: 'node:child_process', message: 'run git through open-backlog (D2)' },
        { name: 'child_process', message: 'run git through open-backlog (D2)' },
      ] }],
    },
  },
);
