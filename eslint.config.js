import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      'node_modules/**/*',
      'mobile/**/*',
      'customer-portal/**/*',
      'public/**/*',
      'scripts/**/*',
      'tests/**/*',
    ],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
