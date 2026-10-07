/* ESLint 10 flat config（2026-10 由 .eslintrc.cjs 等价迁移）
 * 规则集与旧配置保持一致：eslint:recommended + prettier 集成 */
const js = require('@eslint/js');
const globals = require('globals');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  {
    ignores: ['node_modules/**', 'logs/**', 'coverage/**', '_bench-start.js', 'src/generated/**']
  },
  js.configs.recommended,
  prettierRecommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'prisma/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'prettier/prettier': 'warn'
    }
  },
  {
    // 配置文件自身运行于 Node CommonJS 环境
    files: ['eslint.config.js'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    // CLI 脚本以 console 作为正常输出通道
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    }
  }
];
