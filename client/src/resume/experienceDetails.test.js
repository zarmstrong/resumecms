import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERIENCE_DETAIL_FIELDS, EXPERIENCE_DETAIL_KEYS, contactAnswer, experienceDetails, experienceDetailsLine, hasExperienceDetails,
} from './experienceDetails.js';
import { EXPERIENCE_DETAIL_KEYS as SERVER_KEYS } from '../../../server/src/experienceDetails.js';

test('details come out in field order with their labels', () => {
  const data = {
    contactSupervisor: 'no',
    supervisor: 'Jane Doe, (555) 555-0100',
    salary: '$85,000 per year',
    grade: 'GS-0343-11',
    hoursPerWeek: '40',
  };
  assert.deepEqual(experienceDetails(data), [
    { key: 'hoursPerWeek', label: 'Hours per week', value: '40' },
    { key: 'grade', label: 'Series and grade', value: 'GS-0343-11' },
    { key: 'salary', label: 'Salary', value: '$85,000 per year' },
    { key: 'supervisor', label: 'Supervisor', value: 'Jane Doe, (555) 555-0100' },
    { key: 'contactSupervisor', label: 'May contact supervisor', value: 'No' },
  ]);
  assert.deepEqual(EXPERIENCE_DETAIL_FIELDS.map((field) => field.key), EXPERIENCE_DETAIL_KEYS);
});

test('values are trimmed and blanks, whitespace and non-strings are dropped', () => {
  assert.deepEqual(experienceDetails({ hoursPerWeek: '  40  ', grade: '   ', salary: '', supervisor: 40, contactSupervisor: null }), [
    { key: 'hoursPerWeek', label: 'Hours per week', value: '40' },
  ]);
});

test('contactSupervisor shows only as Yes or No', () => {
  assert.equal(experienceDetails({ contactSupervisor: 'yes' })[0].value, 'Yes');
  assert.equal(experienceDetails({ contactSupervisor: 'YES ' })[0].value, 'Yes');
  assert.equal(experienceDetails({ contactSupervisor: 'no' })[0].value, 'No');
  assert.deepEqual(experienceDetails({ contactSupervisor: 'maybe' }), []);
  assert.deepEqual(experienceDetails({ contactSupervisor: '' }), []);
});

test('a contactSupervisor naming an inherited object key is not an answer', () => {
  // blockData.js takes any string, and a lookup in a plain object would
  // answer these with an object or a function, which React can't draw.
  for (const raw of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__']) {
    assert.deepEqual(experienceDetails({ contactSupervisor: raw }), [], raw);
    assert.equal(contactAnswer(raw), '', raw);
  }
  for (const detail of experienceDetails({ hoursPerWeek: '__proto__', contactSupervisor: 'yes' })) {
    assert.equal(typeof detail.value, 'string');
  }
});

test('contactAnswer reads a stored answer as the editor and the line both show it', () => {
  assert.equal(contactAnswer('yes'), 'yes');
  assert.equal(contactAnswer(' No '), 'no');
  assert.equal(contactAnswer('maybe'), '');
  assert.equal(contactAnswer(''), '');
  assert.equal(contactAnswer(undefined), '');
  assert.equal(contactAnswer(true), '');
});

test('the line follows each surface\'s flag, a missing one meaning shown', () => {
  const data = { hoursPerWeek: '40', supervisor: 'Jane Doe' };
  const details = experienceDetails(data);
  const none = { details: [], dimmed: false, printHidden: false };
  const shown = { details, dimmed: false, printHidden: false };

  for (const mode of ['web', 'print', 'preview']) {
    assert.deepEqual(experienceDetailsLine(data, mode), shown, mode);
    assert.deepEqual(experienceDetailsLine({ ...data, detailsVisibleWeb: true, detailsVisiblePrint: true }, mode), shown, mode);
    // Only `false` hides: null and a non-boolean read as shown, as in publicBlocks.js.
    assert.deepEqual(experienceDetailsLine({ ...data, detailsVisibleWeb: null, detailsVisiblePrint: 0 }, mode), shown, mode);
    assert.deepEqual(experienceDetailsLine({ detailsVisibleWeb: false }, mode), none, mode);
    assert.deepEqual(experienceDetailsLine(undefined, mode), none, mode);
  }
  assert.deepEqual(experienceDetailsLine(data), shown, 'web is the default mode');

  const webOnly = { ...data, detailsVisiblePrint: false };
  assert.deepEqual(experienceDetailsLine(webOnly, 'web'), { details, dimmed: false, printHidden: true });
  assert.deepEqual(experienceDetailsLine(webOnly, 'print'), none);
  assert.deepEqual(experienceDetailsLine(webOnly, 'preview'), { details, dimmed: true, printHidden: false });

  const printOnly = { ...data, detailsVisibleWeb: false };
  assert.deepEqual(experienceDetailsLine(printOnly, 'web'), none);
  assert.deepEqual(experienceDetailsLine(printOnly, 'print'), shown);
  assert.deepEqual(experienceDetailsLine(printOnly, 'preview'), { details, dimmed: true, printHidden: false });

  const neither = { ...data, detailsVisibleWeb: false, detailsVisiblePrint: false };
  assert.deepEqual(experienceDetailsLine(neither, 'web'), none);
  assert.deepEqual(experienceDetailsLine(neither, 'print'), none);
  assert.deepEqual(experienceDetailsLine(neither, 'preview'), { details, dimmed: true, printHidden: false });
});

test('missing data gives no details', () => {
  assert.deepEqual(experienceDetails(undefined), []);
  assert.deepEqual(experienceDetails(null), []);
  assert.deepEqual(experienceDetails({}), []);
});

test('hasExperienceDetails reports whether anything is filled in', () => {
  assert.equal(hasExperienceDetails({}), false);
  assert.equal(hasExperienceDetails({ salary: '  ', contactSupervisor: 'maybe' }), false);
  assert.equal(hasExperienceDetails({ salary: '$1' }), true);
  assert.equal(hasExperienceDetails({ contactSupervisor: 'no' }), true);
});

test('client keys match the server list', () => {
  assert.deepEqual(EXPERIENCE_DETAIL_KEYS, SERVER_KEYS);
});
