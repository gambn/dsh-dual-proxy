import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nodeAtLeast } from '../src/engines.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const undici = JSON.parse(readFileSync(new URL('../node_modules/undici/package.json', import.meta.url), 'utf8'));

test('package：engines 与 undici 要求一致', () => {
  assert.equal(pkg.engines.node, '>=22.19.0');
});

test('package：npm 包包含 contrib 模板', () => {
  assert.ok(pkg.files.includes('contrib'), 'files 应包含 contrib');
});

test('package：Node 门槛覆盖 undici 的实际要求', () => {
  const minimum = (value) => String(value).replace(/^>=/, '').trim();
  assert.ok(
    nodeAtLeast(minimum(pkg.engines.node), minimum(undici.engines.node)),
    'package engines 必须不低于 undici 的 engines'
  );
});
