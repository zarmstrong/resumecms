// Editor flows in a real browser (issue #178): what the unit tests can't
// see, React's event wiring, a dialog's focus, the order saves go out in
// when the page is left. One server for the whole file, a fresh browser
// context (so a fresh session) for each flow. Every wait is on the page's
// own state or on a request it makes, never a fixed sleep.
//
// Run with `npm run test:browser` from server/, after `npm run build` in
// client/. A failed flow leaves a screenshot (see saveScreenshot()).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { PASSWORD, REPO_ROOT, USERNAME, launchBrowser, saveScreenshot, startServer } from './harness.js';

let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await server?.stop();
});

// One flow: a fresh context and page, any browser dialog it didn't ask for
// (expectDialog) and any uncaught page error failing it (on the flow's page
// and any other it hands to `watch`), and a screenshot when it fails.
// `ownServer` runs it on a fresh server of its own instead of the shared
// one, for a flow that needs a never-touched install whatever ran before.
function flow(name, fn, { ownServer = false } = {}) {
  test(name, { timeout: 90000 }, async (t) => {
    const shared = server;
    let active = server;
    let context;
    // Everything the flow starts is inside this try, so a failure while
    // setting up (a server that won't start, a browser that's gone) still
    // stops its own server and puts the shared one back.
    try {
      if (ownServer) server = active = await startServer();
      context = await browser.createBrowserContext();
      const page = await newPage(context);
      await runFlow(t, page, context, active, name, fn);
    } finally {
      // Each step whatever the one before did: a browser that's gone makes
      // close() reject, and the flow's own server must still stop.
      try {
        await context?.close();
      } finally {
        try {
          if (active !== shared) await active.stop();
        } finally {
          server = shared;
        }
      }
    }
  });
}

async function runFlow(t, page, context, active, name, fn) {
  const expected = [];
  const unexpected = [];
  page.on('dialog', (dialog) => {
    const handle = expected.shift();
    if (handle) return handle(dialog);
    unexpected.push(`${dialog.type()}: ${dialog.message()}`);
    return dialog.dismiss();
  });
  const errors = [];
  const watch = (other) => other.on('pageerror', (err) => errors.push(err.message));
  watch(page);
  // The next browser dialog is answered with `answer` ('accept' or
  // 'dismiss') as it opens, since the page is stopped until it is (the
  // click that opened it doesn't return before); resolves with what it
  // said.
  const expectDialog = (answer) =>
    new Promise((resolve) =>
      expected.push(async (dialog) => {
        const seen = { type: dialog.type(), message: dialog.message() };
        await dialog[answer]();
        resolve(seen);
      })
    );
  try {
    await fn({ page, context, expectDialog, watch });
    assert.deepEqual(unexpected, [], 'no browser dialog the flow did not expect');
    assert.equal(expected.length, 0, 'every dialog the flow expected opened');
    assert.deepEqual(errors, [], 'no uncaught error on the page');
  } catch (err) {
    t.diagnostic(`screenshot: ${await saveScreenshot(page, name)}`);
    if (errors.length) t.diagnostic(`uncaught page errors: ${JSON.stringify(errors)}`);
    if (unexpected.length) t.diagnostic(`browser dialogs it didn't expect (dismissed): ${JSON.stringify(unexpected)}`);
    t.diagnostic(`server output (tail):\n${active.output().slice(-3000)}`);
    throw err;
  }
}

// A page that reaches only the server under test: the pages' Google Fonts
// would otherwise make the run depend on the network, and a font arriving
// mid-click moves what the click was aimed at.
async function newPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewport({ width: 1400, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    // Either can reject once the page is gone (a reload, the context
    // closing), which is no failure of the flow's.
    if (request.url().startsWith(`${server.baseUrl}/`) || request.url().startsWith('data:')) request.continue().catch(() => {});
    else request.abort('blockedbyclient').catch(() => {});
  });
  return page;
}

// --- helpers ---------------------------------------------------------------

const RESUME_SELECT = 'select[aria-label="Resume"]';
const PRESET_DIALOG = 'dialog.ed-preset-picker';

async function login(page) {
  await page.goto(`${server.baseUrl}/editor`);
  await page.waitForSelector('input[autocomplete="username"]');
  await page.type('input[autocomplete="username"]', USERNAME);
  await page.type('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector(RESUME_SELECT);
}

// A JSON call from the page, with its session cookie.
function api(page, url, init = {}) {
  return page.evaluate(
    async (url, init) => {
      const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    url,
    init
  );
}

async function defaultResumeId(page) {
  const { body } = await api(page, '/api/resumes');
  return body.resumes.find((r) => r.isDefault).id;
}

async function draftBlock(page, resumeId, blockId) {
  const { body } = await api(page, `/api/resumes/${resumeId}/blocks`);
  return body.blocks.find((b) => b.id === blockId);
}

// The draft's summary block, and its row in the block list, opened.
async function openSummary(page, resumeId) {
  const { body } = await api(page, `/api/resumes/${resumeId}/blocks`);
  const block = body.blocks.find((b) => b.type === 'summary');
  assert.ok(block, 'the sample resume has a summary');
  const row = await page.waitForSelector(
    'xpath/.//div[contains(@class, "ed-block-row")][.//span[@class="ed-block-type"][.="Professional Summary"]]'
  );
  await (await row.$('.ed-block-summary')).click();
  const textarea = await row.waitForSelector('textarea');
  return { block, textarea };
}

// Puts `text` in `field` in one go, the way typing does (the native setter
// and an input event, so React's onChange runs): one change, so the one
// save the debounce sends holds all of it, however slow the machine.
async function setText(field, text) {
  await field.evaluate((el, text) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

// Puts `text` in `field` the way typing does (the native setter and an
// input event, so React's onChange runs) and then leaves through `exit` in
// the same task: the editor's save debounce can't fire in between however
// slow the machine, so the save is still waiting when the exit happens.
// `exit` is { click: xpath } or { select: [css, value] }.
async function editThenLeave(field, text, exit) {
  await field.evaluate(
    (el, text, exit) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (exit.click) {
        const button = document.evaluate(exit.click, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        button.click();
      } else {
        const [css, value] = exit.select;
        const select = document.querySelector(css);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
    text,
    exit
  );
}

// Whether a request is a `method` request to `pathname`, and the response
// to the next one. Waited for before the action that sends it, and marked
// handled, so a flow that fails before awaiting it reports its own error
// rather than this wait's timeout.
function isCall(method, pathname) {
  return (request) => request.method() === method && new URL(request.url()).pathname === pathname;
}

function isPut(pathname) {
  return isCall('PUT', pathname);
}

function nextResponse(page, method, pathname, options) {
  const response = page.waitForResponse((r) => isCall(method, pathname)(r.request()), options);
  response.catch(() => {});
  return response;
}

function putResponse(page, pathname) {
  return nextResponse(page, 'PUT', pathname);
}

// What the browser has focused, described well enough to assert on.
function focused(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el?.tagName.toLowerCase(),
      type: el?.getAttribute('type'),
      value: el?.value ?? null,
      checked: el?.checked ?? null,
      label: el?.getAttribute('aria-label'),
      text: el?.textContent.trim(),
      inDialog: Boolean(el?.closest('dialog[open]')),
    };
  });
}

function dialogState(page) {
  return page.evaluate((selector) => {
    const dialog = document.querySelector(selector);
    if (!dialog) return null;
    return {
      open: dialog.open,
      modal: dialog.matches(':modal'),
      title: dialog.querySelector('h2')?.textContent,
      listHidden: dialog.querySelector('fieldset').hidden,
      previewing: Boolean(dialog.querySelector('.ed-preset-preview')),
      submit: dialog.querySelector('button[type="submit"]').textContent,
      radios: [...dialog.querySelectorAll('input[type="radio"]')].map((r) => r.value),
    };
  }, PRESET_DIALOG);
}

function readPreset(id) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, 'templates', 'landing-presets', id, 'template.json'), 'utf8'));
}

// The landing editor, with the dialog it opens by itself on a page never
// saved closed by Skip if it's there (so a flow doesn't depend on another
// having run first).
async function openLandingEditor(page) {
  await page.goto(`${server.baseUrl}/editor?page=landing`);
  const startButton = 'xpath/.//button[normalize-space()="Start from a preset…"]';
  await page.waitForSelector(startButton);
  const { body } = await api(page, '/api/landing');
  if (!body.status.hasDraft) {
    await page.waitForSelector(`${PRESET_DIALOG}[open]`);
    const saved = putResponse(page, '/api/landing');
    await page.click('xpath/.//dialog[@open]//button[normalize-space()="Skip"]');
    assert.equal((await saved).status(), 200);
  }
  return page.waitForSelector(`${startButton}[not(@disabled)]`);
}

// --- flows -----------------------------------------------------------------

flow('logs in through the login form', async ({ page }) => {
  await page.goto(`${server.baseUrl}/editor`);
  await page.waitForSelector('input[autocomplete="username"]');
  assert.equal((await focused(page)).tag, 'input', 'the username field has focus');

  // A wrong password is refused on the form, which stays up.
  await page.type('input[autocomplete="username"]', USERNAME);
  await page.type('input[autocomplete="current-password"]', 'not-the-password');
  await page.click('button[type="submit"]');
  const error = await page.waitForSelector('.ed-login-error');
  assert.match(await error.evaluate((el) => el.textContent), /incorrect username or password/i);
  assert.equal((await api(page, '/api/auth/status')).body.authenticated, false);

  await page.$eval('input[autocomplete="current-password"]', (el) => el.select());
  await page.type('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector(RESUME_SELECT);
  await page.waitForSelector('.ed-block-row');
  assert.equal((await api(page, '/api/auth/status')).body.authenticated, true);
});

flow('edits a block, publishes it, and the public page shows it', async ({ page, context, watch }) => {
  await login(page);
  const resumeId = await defaultResumeId(page);
  const { block, textarea } = await openSummary(page, resumeId);
  const text = `Published from the browser suite, ${Date.now()}.`;

  const saved = putResponse(page, `/api/resumes/${resumeId}/blocks/${block.id}`);
  await setText(textarea, text);
  assert.equal((await saved).status(), 200);
  assert.equal((await draftBlock(page, resumeId, block.id)).data.text, text);

  // The public page still shows the published text until the publish.
  const visitor = await context.browser().createBrowserContext();
  try {
    const publicPage = await newPage(visitor);
    watch(publicPage);
    await publicPage.goto(`${server.baseUrl}/`);
    await publicPage.waitForFunction((old) => document.body.innerText.includes(old), {}, block.data.text);

    // The edit shows as unpublished first, so the "Published …" waited for
    // below is the publish's, not the line already on screen.
    await page.waitForFunction(() => /^Unpublished changes/.test(document.querySelector('.ed-topbar-status')?.textContent));
    // Up to the server's own wait for the PDF, and some.
    const published = nextResponse(page, 'POST', `/api/resumes/${resumeId}/publish`, { timeout: 40000 });
    await page.click('xpath/.//header//button[normalize-space()="Publish"]');
    assert.equal((await published).status(), 200);
    await page.waitForFunction(() => /^Published /.test(document.querySelector('.ed-topbar-status')?.textContent));

    await publicPage.reload();
    await publicPage.waitForFunction((t) => document.body.innerText.includes(t), {}, text);
    assert.equal(await publicPage.evaluate((old) => document.body.innerText.includes(old), block.data.text), false);
  } finally {
    await visitor.close();
  }
});

// Publish sends every save still on its debounce first (the server
// snapshots the stored draft), so a setting ticked just before Publish is
// in what's published: here, the PDF's page numbers.
flow('publishing right after a site setting changes publishes it', async ({ page }) => {
  await login(page);
  const resumeId = await defaultResumeId(page);
  const order = [];
  page.on('request', (request) => {
    if (isPut(`/api/resumes/${resumeId}/site`)(request)) order.push('site');
    if (isCall('POST', `/api/resumes/${resumeId}/publish`)(request)) order.push('publish');
  });
  await page.click('xpath/.//button[.//span[normalize-space()="Site Settings & Colors"]]');
  const checkbox = 'xpath/.//label[.//span[normalize-space()="Page numbers in the PDF"]]//input[@type="checkbox"]';
  await page.click(checkbox);
  // Up to the server's own wait for the PDF, and some.
  const published = nextResponse(page, 'POST', `/api/resumes/${resumeId}/publish`, { timeout: 40000 });
  await page.click('xpath/.//header//button[normalize-space()="Publish"]');
  assert.equal((await published).status(), 200);
  assert.deepEqual(order, ['site', 'publish']);
  assert.equal((await api(page, '/api/public/resume?mode=print')).body.site.pdfPageNumbers, true);
  await page.waitForFunction(() => /^Published /.test(document.querySelector('.ed-topbar-status')?.textContent));
});

flow('applies a resume preset by keyboard, and a reload keeps it', async ({ page }) => {
  await login(page);
  const resumeId = await defaultResumeId(page);
  const sitePath = `/api/resumes/${resumeId}/site`;
  const writes = [];
  page.on('request', (request) => {
    if (isPut(sitePath)(request)) writes.push(JSON.parse(request.postData()));
  });
  await page.click('xpath/.//button[.//span[normalize-space()="Site Settings & Colors"]]');
  await page.click('xpath/.//button[normalize-space()="Change template…"]');
  const picker = '[role="dialog"][aria-labelledby="ed-template-picker-title"]';
  const modes = `${picker} .ed-template-picker-modes`;
  const radios = `${picker} [role="radiogroup"][aria-label="Presets"] [role="radio"]`;
  const useButton = `${picker} .ed-modal-actions .ed-btn-primary`;

  // Default mode is unchanged. Reach Presets by Tab from Header & layout,
  // then Tab into the unselected list, whose first option is a tab stop.
  const headerMode = await page.waitForSelector(`${modes} button:first-child`);
  assert.equal(await headerMode.evaluate((el) => el.getAttribute('aria-pressed')), 'true');
  await headerMode.focus();
  await page.keyboard.press('Tab');
  assert.equal((await focused(page)).text, 'Presets');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval(useButton, (el) => el.textContent.trim()), 'Use this preset');
  assert.equal(await page.$eval(useButton, (el) => el.disabled), true);
  assert.equal(await page.$$eval(radios, (els) => els.some((el) => el.getAttribute('aria-checked') === 'true')), false);
  await page.keyboard.press('Tab');
  assert.equal(await page.$eval(`${radios}:first-child`, (el) => el === document.activeElement), true);
  assert.equal(await page.$eval(`${radios}:first-child`, (el) => el.getAttribute('aria-checked')), 'false');
  assert.equal(await page.$eval(useButton, (el) => el.disabled), true, 'focus alone does not select a preset');

  const labels = await page.$$eval(`${radios} .ed-template-picker-option-label`, (els) => els.map((el) => el.textContent));
  const target = labels.indexOf('Law & finance');
  assert.ok(target > 0, 'Law & finance follows the first option');
  for (let index = 0; index < target; index += 1) await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.querySelector('.ed-template-picker-option-label')?.textContent), 'Law & finance');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-checked')), 'true');
  assert.equal(await page.$eval(useButton, (el) => el.disabled), false);
  await page.waitForSelector(`${picker} .ed-template-picker-preview .r-layout-small-caps`);
  assert.deepEqual(writes, [], 'browsing has saved nothing');

  const saved = putResponse(page, sitePath);
  await page.click(useButton);
  assert.equal((await saved).status(), 200);
  await page.waitForFunction(() => document.querySelector('.ed-topbar-status')?.textContent.trim() === 'Saved', { polling: 'mutation' });
  assert.equal(writes.length, 1, 'applying sends one site save');
  await page.reload();
  await page.waitForSelector(RESUME_SELECT);
  const { body } = await api(page, sitePath);
  assert.equal(body.site.template, 'double-rule');
  assert.equal(body.site.layout, 'small-caps');
  assert.equal(body.site.font, 'eb-garamond');
  assert.equal(body.site.colors.accent, '#1e3a5f');
});

flow('resume picker switches previews, cancels changes, and selects the first preset with Space or Enter', async ({ page }) => {
  await login(page);
  const resumeId = await defaultResumeId(page);
  const sitePath = `/api/resumes/${resumeId}/site`;
  const before = (await api(page, sitePath)).body.site;
  const writes = [];
  page.on('request', (request) => {
    if (isPut(sitePath)(request)) writes.push(request);
  });
  await page.click('xpath/.//button[.//span[normalize-space()="Site Settings & Colors"]]');
  const openPicker = 'xpath/.//button[normalize-space()="Change template…"]';
  const picker = '[role="dialog"][aria-labelledby="ed-template-picker-title"]';
  const mode = `${picker} .ed-template-picker-modes button`;
  const firstPreset = `${picker} [role="radiogroup"][aria-label="Presets"] [role="radio"]:first-child`;
  const useButton = `${picker} .ed-modal-actions .ed-btn-primary`;
  for (const key of ['Space', 'Enter']) {
    await page.click(openPicker);
    await page.click(`${mode}:last-child`);
    assert.equal(await page.$eval(useButton, (el) => el.disabled), true, 'each opening starts without a preset');
    await page.keyboard.press('Tab');
    await page.keyboard.press(key);
    assert.equal(await page.$eval(firstPreset, (el) => el.getAttribute('aria-checked')), 'true');
    assert.equal(await page.$eval(useButton, (el) => el.disabled), false);
    await page.click(`${mode}:first-child`);
    const headers = `${picker} [role="radiogroup"][aria-label="Header style"] [role="radio"]`;
    const layouts = `${picker} [role="radiogroup"][aria-label="Body layout"] [role="radio"]`;
    assert.equal(await page.$$eval(headers, (els) => els.filter((el) => el.tabIndex === 0).length), 1);
    assert.equal(await page.$$eval(layouts, (els) => els.filter((el) => el.tabIndex === 0).length), 1);
    await page.waitForSelector(`${picker} .ed-template-picker-preview .r-layout-${before.layout || 'classic'}`);
    assert.equal(await page.$eval(useButton, (el) => el.textContent.trim()), 'Use this template');
    await (await page.$(`${headers}[aria-checked="true"]`)).focus();
    await page.keyboard.press('ArrowDown');
    await page.click(`${mode}:last-child`);
    if (key === 'Space') await page.click(`${picker} .ed-modal-actions .ed-btn-ghost`);
    else await page.keyboard.press('Escape');
    await page.waitForSelector(picker, { hidden: true });
  }
  assert.deepEqual(writes, [], 'Cancel and Escape never save the browsed appearance');
  assert.deepEqual((await api(page, sitePath)).body.site, before);
});

// On a server of its own, so the landing page has never been saved (and
// the dialog opens by itself) whichever flows ran before or are skipped.
flow(
  "the preset dialog's keyboard: arrows, preview, Escape and focus",
  async ({ page }) => presetDialogFlow(page),
  { ownServer: true }
);

async function presetDialogFlow(page) {
  await login(page);
  const { body: landing } = await api(page, '/api/landing');
  assert.equal(landing.status.hasDraft, false, 'a fresh install has no landing draft');

  await page.goto(`${server.baseUrl}/editor?page=landing`);
  await page.waitForSelector(`${PRESET_DIALOG}[open]`);
  let state = await dialogState(page);
  assert.equal(state.modal, true, 'opened with showModal(), so the editor behind it is inert');
  assert.equal(state.title, 'How should your landing page start?');
  assert.equal(state.radios[0], ':keep');
  assert.ok(state.radios.length > 2, 'the presets are listed');
  const [keep, firstPreset, secondPreset] = state.radios;

  // Focus starts on the first option, the arrows move it and the choice.
  let now = await focused(page);
  assert.deepEqual([now.type, now.value, now.checked], ['radio', keep, true]);
  assert.equal(state.submit, 'Keep it');
  await page.keyboard.press('ArrowDown');
  now = await focused(page);
  assert.deepEqual([now.type, now.value, now.checked], ['radio', firstPreset, true]);
  assert.equal((await dialogState(page)).submit, 'Use this preset');
  await page.keyboard.press('ArrowRight');
  assert.equal((await focused(page)).value, secondPreset);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  now = await focused(page);
  assert.deepEqual([now.value, now.checked], [keep, true]);
  assert.equal((await dialogState(page)).submit, 'Keep it');

  // Tab leaves the radio group for that card's Preview, and goes on
  // through the dialog, never to the editor behind it.
  await page.keyboard.press('Tab');
  now = await focused(page);
  assert.equal(now.label, 'Preview Keep the starting page');
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    assert.equal((await focused(page)).inDialog, true, `focus is still in the dialog after ${i + 2} Tabs`);
  }

  // A preview by keyboard: Enter opens it with focus on Back, Escape goes
  // back to the list (the dialog stays open) with focus on its Preview.
  const preview = await page.$(`${PRESET_DIALOG} button[aria-label="Preview Keep the starting page"]`);
  await preview.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${PRESET_DIALOG} .ed-preset-preview`);
  now = await focused(page);
  assert.equal(now.text, '← Back to presets');
  assert.equal((await dialogState(page)).listHidden, true);
  await page.keyboard.press('Escape');
  await page.waitForSelector(`${PRESET_DIALOG} .ed-preset-preview`, { hidden: true });
  state = await dialogState(page);
  assert.deepEqual([state?.open, state?.listHidden], [true, false], 'Escape went back to the list, and the dialog is still open');
  assert.equal((await focused(page)).label, 'Preview Keep the starting page');

  // Escape on the list closes it; the dialog that opened by itself keeps
  // the starting page, so it's saved and not offered again.
  const saved = putResponse(page, '/api/landing');
  await page.keyboard.press('Escape');
  await page.waitForSelector(PRESET_DIALOG, { hidden: true });
  assert.equal((await saved).status(), 200);
  assert.equal((await api(page, '/api/landing')).body.status.hasDraft, true);

  // Opened from its button: focus on the first preset, and Escape gives
  // focus back to the button.
  const startButton = await page.waitForSelector('xpath/.//button[normalize-space()="Start from a preset…"][not(@disabled)]');
  await startButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${PRESET_DIALOG}[open]`);
  state = await dialogState(page);
  assert.equal(state.title, 'Start from a preset');
  assert.equal(state.radios[0], firstPreset);
  now = await focused(page);
  assert.deepEqual([now.type, now.value, now.checked], ['radio', firstPreset, true]);
  await page.keyboard.press('Escape');
  await page.waitForSelector(PRESET_DIALOG, { hidden: true });
  now = await focused(page);
  assert.equal(now.text, 'Start from a preset…', 'focus is back on the button that opened it');
}

flow('applies a preset, and a reload keeps it', async ({ page, expectDialog }) => {
  await login(page);
  const startButton = await openLandingEditor(page);
  const { body: landingBefore } = await api(page, '/api/landing');

  await startButton.click();
  await page.waitForSelector(`${PRESET_DIALOG}[open]`);
  // A preset that changes the template, so the change shows.
  const preset = (await dialogState(page)).radios.filter((id) => id !== ':keep').map(readPreset).find((p) => p.template !== landingBefore.landing.template);
  assert.ok(preset, 'a preset with another template');
  await page.click(`${PRESET_DIALOG} input[type="radio"][value="${preset.id}"]`);

  // Applying a preset from its button asks first; it's accepted.
  const question = expectDialog('accept');
  const saved = putResponse(page, '/api/landing');
  await page.click(`${PRESET_DIALOG} button[type="submit"]`);
  const confirm = await question;
  assert.equal(confirm.type, 'confirm');
  assert.ok(confirm.message.includes(`“${preset.label}” preset`), confirm.message);
  const response = await saved;
  assert.equal(response.status(), 200);
  assert.equal(JSON.parse(response.request().postData()).template, preset.template);
  // The response's headers aren't the end of the save: the page still holds
  // it (and its beforeunload prompt) until the body is read and the queue
  // settles, which is when it says "Saved". Reloading sooner could be asked
  // about, and the prompt dismissed.
  await page.waitForFunction(() => document.querySelector('.ed-topbar-status')?.textContent.trim() === 'Saved', {
    polling: 'mutation',
  });

  await page.reload();
  await page.waitForSelector(`.ed-preview-frame .l-template-${preset.template}`);
  assert.equal(await page.$(PRESET_DIALOG), null, "the dialog doesn't open again by itself");
  const { body: landingAfter } = await api(page, '/api/landing');
  assert.equal(landingAfter.landing.template, preset.template);
  assert.deepEqual(landingAfter.landing.style, { ...landingAfter.landing.style, ...preset.style }, "the preset's style");
  assert.deepEqual(
    landingAfter.landing.sections.slice(0, preset.sections.length).map((s) => s.kind),
    preset.sections.map((s) => s.kind),
    "the preset's sections come first"
  );
});

// The save waiting on its debounce when the page is left by one of its
// own exits: the leave guard flushes it first. The edit and the exit
// happen in one page task (editThenLeave), so the debounce can't have sent
// it; the order of requests afterwards shows the flush sent it before the
// page moved on (or the session ended).
flow('leaving through the switcher with a save pending keeps the edit', async ({ page }) => {
  await login(page);
  const resumeId = await defaultResumeId(page);
  const { block, textarea } = await openSummary(page, resumeId);
  const putPath = `/api/resumes/${resumeId}/blocks/${block.id}`;
  const order = [];
  page.on('request', (request) => {
    if (isPut(putPath)(request)) order.push('save sent');
    if (isCall('GET', '/api/landing')(request)) order.push('landing editor loads');
  });
  page.on('response', (response) => isPut(putPath)(response.request()) && order.push('saved'));
  const saved = putResponse(page, putPath);

  const text = `Saved on the way out, ${Date.now()}.`;
  assert.deepEqual(order, [], 'nothing saved before the edit');
  await editThenLeave(textarea, text, { select: [RESUME_SELECT, 'landing'] });

  assert.equal((await saved).status(), 200);
  await page.waitForFunction(() => new URLSearchParams(location.search).get('page') === 'landing');
  await page.waitForSelector('xpath/.//button[normalize-space()="Start from a preset…"]');
  // Flushed before the switch, not just sent as the resume's page went.
  assert.deepEqual(order, ['save sent', 'saved', 'landing editor loads']);
  assert.equal((await draftBlock(page, resumeId, block.id)).data.text, text);
});

flow('logging out with a save pending saves it before the session ends', async ({ page }) => {
  await login(page);
  const resumeId = await defaultResumeId(page);
  const { block, textarea } = await openSummary(page, resumeId);
  const putPath = `/api/resumes/${resumeId}/blocks/${block.id}`;
  const order = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (isPut(putPath)(request)) order.push('save');
    if (request.method() === 'POST' && pathname === '/api/auth/logout') order.push('logout');
  });
  const saved = putResponse(page, putPath);

  const text = `Saved before logging out, ${Date.now()}.`;
  assert.deepEqual(order, [], 'nothing saved before the edit');
  await editThenLeave(textarea, text, { click: '//header//button[normalize-space()="Log out"]' });

  assert.equal((await saved).status(), 200, 'saved while still logged in');
  await page.waitForSelector('input[autocomplete="username"]');
  assert.deepEqual(order, ['save', 'logout']);
  assert.equal((await api(page, '/api/auth/status')).body.authenticated, false);

  await login(page);
  assert.equal((await draftBlock(page, resumeId, block.id)).data.text, text);
});

flow('adds a credential, warns on expiry, and preserves its data after reload', async ({ page }) => {
  await login(page);
  const resumeId = await defaultResumeId(page);
  const created = nextResponse(page, 'POST', `/api/resumes/${resumeId}/blocks`);
  await page.click('xpath/.//button[normalize-space()="+ Credential"]');
  const response = await created;
  assert.equal(response.status(), 201);
  const { block } = await response.json();
  assert.equal(block.type, 'credentials');
  const row = await page.waitForSelector('xpath/.//div[contains(@class, "ed-block-row")][.//span[@class="ed-block-type"][.="Credential"]]');
  await (await row.$('.ed-block-summary')).click();
  const name = await row.waitForSelector('xpath/.//label[span[.="Name"]]/input');
  const expires = await row.waitForSelector('xpath/.//label[span[.="Expires"]]/input');
  const text = `Browser credential ${Date.now()}`;
  await setText(name, text);
  // Wait specifically for the save containing both edits: the name's
  // debounce could have fired before setting the expiry on a busy runner.
  const saved = page.waitForResponse((r) => {
    if (!isPut(`/api/resumes/${resumeId}/blocks/${block.id}`)(r.request())) return false;
    const data = JSON.parse(r.request().postData()).data;
    return data.name === text && data.expires === 'Jan 2000';
  });
  saved.catch(() => {});
  await setText(expires, 'Jan 2000');
  // normalize-space(.) rather than text(): React writes the date as its
  // own text node, so no single text node holds the whole sentence.
  await row.waitForSelector('xpath/.//div[contains(@class, "ed-field-hint")][normalize-space(.)="This expired on Jan 2000. It\'s still shown; update the date or hide this block."]');
  await page.waitForFunction((name) => [...document.querySelectorAll('.r-credential .r-experience-title')].some((el) => el.textContent === name), {}, text);
  assert.equal((await saved).status(), 200);
  // The response's headers aren't the end of the save: the page still holds
  // it (and its beforeunload prompt) until the body is read and the queue
  // settles. Then the status leaves "Saving…" for "Saved", which lasts only
  // 1.2 s before the idle text, so wait for anything but "Saving…".
  await page.waitForFunction(
    () => {
      const status = document.querySelector('.ed-topbar-status')?.textContent.trim();
      return Boolean(status) && !status.startsWith('Saving');
    },
    { polling: 'mutation' }
  );
  await page.reload();
  await page.waitForSelector(RESUME_SELECT);
  const stored = await draftBlock(page, resumeId, block.id);
  assert.deepEqual(stored.data, { kind: 'certification', name: text, issuer: '', number: '', issued: '', expires: 'Jan 2000', url: '' });
  await page.waitForFunction((name) => [...document.querySelectorAll('.r-credential .r-experience-title')].some((el) => el.textContent === name), {}, text);
});

flow('adds a languages block and preserves its entries after reload', async ({ page }) => {
  await login(page);
  const resumeId = await defaultResumeId(page);
  const created = nextResponse(page, 'POST', `/api/resumes/${resumeId}/blocks`);
  await page.click('xpath/.//button[normalize-space()="+ Languages"]');
  const response = await created;
  assert.equal(response.status(), 201);
  const { block } = await response.json();
  assert.equal(block.type, 'languages');
  const row = await page.waitForSelector('xpath/.//div[contains(@class, "ed-block-row")][.//span[@class="ed-block-type"][.="Languages"]]');
  await (await row.$('.ed-block-summary')).click();
  const language1 = await row.waitForSelector('input[aria-label="Language 1"]');
  const level1 = await row.waitForSelector('input[aria-label="Level 1"]');
  const text = `Lang ${Date.now()}`;
  await setText(language1, text);
  await setText(level1, 'Fluent');
  await (await row.waitForSelector('xpath/.//button[normalize-space()="+ Add language"]')).click();
  const language2 = await row.waitForSelector('input[aria-label="Language 2"]');
  // Wait specifically for the save holding both entries: an earlier save of
  // the first entry alone must not count.
  const expected = [
    { language: text, level: 'Fluent' },
    { language: 'Spanish', level: '' },
  ];
  const saved = page.waitForResponse((r) => {
    if (!isPut(`/api/resumes/${resumeId}/blocks/${block.id}`)(r.request())) return false;
    const data = JSON.parse(r.request().postData()).data;
    return JSON.stringify(data.entries) === JSON.stringify(expected);
  });
  saved.catch(() => {});
  await setText(language2, 'Spanish');
  await page.waitForFunction(
    (texts) => {
      const items = [...document.querySelectorAll('.r-languages .r-language')].map((el) => el.textContent);
      return texts.every((t) => items.includes(t));
    },
    {},
    [`${text} – Fluent`, 'Spanish']
  );
  assert.equal((await saved).status(), 200);
  // The status leaves "Saving…" only once the queue settles; wait for that
  // before reloading, as the credential flow does.
  await page.waitForFunction(
    () => {
      const status = document.querySelector('.ed-topbar-status')?.textContent.trim();
      return Boolean(status) && !status.startsWith('Saving');
    },
    { polling: 'mutation' }
  );
  await page.reload();
  await page.waitForSelector(RESUME_SELECT);
  const stored = await draftBlock(page, resumeId, block.id);
  assert.deepEqual(stored.data, { entries: expected });
});
