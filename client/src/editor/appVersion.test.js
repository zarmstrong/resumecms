import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// AppVersion.jsx shows client/package.json's version. release-please bumps
// it with the manifest (release-please-config.json's extra-files); this
// fails if the two ever drift, so the editor never shows a stale release.
const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

test("the editor's version is the released one", () => {
  const released = read('../../../.release-please-manifest.json')['.'];
  assert.equal(read('../../package.json').version, released);
  assert.equal(read('../../../server/package.json').version, released);
});
