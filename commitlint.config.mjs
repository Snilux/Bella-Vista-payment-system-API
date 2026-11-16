// Commit message rules. Details and examples in CONTRIBUTING.md.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'build', 'ci', 'chore', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        // Infrastructure and packages
        'api',
        'shared',
        'db',
        'docker',
        'deps',
        'config',
        // Mobile app (3.2 §7): configuration, navigation, session and screens; design system
        'mobile',
        'ui',
        // API domain modules (document 2.1, names per docs/glosario.md)
        'auth',
        'accounts',
        'organization',
        'registry',
        'connections',
        'rates',
        'billing',
        'cashboxes',
        'committee',
        'closings',
        'reports',
        'approvals',
        'audit',
      ],
    ],
    'scope-empty': [1, 'never'],
    'subject-case': [0],
    'subject-max-length': [2, 'always', 72],
    'subject-full-stop': [2, 'never', '.'],
    'body-max-line-length': [1, 'always', 100],
  },
};
