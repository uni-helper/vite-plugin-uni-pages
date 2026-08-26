import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
}, {
  // 由 ts-json-schema-generator 生成，其输出没有末尾换行符
  ignores: ['packages/schema/schema.json'],
}, {
  files: ['test/**/*.ts'],
  rules: {
    'ts/no-require-imports': 'off',
  },
}, {
  files: ['pnpm-workspace.yaml'],
  rules: {
    'pnpm/yaml-enforce-settings': 'off',
  },
})
