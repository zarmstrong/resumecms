import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_ICONS, ACTION_ICON_GROUPS, actionIcon } from './actionIcons.js';
import * as server from '../../../server/src/landingFields.js';
import { LANDING_SCHEMA } from '../../../server/src/mcp/blockSchemas.js';

// A button's icon is stored by name, checked against the server's list and
// drawn from this one, so the two (and the MCP documentation) must agree.

test("the server's icon names match the ones this build draws", () => {
  assert.deepEqual(server.ACTION_ICONS, ACTION_ICONS.map((entry) => entry.value));
  for (const option of LANDING_SCHEMA.properties.actions.items.oneOf) {
    assert.deepEqual(option.properties.icon.enum, server.ACTION_ICONS);
  }
});

test('every icon is a drawable Font Awesome definition in a known group', () => {
  for (const entry of ACTION_ICONS) {
    const [width, height, , , path] = entry.icon.icon;
    assert.ok(width > 0 && height > 0, entry.value);
    assert.equal(typeof path, 'string', entry.value);
    assert.ok(entry.label, entry.value);
    assert.ok(ACTION_ICON_GROUPS.includes(entry.group), entry.value);
  }
  assert.equal(new Set(ACTION_ICONS.map((entry) => entry.value)).size, ACTION_ICONS.length);
  assert.equal(actionIcon('envelope').label, 'Envelope');
  assert.equal(actionIcon('not-an-icon'), null);
  assert.equal(actionIcon(''), null);
});
