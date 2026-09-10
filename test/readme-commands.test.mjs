import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAMEWORK = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Reads the READMEs a reader is offered, in the order they are offered.
 *
 * @returns pairs of file name and content
 */
function readmes() {
  return ['README.md', 'README.fr.md']
    .filter((name) => existsSync(join(FRAMEWORK, name)))
    .map((name) => [name, readFileSync(join(FRAMEWORK, name), 'utf8')]);
}

/**
 * Returns every script the framework ships, by file name.
 *
 * @returns the set of `<name>.mjs` under scripts/
 */
function shippedScripts() {
  return new Set(readdirSync(join(FRAMEWORK, 'scripts')).filter((name) => name.endsWith('.mjs')));
}

describe('the README hands out commands the framework answers', () => {
  test('every script it names is one the framework ships', () => {
    const shipped = shippedScripts();
    for (const [name, text] of readmes()) {
      const named = new Set([...text.matchAll(/scripts\/([a-z0-9-]+\.mjs)/g)].map((match) => match[1]));
      for (const script of named) {
        assert.ok(shipped.has(script), `${name} names scripts/${script}, which the framework does not ship`);
      }
    }
  });

  test('a dispatch it prints is preceded by the move that dispatch now refuses to do', () => {
    // `dispatch` refuses a phase the orchestrator still holds and names
    // `transition.mjs`. A README that prints the dispatch alone hands the
    // reader a command that stops, which is the defect `next-step` carried
    // until v0.6.1: its own prose said transition-then-dispatch, and it
    // printed only the second half.
    for (const [name, text] of readmes()) {
      const move = text.indexOf('transition.mjs');
      const send = text.indexOf('dispatch.mjs');
      assert.ok(move > -1, `${name} never names transition.mjs, so its dispatch stops on a held phase`);
      assert.ok(send > -1, `${name} names no dispatch at all`);
      assert.ok(move < send, `${name} prints the dispatch before the move it requires`);
    }
  });
});

describe('the README names the gates the core ships', () => {
  test('a gate script in the core is one the README accounts for', () => {
    // Not every script is a gate, so the claim is narrowed to the ones whose
    // absence would mislead: a reader choosing tools for their stack reads
    // this list to know what they do not have to write.
    const gates = ['css-ownership.mjs', 'secrets-scan.mjs', 'duplication.mjs', 'dead-code.mjs', 'doc-lint.mjs', 'sast.mjs'];
    const shipped = shippedScripts();
    const [, english] = readmes()[0];
    for (const gate of gates.filter((name) => shipped.has(name))) {
      const stem = gate.replace('.mjs', '').replaceAll('-', '[ _-]');
      assert.match(english, new RegExp(stem, 'i'), `README.md accounts for no gate matching ${gate}`);
    }
  });
});

describe('the README leads to every guide the framework writes', () => {
  test('a guide nobody links from the README is a guide nobody finds', () => {
    const guides = readdirSync(join(FRAMEWORK, 'docs')).filter((name) => name.endsWith('.md'));
    const [, english] = readmes()[0];
    const orphans = guides.filter((name) => !english.includes(name));
    assert.deepEqual(
      orphans,
      [],
      'these guides exist and the README never points at them: a reader cannot reach what nothing links',
    );
  });
});
