module.exports = {
    env: {
        'jest/globals': true,
    },
    root: true,
    extends: ['prettier', 'prettier/react'],
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint', 'jest', 'import'],
    rules: {
        'prettier/prettier': 0,
        'import/order': [
            'error',
            {
                groups: ['builtin', 'external', 'internal', ['index', 'sibling', 'parent']],
                'newlines-between': 'always',
                pathGroupsExcludedImportTypes: ['builtin'],
                pathGroups: [
                    {
                        pattern: 'src/**',
                        group: 'internal',
                        position: 'after',
                    },
                ],
                alphabetize: { order: 'asc', caseInsensitive: true },
            },
        ],
    },
};
