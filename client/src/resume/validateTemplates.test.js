import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/validate-templates.mjs over fixture folders: the landing page's
// template kind (issue #93). The script itself is dependency-free and runs
// from the repo root in CI; here it's handed a templates folder of its own.

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/validate-templates.mjs');
const META = { label: 'L', description: 'D', author: 'A' };

function fixture(landing) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-templates-'));
  for (const [id, files] of Object.entries(landing)) {
    fs.mkdirSync(path.join(dir, 'landing', id), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, 'landing', id, name), typeof body === 'string' ? body : JSON.stringify(body));
    }
  }
  return dir;
}

function validate(landing) {
  const dir = fixture(landing);
  try {
    const run = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
    return { ok: run.status === 0, out: run.stdout + run.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const css = (id) => `.l-template-${id} .l-main { max-width: 1px; }`;
const classic = { 'template.json': META, 'style.css': css('classic') };

test('landing templates need template.json and a scoped style.css; index.jsx is optional', () => {
  const ok = validate({
    classic,
    split: { 'template.json': { ...META, columns: true }, 'style.css': css('split'), 'index.jsx': 'export default () => null;' },
  });
  assert.equal(ok.ok, true, ok.out);
  assert.match(ok.out, /2 landing template\(s\)/);

  const cases = [
    [{ classic, other: { 'template.json': META } }, /templates\/landing\/other: missing style\.css/],
    [{ classic, other: { 'template.json': META, 'style.css': '.l-main { color: red; }' } }, /other: style\.css must scope its rules under \.l-template-other/],
    [{ classic, other: { 'style.css': css('other') } }, /other: missing template\.json/],
    [{ classic, other: { 'template.json': { ...META, label: '' }, 'style.css': css('other') } }, /other: "label" must be a non-empty string/],
    [{ classic, other: { 'template.json': { ...META, skillsDisplay: 'pills' }, 'style.css': css('other') } }, /other: unrecognized field "skillsDisplay"/],
    [{ classic, other: { 'template.json': { ...META, columns: 'yes' }, 'style.css': css('other'), 'index.jsx': '' } }, /other: "columns" must be a boolean/],
    [{ classic, other: { 'template.json': { ...META, columns: true }, 'style.css': css('other') } }, /other: "columns" needs an index\.jsx/],
    [{ classic, Other_1: { 'template.json': META, 'style.css': css('Other_1') } }, /folder name "Other_1" must be lowercase kebab-case/],
    [{ split: { 'template.json': META, 'style.css': css('split') } }, /missing "classic"/],
  ];
  for (const [landing, message] of cases) {
    const run = validate(landing);
    assert.equal(run.ok, false, run.out);
    assert.match(run.out, message);
  }
});

test("the repo's own templates pass", () => {
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
