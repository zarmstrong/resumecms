import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { REWRITABLE_TYPES } from './rewritableFields.js';
import {
  AI_TENSES,
  PICKED_TENSES,
  PICKED_TENSE_TYPES,
  TENSE_TYPES,
  pickedTenseError,
  resolveTense,
  roleTense,
} from './tense.js';

test('a date that is not over yet is a planned end date', () => {
  const now = new Date(2026, 10, 3); // 3 Nov 2026
  const notOver = [
    'Dec 2026', 'December 2026', 'Dez 2026', 'déc. 2026', '12/2026', '2026-12', '2026-12-31', '2026-11-30', '31/12/2026',
    '12/31/2026', '12/01/2026', '2027', 'Jun 2027', "'27", "Mar '27", 'Jan 2020 – Jun 2027',
    // The current year or month isn't over until it ends.
    '2026', 'Nov 2026', '11/2026', '2026-11', "'26", '2026-11-03',
    // Nor is yesterday: the person's date can be a day behind the server's.
    '2026-11-02',
    // A spaced dash is a range, so only the year is read: "Mar – 2026" could
    // be "March through 2026".
    'Mar – 2026', 'Jan - 2026', 'Aug – 2026',
  ];
  for (const end of notOver) assert.equal(roleTense({ endDate: end }, now), null, end);
  const past = ['Oct 2026', '2025', '10/2026', '2026-10-31', '2026-11-01', 'Mar-2026', 'Mar – 2025', '01/02/2026', "'25", "'99", "'40"];
  for (const end of past) assert.equal(roleTense({ endDate: end }, now), 'past', end);
});

test('a month or year counts as over a day after it ends', () => {
  const at = (y, m, d) => new Date(y, m - 1, d, 12);
  assert.equal(roleTense({ endDate: 'Nov 2026' }, at(2026, 12, 1)), null);
  assert.equal(roleTense({ endDate: 'Nov 2026' }, at(2026, 12, 2)), 'past');
  assert.equal(roleTense({ endDate: '2026' }, at(2027, 1, 1)), null);
  assert.equal(roleTense({ endDate: '2026' }, at(2027, 1, 2)), 'past');
  assert.equal(roleTense({ endDate: '2026-12-31' }, at(2027, 1, 1)), null);
  assert.equal(roleTense({ endDate: '2026-12-31' }, at(2027, 1, 2)), 'past');
});

test('no end date under the cap backtracks badly', () => {
  // Runs in a child process with a timeout: an exponential regex blocks the
  // thread it runs on, so in-process it would hang the suite, not fail it.
  const script = `
    const { roleTense } = await import(${JSON.stringify(new URL('./tense.js', import.meta.url).href)});
    // mulberry32: 32-bit arithmetic, so the sequence doesn't degrade the way
    // a float LCG does. Seeded, so a failure reproduces.
    let seed = 51;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
    const pick = (list) => list[Math.floor(random() * list.length)];
    const gaps = ['', ' ', '  ', '   ', ',', ', ', ' , ', '·', ' · ', '-', ' - ', '–', ' – ', '(', ' (', ')', '!', '.'];
    const words = ['1mo', '2 yrs', '3mos', 'contract', 'remote', 'full time', 'part-time', 'day', 'role', 'x'];
    const heads = ['Present', 'Current', 'Now', 'Mar 2024 to Present', 'Jan 2022 till date', '2024-present', '2019 – 2021', 'Dec 2023 –', 'Mar 2024', '03/2024'];
    // Shaped like the regexes' own paths (a head, then gaps and note words)
    // so the random cases reach the repetitions, plus fully random noise.
    const inputs = [];
    for (let i = 0; i < 4000; i++) {
      let end = i % 4 === 3 ? '' : pick(heads);
      while (end.length < 100) end += pick(gaps) + (random() < 0.8 ? pick(words) : pick(heads));
      inputs.push(end.slice(0, 100));
    }
    // Known bad shapes: about a second each on the old regex, so a regression
    // fails clearly but still finishes well inside the timeout.
    inputs.push('Present (' + '1mo  '.repeat(16) + 'x', 'Present' + ' , 1mo'.repeat(16) + 'x', 'Present' + '  '.repeat(40) + 'x');
    const time = (end) => {
      const started = performance.now();
      roleTense({ endDate: end });
      return performance.now() - started;
    };
    let slowest = { ms: 0, end: '' };
    for (const end of inputs) {
      const ms = time(end);
      if (ms > slowest.ms) slowest = { ms, end };
    }
    // Re-time the slowest so a GC pause or a busy machine isn't a failure.
    slowest.ms = Math.min(slowest.ms, time(slowest.end), time(slowest.end));
    console.log(JSON.stringify(slowest));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(run.error?.code, undefined, 'timed out: a regex in roleTense backtracks exponentially');
  assert.equal(run.status, 0, run.stderr);
  const slowest = JSON.parse(run.stdout);
  // Each call takes microseconds. The known-bad inputs take ~800 ms on the old
  // exponential regex, so 200 ms leaves room for a busy CI runner.
  assert.ok(slowest.ms < 200, `${slowest.ms.toFixed(1)} ms for ${JSON.stringify(slowest.end)}`);
});

test('a very long end date is not parsed, and one under the cap parses quickly', () => {
  // Worst cases for the range split and the current-word tail, just under the
  // cap. Each run takes microseconds; the bound only catches backtracking.
  const started = Date.now();
  for (const end of [
    `2024${' '.repeat(94)}x`, ` -${' '.repeat(48)}`.repeat(2).slice(0, 99), ' -'.repeat(49), `Present${' ·'.repeat(46)}`,
    `2024${'-'.repeat(95)}`, `Present (${'('.repeat(90)}`, `${'1/'.repeat(48)}2024`,
  ]) {
    assert.ok(end.length <= 100);
    roleTense({ endDate: end });
  }
  assert.ok(Date.now() - started < 1000);
  assert.equal(roleTense({ endDate: `${' '.repeat(300_000)}x` }), null);
  assert.equal(roleTense({ endDate: `2024${' '.repeat(300_000)}x` }), null);
  assert.equal(roleTense({ endDate: `2024${' -'.repeat(100_000)}` }), null);
  assert.equal(roleTense({ endDate: `${'2024 '.repeat(30)}` }), null);
});

test('tense types are rewritable types, and no type is in both lists', () => {
  for (const type of [...TENSE_TYPES, ...PICKED_TENSE_TYPES]) assert.ok(REWRITABLE_TYPES.has(type), type);
  for (const type of TENSE_TYPES) assert.ok(!PICKED_TENSE_TYPES.has(type), type);
});

test('byRole reads a current role from words like Current, a finished one from a date', () => {
  const byRole = (endDate) => resolveTense('byRole', 'experience', { endDate });
  const current = [
    'Current', 'present', ' PRESENT ', 'Present.', 'Present day', 'Present-day', 'now', 'Now!', 'Ongoing', 'to date',
    'Till date', 'Til date', 'To present', 'Up to present', 'Until now', 'As of today', 'Today', 'Current role',
    'Current (contract)', 'Currently employed', 'Presently', 'Actuel', 'Heute', 'Actualidad', 'Atual', "aujourd'hui",
    'aujourd’hui',
    // Ranges typed into End date: only the end of the range counts.
    'Dec 2023 - Present', '2024-present', 'Jan 2024 – present', 'Mar 2022 — Current', 'Jan 2021 – Present day',
    'Mar 2022 – Current role', 'Dec 2023 – Present (contract)', 'Jan 2022 – Present · 2 yrs 3 mos', 'Jan 2022 to Present',
    'Jan 2020 till date', 'Mar 2021 to date', '2020 up to present', 'Jan 2021 as of today', 'Dec 2023 ‑ Present',
    'Dec 2023 − Present', 'Dec 2023 ‒ Present', '2023- Present', '2023 -Present', 'Sep 2023 -Present',
    'Jan 2022 bis heute', '2020 à ce jour', '2021 hasta la actualidad', '2019 fino ad oggi', '2018 até hoje',
    'Present, full time', 'Current (part-time, 3 months)', 'Present (contract)', 'Present · 2 yrs', 'Present.',
    'Present (2 yrs 3 mos)', 'Present (2 yrs, 3 mos)', 'Present (contract · remote)',
  ];
  for (const end of current) assert.equal(byRole(end), 'present', end);
  const finished = [
    '2024', 'Mar 2024', 'Dec 2019', 'December 2019', 'Sept. 2019', '03/2024', "'19", '2019-06-30', '2019-06',
    '2019 – 2021', '2019-2021', '03/2020-03/2024', 'Jan 2020 to Dec 2023', '2019 to 2021',
    'Dez 2019', 'März 2019', 'déc. 2019', 'Dic 2019', 'Marzo 2019', "Mar '19", '’19', 'Mar-2024', 'Jul/2024',
    '2024/03', '31.12.2019', 'Mar 2024.', '2024.', 'Nov - 2025', 'Jan 2020 to Dec 2023.', 'Ma\u0308rz 2019',
    'Jan 2020 – Mar – 2025', 'Jan 2020 - Mar - 2025', 'Dec. – 2019',
  ];
  for (const end of finished) assert.equal(byRole(end), 'past', end);
  // Blank means the date is missing, not that the role is current; and
  // anything but a plain date or a current word is left alone rather than
  // guessed, even with a date or a current word somewhere in it.
  const unknown = [
    undefined, '', '  ', null, 'Nowhere', 'Presentation', 'TBD', 'Spring', 'Not current', 'No longer current',
    'Actual end TBD', 'Still unsure', 'Now defunct', 'Mar 2024 now at Acme', '2022 today a consultant',
    '2021 (was current contractor)', 'Dec 2019, still in touch', 'Current2020', 'Contract, 3 months', 'Q4 TBD',
    '2023 (contract renewed through 2030)', '２０２４', 'Q4 2019', 'Present 2024', 'Current 2024', 'Since 2021',
    'From 2021', 'Joined 2021', 'Spring 2024', 'Marketing 2019', 'Now (left in 2022)', 'Present, ended 2021',
    'Current (not anymore)', '2021-Q4', ' '.repeat(100_000) + 'x', "Present (left '22)", 'Present, no longer',
    'Present (departed)', '2024-13-45', '13/2024', '32/13/2024', 'ſep 2024', 'Present, resigned', 'Present - retired',
    'Current (laid off)', 'Present, terminated', 'Present – 2021', 'Current - Dec 2019', '2026-02-31', '31/11/2020',
    '02/30/2020', '0000', '1000', 'Present, 4000 employees', 'Current (part-time since 3 months)',
    'Present (contract', 'Present, contract)', '1899', 'Present...',
    // Note words need a space or delimiter between them.
    'Present (contractremote)', 'Present (2 yrs3 mos)',
    // An open range is as likely half-typed as ongoing.
    'Dec 2023 –', 'Dec 2023 - ',
  ];
  for (const end of unknown) assert.equal(byRole(end), null, JSON.stringify(end));
  assert.equal(resolveTense('byRole', 'experience', undefined), null);
});

test('resolveTense: the setting applies to experience entries only', () => {
  assert.equal(resolveTense('auto', 'experience', {}), null);
  assert.equal(resolveTense(undefined, 'experience', {}), null);
  assert.equal(resolveTense('past', 'experience', { endDate: 'Current' }), 'past');
  assert.equal(resolveTense('present', 'experience', { endDate: '2020' }), 'present');
  assert.equal(resolveTense('byRole', 'experience', { endDate: 'Current' }), 'present');
  assert.equal(resolveTense('byRole', 'experience', { endDate: '2024' }), 'past');
  assert.equal(resolveTense('byRole', 'experience', { endDate: '' }), null);
  assert.equal(resolveTense('byRole', 'experience', { endDate: 'Spring' }), null);
  // Summaries describe who the person is now; headings and skills rows are
  // labels and lists. None get a tense, whatever the setting.
  for (const type of ['summary', 'heading', 'skills_group']) {
    for (const tense of ['auto', 'past', 'present', 'byRole']) {
      assert.equal(resolveTense(tense, type, { endDate: 'Current' }), null, `${type} ${tense}`);
    }
  }
});

test('resolveTense: custom blocks use the tense picked for the rewrite, defaulting from the setting', () => {
  // No pick (an older client, or a request made outside the editor): the
  // setting's fixed tense, and none for auto or byRole.
  assert.equal(resolveTense('past', 'custom', {}), 'past');
  assert.equal(resolveTense('present', 'custom', {}), 'present');
  assert.equal(resolveTense('auto', 'custom', {}), null);
  assert.equal(resolveTense('byRole', 'custom', { endDate: 'Current' }), null);
  // A pick always wins over the setting.
  assert.equal(resolveTense('past', 'custom', {}, 'present'), 'present');
  assert.equal(resolveTense('past', 'custom', {}, 'auto'), null);
  assert.equal(resolveTense('auto', 'custom', {}, 'past'), 'past');
  assert.equal(resolveTense('byRole', 'custom', {}, 'present'), 'present');
});

test('pickedTenseError checks the value and the block type', () => {
  for (const ok of [undefined, 'auto', 'past', 'present']) assert.equal(pickedTenseError(ok, 'custom'), null);
  for (const bad of [null, '', 'future', 'byRole', 5, 'toString']) {
    assert.match(pickedTenseError(bad, 'custom'), /tense must be one of auto, past, present/, String(bad));
  }
  assert.match(pickedTenseError('past', 'experience'), /can't be chosen for experience blocks/);
  assert.equal(pickedTenseError(undefined, 'experience'), null);
});

test('the tense options are frozen, since the picker shares the setting\'s entries', () => {
  assert.ok(Object.isFrozen(AI_TENSES) && Object.isFrozen(PICKED_TENSES));
  for (const { label } of [...Object.values(AI_TENSES), ...Object.values(PICKED_TENSES)]) assert.equal(typeof label, 'string');
  assert.ok(Object.values(AI_TENSES).every(Object.isFrozen));
  assert.ok(Object.values(PICKED_TENSES).every(Object.isFrozen));
});

test('past and present picks share the setting\'s labels', () => {
  assert.equal(PICKED_TENSES.past.label, AI_TENSES.past.label);
  assert.equal(PICKED_TENSES.present.label, AI_TENSES.present.label);
});
