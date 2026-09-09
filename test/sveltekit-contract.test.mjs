import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatible } from '../profile-bundles/sveltekit/verify.mjs';

const observed = {
  node: '22.23.2', manager: 'npm', manager_version: '11.19.0',
  packages: {
    '@sveltejs/kit': '2.70.3', svelte: '5.57.0', vite: '8.2.2', typescript: '6.0.3',
    vitest: '4.1.11', '@playwright/test': '1.63.0', eslint: '10.10.0', prettier: '3.9.6',
    'svelte-check': '4.6.0', '@sveltejs/adapter-node': '5.5.7',
  },
  commands: { check: 'check', lint: 'lint', build: 'build', test_unit: 'unit', test_e2e: 'e2e' },
};

test('official resolved SvelteKit scaffold falls inside the released contract', () => {
  assert.equal(compatible(observed).status, 'compatible');
});

test('SvelteKit contract fails closed outside Node 22 or without a real gate', () => {
  assert.equal(compatible({ ...observed, node: '24.0.0' }).status, 'unsupported');
  assert.match(compatible({ ...observed, commands: { ...observed.commands, test_e2e: null } }).reasons.join('\n'), /test_e2e/);
});
