// Placeholder resume content used by TemplatePreviewPage.jsx (a shareable,
// no-auth preview of a header/layout/preset) so a template can be previewed
// there without touching anyone's real draft. The same content
// server/src/sampleContent.js seeds a brand-new install with, kept as a
// client-side copy so the bundle doesn't reach into the server, with the
// ids, positions and flags a block from the API has; sampleResume.test.js
// compares the two.

export const sampleHeader = {
  name: 'Your Name',
  title: 'Your Job Title',
  subtitle: '',
  location: 'City, State',
  email: 'you@example.com',
  phone: '',
  links: [{ label: 'linkedin.com/in/you', url: 'https://linkedin.com/in/you' }],
};

const block = (id, type, position, data) => ({ id, type, position, visibleWeb: true, visiblePrint: true, data });

export const sampleBlocks = [
  block('sample-summary', 'summary', 0, {
    text: "Two or three sentences about you: the work you do, what you're best at, and the kind of role you're looking for next.",
  }),
  block('sample-heading-experience', 'heading', 1, { text: 'Experience' }),
  block('sample-experience', 'experience', 2, {
    jobTitle: 'Your Job Title',
    company: 'Where You Work',
    companyUrl: '',
    location: 'City, State',
    startDate: '2021',
    endDate: 'Current',
    tagline: 'One line about the place: what it does, who it serves or how big it is.',
    bullets: [
      { text: 'Start with a result you are proud of, with a number if you have one (cut wait times by a third, trained 12 new hires).', children: [] },
      { text: 'Add what you were trusted with: people, money, equipment, customers or deadlines.', children: [] },
    ],
  }),
  block('sample-heading-skills', 'heading', 3, { text: 'Skills' }),
  block('sample-skills', 'skills_group', 4, {
    category: 'Strengths',
    items: 'Customer service, Scheduling, Training others, Problem solving, Clear communication',
  }),
  block('sample-heading-education', 'heading', 5, { text: 'Education and certifications' }),
  block('sample-education', 'education', 6, {
    degree: 'Your degree, diploma, license or certificate',
    institution: 'Where you earned it',
    location: 'City, State',
    startDate: '2016',
    endDate: '2019',
  }),
];
