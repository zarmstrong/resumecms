import test from 'node:test';
import assert from 'node:assert/strict';
import { textParagraphs, resolveLanding } from './resolveLanding.js';
import * as server from '../../../server/src/landingFields.js';
import { splitItems } from '../resume/skillItems.js';

const draft = {
  headline: 'Jo',
  subheadline: 'Engineer',
  photo: 'resume',
  photoUrl: '',
  sections: [
    { id: 'intro', kind: 'text', title: '', body: 'Hi' },
    { id: 'empty', kind: 'text', title: 'About', body: ' ' },
    {
      id: 'links',
      kind: 'links',
      title: 'Elsewhere',
      links: [
        { type: 'github', label: '', url: 'https://github.com/jo' },
        { type: 'phone', label: '+1 555 555 0100', url: 'tel:+15555550100' },
        { label: 'half typed', url: '' },
        { label: 'bad', url: 'java\tscript:alert(1)' },
      ],
    },
    {
      id: 'projects',
      kind: 'items',
      title: 'Projects',
      items: [
        { title: 'Tool', text: '', url: 'java\tscript:alert(1)' },
        { title: ' ', text: '', url: 'https://x.example' },
      ],
    },
    { id: 'cards', kind: 'resumes', title: '', cards: [{ resumeId: 'main', label: '', blurb: 'b' }, { resumeId: 'private', label: 'Secret', blurb: '' }] },
  ],
};
const context = { photoUrl: 'data:image/jpeg;base64,AA', site: { title: 'T' }, resumes: [{ id: 'main', href: '/resume', title: 'Engineer' }] };

test('the preview resolves the draft like the server does', () => {
  const out = resolveLanding(draft, context);
  assert.deepEqual(out.sections, [
    { kind: 'text', title: '', body: 'Hi' },
    {
      kind: 'links',
      title: 'Elsewhere',
      links: [
        { type: 'github', label: 'https://github.com/jo', url: 'https://github.com/jo' },
        { type: 'phone', label: '+1 555 555 0100', url: 'tel:+15555550100' },
      ],
    },
    { kind: 'items', title: 'Projects', items: [{ title: 'Tool', text: '', url: '' }] },
    { kind: 'resumes', title: '', cards: [{ label: 'Engineer', blurb: 'b', href: '/resume' }] },
  ]);
  assert.equal(out.photoUrl, context.photoUrl);
  assert.deepEqual(out.site, { title: 'T' });
  assert.equal(resolveLanding({ ...draft, photo: 'none' }, context).photoUrl, '');
  assert.equal(resolveLanding(draft, null).sections.some((s) => s.kind === 'resumes'), false);
});

test('hero actions and card PDFs resolve like the server does', () => {
  const ctx = {
    ...context,
    resumes: [
      { id: 'main', href: '/resume', title: 'Engineer', pdfHref: '/api/public/resume.pdf?v=1-2' },
      { id: 'sales', href: '/r/sales', title: 'Sales', pdfHref: '' },
    ],
  };
  const landing = {
    ...draft,
    availability: 'Open to work',
    actions: [
      { type: 'link', label: 'Email me', url: 'mailto:jo@example.com', icon: 'envelope' },
      { type: 'link', label: '', url: 'https://cal.example/jo' },
      { type: 'link', label: 'Bad', url: 'java\tscript:alert(1)' },
      { type: 'link', label: 'Half typed', url: '' },
      { type: 'resume', label: '', resumeId: 'main', open: 'pdf', icon: 'file-pdf' },
      { type: 'resume', label: 'Sales PDF', resumeId: 'sales', open: 'pdf' },
      { type: 'resume', label: '', resumeId: 'sales', open: 'page' },
      { type: 'resume', label: 'Secret', resumeId: 'private', open: 'page' },
    ],
    sections: [
      {
        id: 'cards',
        kind: 'resumes',
        title: '',
        cards: [
          { resumeId: 'main', label: '', blurb: '', showPdf: true },
          { resumeId: 'sales', label: '', blurb: '', showPdf: true },
        ],
      },
    ],
  };
  const out = resolveLanding(landing, ctx);
  assert.equal(out.availability, 'Open to work');
  assert.deepEqual(out.actions, [
    { label: 'Email me', href: 'mailto:jo@example.com', icon: 'envelope' },
    { label: 'https://cal.example/jo', href: 'https://cal.example/jo' },
    { label: 'Download my resume (PDF)', href: '/api/public/resume.pdf?v=1-2', icon: 'file-pdf' },
    { label: 'View my resume', href: '/r/sales' },
  ]);
  assert.deepEqual(out.sections[0].cards, [
    { label: 'Engineer', blurb: '', href: '/resume', pdfHref: '/api/public/resume.pdf?v=1-2' },
    { label: 'Sales', blurb: '', href: '/r/sales' },
  ]);
  // A draft from before actions (or no context yet) shows none.
  assert.deepEqual(resolveLanding(draft, ctx).actions, []);
  assert.equal(resolveLanding(draft, ctx).availability, '');
  assert.deepEqual(resolveLanding(landing, null).actions.map((a) => a.label), ['Email me', 'https://cal.example/jo']);
});

test('hidden sections, columns, quotes, meta lines, experience and dividers resolve exactly like the server', () => {
  const roles = [
    { jobTitle: 'SRE', company: 'Acme', companyUrl: 'https://acme.example', location: 'Remote', startDate: '2022', endDate: 'Present' },
    { jobTitle: 'Dev', company: 'Beta', companyUrl: 'java\tscript:alert(1)', location: '', startDate: '2019', endDate: '' },
    { jobTitle: '', company: 'Gamma', companyUrl: '', location: '', startDate: '', endDate: '2018' },
  ];
  const resumes = [
    { id: 'main', href: '/resume', title: 'Engineer', pdfHref: '', experience: roles },
    { id: 'empty', href: '/r/empty', title: '', pdfHref: '', experience: [] },
  ];
  const landing = {
    ...draft,
    sections: [
      { id: 'now', kind: 'text', title: 'Now', body: 'Reading', hidden: true },
      { id: 'proj', kind: 'items', title: '', items: [{ title: 'Tool', text: '', url: '', meta: '2024 · Rust' }, { title: 'B', text: '', url: '', meta: ' ' }] },
      {
        id: 'q',
        kind: 'quotes',
        title: 'Kind words',
        quotes: [
          { text: 'Great.', name: 'Ann', role: 'Manager', url: 'https://ann.example' },
          { text: ' ', name: 'Nobody', role: '', url: '' },
          { text: 'Fine.', name: '', role: '', url: 'java\tscript:x' },
        ],
      },
      { id: 'q2', kind: 'quotes', title: 'Empty', quotes: [] },
      { id: 'x', kind: 'experience', title: 'Recent', resumeId: 'main', count: 2, showDates: true },
      { id: 'y', kind: 'experience', title: '', resumeId: 'main', count: 10, showDates: false },
      { id: 'z', kind: 'experience', title: 'Private', resumeId: 'private', count: 3, showDates: true },
      { id: 'e', kind: 'experience', title: 'None', resumeId: 'empty', count: 3, showDates: true },
      { id: 'h', kind: 'experience', title: 'Hidden', resumeId: 'main', count: 1, showDates: true, hidden: true },
      { id: 'd', kind: 'divider', title: '', column: 'side' },
      { id: 'd2', kind: 'divider', title: 'Or', hidden: true },
    ],
  };
  const out = resolveLanding(landing, { ...context, resumes });
  const fromServer = server.resolveLanding(landing, { ...context, resumes: new Map(resumes.map((r) => [r.id, r])) });
  assert.deepEqual(out.sections, fromServer.sections);
  assert.deepEqual(out.sections.map((s) => s.title), ['', 'Kind words', 'Recent', '', '']);
  assert.deepEqual(out.sections[4], { kind: 'divider', title: '', column: 'side' });
  assert.equal(out.sections[2].roles[0].dates, '2022 – Present');
  assert.equal(out.sections[2].roles[1].companyUrl, '');

  // The editor's preview keeps a hidden section, marked, for it to dim.
  const preview = resolveLanding(landing, { ...context, resumes }, { withIds: true, withHidden: true });
  assert.deepEqual(preview.sections.filter((s) => s.hidden).map((s) => s.id), ['now', 'h', 'd2']);
  assert.equal(preview.sections.find((s) => s.id === 'now').body, 'Reading');
});

test('stats resolve exactly like the server: one without a value is dropped, then a section with none', () => {
  const landing = {
    ...draft,
    sections: [
      {
        id: 'n',
        kind: 'stats',
        title: 'By the numbers',
        column: 'side',
        stats: [
          { value: '15 years', label: 'in commercial kitchens' },
          { value: ' ', label: 'Only a label' },
          { value: '$4.2M', label: '' },
        ],
      },
      { id: 'n2', kind: 'stats', title: 'Empty', stats: [{ value: '', label: 'Nothing' }] },
      { id: 'n3', kind: 'stats', title: 'Hidden', stats: [{ value: '#1', label: 'in sales' }], hidden: true },
    ],
  };
  const out = resolveLanding(landing, context);
  assert.deepEqual(out.sections, server.resolveLanding(landing, { ...context, resumes: new Map() }).sections);
  assert.deepEqual(out.sections, [
    {
      kind: 'stats',
      title: 'By the numbers',
      column: 'side',
      stats: [
        { value: '15 years', label: 'in commercial kitchens' },
        { value: '$4.2M', label: '' },
      ],
    },
  ]);
  const preview = resolveLanding(landing, context, { withIds: true, withHidden: true });
  assert.deepEqual(preview.sections.map((s) => s.id), ['n', 'n3']);
});

test('FAQ sections resolve exactly like the server, dropping an entry without both parts', () => {
  const landing = {
    ...draft,
    sections: [
      {
        id: 'f',
        kind: 'faq',
        title: 'Questions',
        column: 'side',
        entries: [
          { question: 'Do you relocate?', answer: 'Yes, **within Europe**.' },
          { question: 'When?', answer: ' ' },
          { question: '', answer: 'Orphan answer' },
        ],
      },
      { id: 'f2', kind: 'faq', title: 'Empty', entries: [{ question: 'Q', answer: '' }] },
      { id: 'f3', kind: 'faq', title: 'Later', hidden: true, entries: [{ question: 'Q', answer: 'A' }] },
    ],
  };
  const out = resolveLanding(landing, context);
  const fromServer = server.resolveLanding(landing, { ...context, resumes: new Map() });
  assert.deepEqual(out.sections, fromServer.sections);
  assert.deepEqual(out.sections, [
    { kind: 'faq', title: 'Questions', column: 'side', entries: [{ question: 'Do you relocate?', answer: 'Yes, **within Europe**.' }] },
  ]);
  const preview = resolveLanding(landing, context, { withIds: true, withHidden: true });
  assert.deepEqual(preview.sections.map((s) => s.id), ['f', 'f3']);
});

test('services resolve exactly like the server: one without a title or a text is dropped, a button only while its link is whole', () => {
  const book = { type: 'link', label: 'Book', url: 'https://cal.example/jo', icon: 'calendar-days' };
  const landing = {
    ...draft,
    sections: [
      {
        id: 'sv',
        kind: 'services',
        title: 'Services',
        column: 'side',
        services: [
          { title: 'Tutoring', text: 'Weekly, **one to one**.', price: 'From $60/hour', action: book },
          { title: '', text: 'Just words.', price: '', action: { type: 'link', label: '', url: 'mailto:jo@example.com?subject=Hi' } },
          { title: 'Half typed', text: '', price: '', action: { type: 'link', label: 'Go', url: 'https://' } },
          { title: ' ', text: '', price: 'Free', action: book },
        ],
      },
      { id: 'sv2', kind: 'services', title: 'Only prices', services: [{ title: '', text: '', price: '$5', action: book }] },
      { id: 'sv3', kind: 'services', title: 'Later', hidden: true, services: [{ title: 'T', text: '', price: '' }] },
    ],
  };
  const out = resolveLanding(landing, context);
  const fromServer = server.resolveLanding(landing, { ...context, resumes: new Map() });
  assert.deepEqual(out.sections, fromServer.sections);
  assert.deepEqual(out.sections, [
    {
      kind: 'services',
      title: 'Services',
      column: 'side',
      services: [
        { title: 'Tutoring', text: 'Weekly, **one to one**.', price: 'From $60/hour', action: { label: 'Book', href: 'https://cal.example/jo', icon: 'calendar-days' } },
        { title: '', text: 'Just words.', price: '', action: { label: 'mailto:jo@example.com?subject=Hi', href: 'mailto:jo@example.com?subject=Hi' } },
        { title: 'Half typed', text: '', price: '' },
      ],
    },
  ]);
  const preview = resolveLanding(landing, context, { withIds: true, withHidden: true });
  assert.deepEqual(preview.sections.map((s) => s.id), ['sv', 'sv3']);
});

test('education and skills sections resolve exactly like the server', () => {
  const education = [
    { degree: 'BSc Nursing', institution: 'State U', location: 'Ohio', startDate: '2010', endDate: '2014' },
    { degree: '', institution: 'Trade school', location: '', startDate: '', endDate: '2008' },
  ];
  const skills = [
    { category: 'Languages', items: ['Spanish (fluent)', 'ASL (conversational)'] },
    { category: '', items: ['Triage'] },
  ];
  const resumes = [
    { id: 'main', href: '/resume', title: 'Nurse', pdfHref: '', experience: [], education, skills },
    { id: 'empty', href: '/r/empty', title: '', pdfHref: '', experience: [], education: [], skills: [] },
  ];
  const landing = {
    ...draft,
    sections: [
      { id: 'e', kind: 'education', title: 'Education', resumeId: 'main', count: 1, showDates: true },
      { id: 'e2', kind: 'education', title: '', resumeId: 'main', count: 10, showDates: false, column: 'side' },
      { id: 'e3', kind: 'education', title: 'None', resumeId: 'empty', count: 3, showDates: true },
      { id: 'e4', kind: 'education', title: 'Private', resumeId: 'private', count: 3, showDates: true },
      { id: 's', kind: 'skills', title: 'Skills', resumeId: 'main', column: 'side' },
      { id: 's2', kind: 'skills', title: 'None', resumeId: 'empty' },
      { id: 's3', kind: 'skills', title: 'Private', resumeId: 'private' },
      { id: 'sh', kind: 'skills', title: 'Hidden', resumeId: 'main', hidden: true },
    ],
  };
  const out = resolveLanding(landing, { ...context, resumes });
  const fromServer = server.resolveLanding(landing, { ...context, resumes: new Map(resumes.map((r) => [r.id, r])) });
  assert.deepEqual(out.sections, fromServer.sections);
  assert.deepEqual(out.sections.map((s) => s.title), ['Education', '', 'Skills']);
  assert.deepEqual(out.sections[0].entries, [{ degree: 'BSc Nursing', institution: 'State U', location: 'Ohio', dates: '2010 – 2014' }]);
  assert.equal(out.sections[1].entries[1].dates, '');
  assert.deepEqual(out.sections[2], { kind: 'skills', title: 'Skills', column: 'side', groups: skills, href: '/resume' });
  const preview = resolveLanding(landing, { ...context, resumes }, { withIds: true, withHidden: true });
  assert.deepEqual(preview.sections.filter((s) => s.hidden).map((s) => s.id), ['sh']);
});

test("the server splits a skill group's items exactly as the resume's chips do", () => {
  const cases = ['Go, Rust, SQL', ' a ,, b ,', '', ',', 'Spanish (fluent), ASL (conversational)', 'one', 'a,b\nc, d', '  ', 'C++, C#, .NET'];
  for (const items of cases) assert.deepEqual(server.splitSkillItems(items), splitItems(items), JSON.stringify(items));
  assert.deepEqual(server.splitSkillItems(undefined), splitItems(undefined));
  const blocks = cases.map((items, i) => ({ id: `g${i}`, type: 'skills_group', parentId: null, visibleWeb: true, visiblePrint: true, data: { category: `C${i}`, items } }));
  for (const group of server.skillGroups(blocks)) {
    const i = Number(group.category.slice(1));
    assert.deepEqual(group.items, splitItems(cases[i]));
  }
});

test('a text section splits into paragraphs on blank lines', () => {
  assert.deepEqual(textParagraphs('One\nstill one\n\n  \nTwo\n'), ['One\nstill one', 'Two']);
  assert.deepEqual(textParagraphs(''), []);
});

test('uploaded images resolve like the server does, at the editor path the context gives', () => {
  const id = 'a'.repeat(64);
  const gone = 'b'.repeat(64);
  const src = `/api/landing/images/${id}`;
  const ctx = { ...context, images: [{ id, src, width: 800, height: 600 }] };
  const ref = (imageId, alt = 'Alt') => ({ imageId, alt });
  const landing = {
    ...draft,
    photo: 'upload',
    photoImage: ref(id, 'Jo'),
    sections: [
      { id: 'i', kind: 'items', title: '', items: [{ title: 'P', text: '', url: '', image: ref(id) }, { title: 'Q', text: '', url: '', image: ref(gone) }] },
      { id: 'pic', kind: 'image', title: 'Me', image: ref(id), caption: 'Hi' },
      { id: 'gone', kind: 'image', title: 'Gone', image: ref(gone), caption: '' },
      { id: 'none', kind: 'image', title: '', image: null, caption: '' },
    ],
    seo: { title: '', description: '', noindex: false, image: ref(id, 'Card') },
  };
  const shown = { src, alt: 'Alt', width: 800, height: 600 };
  const out = resolveLanding(landing, ctx, { withIds: true });
  assert.equal(out.photoUrl, src);
  assert.equal(out.photoAlt, 'Jo');
  assert.deepEqual(out.sections, [
    { id: 'i', kind: 'items', title: '', items: [{ title: 'P', text: '', url: '', image: shown }, { title: 'Q', text: '', url: '' }] },
    { id: 'pic', kind: 'image', title: 'Me', image: shown, caption: 'Hi' },
  ]);
  assert.deepEqual(out.seo.image, { ...shown, alt: 'Card' });
  // Before the context lists it (or with none), nothing shows.
  const bare = resolveLanding(landing, context);
  assert.equal(bare.photoUrl, '');
  assert.deepEqual(bare.sections.map((s) => s.kind), ['items']);
  assert.equal('image' in bare.seo, false);
});

test('credentials resolve exactly like the server, expired ones dropped, or dimmed in the preview', () => {
  const entry = (name, expires, extra = {}) => ({ kind: 'license', name, issuer: 'Board', number: '', issued: '', expires, url: '', ...extra });
  const landing = {
    ...draft,
    sections: [
      {
        id: 'c',
        kind: 'credentials',
        title: 'Licenses',
        column: 'side',
        credentials: [
          entry('RN', 'Dec 2026', { number: 'RN-1', issued: '2019', url: 'https://board.example/verify' }),
          entry('Lapsed', '10/2026'),
          entry('Bad link', '', { url: 'java\tscript:alert(1)' }),
          entry('Unreadable', 'Renewed yearly', { kind: 'membership' }),
          entry(' ', ''),
        ],
      },
      { id: 'old', kind: 'credentials', title: 'Old', credentials: [entry('A', '2020'), entry('B', 'Jan 2025')] },
      { id: 'hid', kind: 'credentials', title: 'Hidden', hidden: true, credentials: [entry('C', '2020')] },
      { id: 'none', kind: 'credentials', title: 'None', credentials: [] },
    ],
  };
  for (const today of ['2026-11-10', '2026-12-31', '2027-01-01', '2019-01-01']) {
    const ctx = { ...context, today };
    const fromServer = server.resolveLanding(landing, { ...ctx, resumes: new Map() });
    assert.deepEqual(resolveLanding(landing, ctx).sections, fromServer.sections, today);
  }
  const out = resolveLanding(landing, { ...context, today: '2026-11-10' }).sections;
  assert.deepEqual(out.map((s) => s.title), ['Licenses']);
  assert.deepEqual(out[0].credentials.map((c) => c.name), ['RN', 'Bad link', 'Unreadable']);
  assert.equal(out[0].credentials[0].url, 'https://board.example/verify');
  assert.equal(out[0].credentials[1].url, '');

  // The preview keeps expired entries, marked, and a section of nothing else
  // as not shown; a hidden section stays plainly hidden.
  const preview = resolveLanding(landing, { ...context, today: '2026-11-10' }, { withIds: true, withHidden: true }).sections;
  assert.deepEqual(
    preview.map((s) => [s.id, Boolean(s.hidden), Boolean(s.expired)]),
    [
      ['c', false, false],
      ['old', true, true],
      ['hid', true, false],
    ]
  );
  assert.deepEqual(
    preview[0].credentials.map((c) => [c.name, Boolean(c.expired)]),
    [
      ['RN', false],
      ['Lapsed', true],
      ['Bad link', false],
      ['Unreadable', false],
    ]
  );
  // Without a today in the context, it's read against the clock, in UTC.
  assert.equal(resolveLanding(landing, context).sections.find((s) => s.title === 'Old'), undefined);
});

test('a gallery resolves exactly like the server: stored images in order, the rest left out (issue #120)', () => {
  const id = 'a'.repeat(64);
  const gone = 'b'.repeat(64);
  const src = `/api/landing/images/${id}`;
  const images = [{ id, src, width: 800, height: 600 }];
  const landing = {
    ...draft,
    sections: [
      {
        id: 'g',
        kind: 'gallery',
        title: 'Work',
        column: 'side',
        images: [
          { image: { imageId: gone, alt: 'Gone' }, caption: '' },
          { image: { imageId: id, alt: 'Cake' }, caption: 'Wedding' },
          { image: null, caption: 'Not yet' },
        ],
      },
      { id: 'none', kind: 'gallery', title: 'Empty', images: [{ image: null, caption: '' }] },
      { id: 'hid', kind: 'gallery', title: 'Hidden', hidden: true, images: [{ image: { imageId: id, alt: 'x' }, caption: '' }] },
    ],
  };
  const out = resolveLanding(landing, { ...context, images });
  const fromServer = server.resolveLanding(landing, { ...context, resumes: new Map(), images: new Map(images.map((i) => [i.id, i])) });
  assert.deepEqual(out.sections, fromServer.sections);
  assert.deepEqual(out.sections, [
    { kind: 'gallery', title: 'Work', column: 'side', images: [{ image: { src, alt: 'Cake', width: 800, height: 600 }, caption: 'Wedding' }] },
  ]);
  const preview = resolveLanding(landing, { ...context, images }, { withIds: true, withHidden: true });
  assert.deepEqual(preview.sections.map((s) => [s.id, Boolean(s.hidden)]), [
    ['g', false],
    ['hid', true],
  ]);
});

test('a media section resolves exactly like the server: the parsed link only, left out without one (issue #121)', () => {
  const id = 'a'.repeat(64);
  const src = `/api/landing/images/${id}`;
  const images = [{ id, src, width: 1600, height: 900 }];
  const landing = {
    ...draft,
    sections: [
      { id: 'm', kind: 'media', title: 'Reel', column: 'side', url: 'https://youtu.be/dQw4w9WgXcQ?t=90', caption: 'Spring', poster: { imageId: id, alt: 'Stage' }, transcript: 'Hi.' },
      { id: 'sc', kind: 'media', title: '', url: 'https://soundcloud.com/forss/sets/soulhack', caption: '', poster: { imageId: 'b'.repeat(64), alt: '' }, transcript: '' },
      { id: 'none', kind: 'media', title: 'Not yet', url: 'https://youtu', caption: '', transcript: '' },
      { id: 'hid', kind: 'media', title: 'Hidden', hidden: true, url: 'https://vimeo.com/76979871', caption: '', transcript: '' },
    ],
  };
  const out = resolveLanding(landing, { ...context, images });
  const fromServer = server.resolveLanding(landing, { ...context, resumes: new Map(), images: new Map(images.map((i) => [i.id, i])) });
  assert.deepEqual(out.sections, fromServer.sections);
  assert.deepEqual(out.sections, [
    {
      kind: 'media',
      title: 'Reel',
      column: 'side',
      media: { provider: 'youtube', mediaId: 'dQw4w9WgXcQ', start: 90 },
      caption: 'Spring',
      transcript: 'Hi.',
      poster: { src, alt: 'Stage', width: 1600, height: 900 },
    },
    { kind: 'media', title: '', media: { provider: 'soundcloud', mediaId: 'forss/sets/soulhack', start: 0 }, caption: '', transcript: '' },
  ]);
  assert.equal(JSON.stringify(out.sections).includes('youtu.be'), false);
  const preview = resolveLanding(landing, { ...context, images }, { withIds: true, withHidden: true });
  assert.deepEqual(preview.sections.map((s) => [s.id, Boolean(s.hidden)]), [
    ['m', false],
    ['sc', false],
    ['hid', true],
  ]);
});

test('publications resolve exactly like the server, sorted, grouped and linked', () => {
  const entry = (kind, title, date, extra = {}) => ({ kind, title, outlet: 'Outlet', date, url: '', doi: '', note: '', ...extra });
  const entries = [
    entry('talk', 'Keynote', '2019', { url: 'https://conf.example/2019', doi: '10.1234/ignored' }),
    entry('paper', 'Old paper', 'Mar 2021', { doi: '10.1234/old#1' }),
    entry('article', 'Forthcoming piece', 'Forthcoming', { url: 'java\tscript:alert(1)' }),
    entry('paper', 'New paper', '2024-02-01', { doi: '10.1234/' }),
    entry('press', 'Profile', '05/2023', { doi: '10.5555/profile', note: 'Interviewed' }),
    entry('article', ' ', '2030'),
  ];
  for (const order of ['manual', 'newest']) {
    for (const group of [false, true]) {
      const landing = {
        ...draft,
        sections: [
          { id: 'p', kind: 'publications', title: 'Work', column: 'side', order, group, entries },
          { id: 'none', kind: 'publications', title: 'None', order, group, entries: [entry('book', '', '2020')] },
          { id: 'hid', kind: 'publications', title: 'Hidden', hidden: true, order, group, entries },
        ],
      };
      const fromServer = server.resolveLanding(landing, { ...context, resumes: new Map() });
      const out = resolveLanding(landing, context).sections;
      assert.deepEqual(out, fromServer.sections, `${order} ${group}`);
      assert.deepEqual(out.map((s) => s.title), ['Work']);
    }
  }
  const newest = resolveLanding({ ...draft, sections: [{ id: 'p', kind: 'publications', title: '', order: 'newest', group: false, entries }] }, context);
  assert.deepEqual(
    newest.sections[0].entries.map((e) => [e.title, e.url]),
    [
      ['New paper', ''],
      ['Profile', 'https://doi.org/10.5555/profile'],
      ['Forthcoming piece', ''],
      ['Old paper', 'https://doi.org/10.1234/old%231'],
      ['Keynote', 'https://conf.example/2019'],
    ]
  );
});
