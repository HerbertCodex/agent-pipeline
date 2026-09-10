import ts from 'typescript-eslint';

// Dedicated config for the design_limits quality gate.
// Structural rules only; style and type-aware rules stay in eslint.config.js.

export default [
	{
		ignores: [
			'node_modules/**',
			'build/**',
			'.svelte-kit/**',
			'test-results/**',
			'playwright-report/**',
			'agent-pipeline/**', // git submodule — not our code
			'pipeline/**' // pipeline working data, not application code
		]
	},
	{
		files: ['**/*.{js,mjs,cjs,ts}'],
		languageOptions: { parser: ts.parser },
		rules: {
			// Thresholds calibrated above the observed maxima of the reference codebase
			// (measured 2026-09-10): complexity ≤ 2, ≤ 1 param, depth ≤ 2,
			// ≤ 6 lines/function. Re-measure against your own code before tightening
			// or loosening any of them; these are policy, not statistics.
			complexity: ['error', 10],
			'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
			'max-params': ['error', 4],
			'max-depth': ['error', 4],
			'no-restricted-syntax': [
				'error',
				{
					selector:
						'ClassDeclaration[superClass] MethodDefinition > FunctionExpression > BlockStatement > ThrowStatement',
					message:
						'Derived-class methods must not throw unconditionally; handle the error or narrow the throw.'
				},
				{
					selector: "IfStatement > IfStatement.alternate > BinaryExpression[operator='instanceof']",
					message:
						'instanceof chains in else-if branches are forbidden; use polymorphism or a discriminated union.'
				}
			]
		}
	},
	{
		// Test files legitimately contain long arrange/act/assert flows.
		files: ['**/*.test.ts', '**/*.spec.ts', '**/e2e/**'],
		rules: { 'max-lines-per-function': 'off' }
	}
];
