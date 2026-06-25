module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
  ],
  rules: {
    // 死代码：未使用的变量报错
    'no-unused-vars': 'off', // 关掉 base，用 ts 版
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // `||`→`??`：防止 0 被覆盖
    // 注意：此规则需要 type-aware linting（设置 parserOptions.project），当前 monorepo 无单一 tsconfig
    // 覆盖全部 src/，开启前请先创建 root tsconfig.json 或分项目配置
    '@typescript-eslint/prefer-nullish-coalescing': 'off',

    // any 不允许
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'off', // 先关掉，太严
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  ignorePatterns: ['node_modules/', 'dist/', '*.js', '*.mjs', '*.cjs', 'src/webui/vite.config.ts', 'src/agents/lib/node_modules/'],
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      parser: '@typescript-eslint/parser',
    },
  ],
};
