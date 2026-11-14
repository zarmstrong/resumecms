// What a brand-new install starts with (db.js seeds it once, while no
// resume exists, so an install that already has content never sees it):
// placeholder text that reads as instructions and fits any line of work,
// not one profession (issue #130). client/src/resume/sampleResume.js is
// the same content for the no-auth template previews, and its test
// compares the two.

export const SAMPLE_HEADER = {
  name: 'Your Name',
  title: 'Your Job Title',
  subtitle: '',
  location: 'City, State',
  email: 'you@example.com',
  phone: '',
  links: [{ label: 'linkedin.com/in/you', url: 'https://linkedin.com/in/you' }],
};

// No title: an empty one is derived from the header ("Name – Title",
// pageMeta.js), which a link preview shows (issue #87).
export const SAMPLE_SITE = {
  colors: {
    accent: '#2f6f4e',
    heading: '#14181c',
    text: '#14181c',
    background: '#ffffff',
  },
};

// In order; each heading titles the blocks after it (none are nested).
export const SAMPLE_BLOCKS = [
  {
    type: 'summary',
    data: {
      text: "Two or three sentences about you: the work you do, what you're best at, and the kind of role you're looking for next.",
    },
  },
  { type: 'heading', data: { text: 'Experience' } },
  {
    type: 'experience',
    data: {
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
    },
  },
  { type: 'heading', data: { text: 'Skills' } },
  {
    type: 'skills_group',
    data: { category: 'Strengths', items: 'Customer service, Scheduling, Training others, Problem solving, Clear communication' },
  },
  { type: 'heading', data: { text: 'Education and certifications' } },
  {
    type: 'education',
    data: {
      degree: 'Your degree, diploma, license or certificate',
      institution: 'Where you earned it',
      location: 'City, State',
      startDate: '2016',
      endDate: '2019',
    },
  },
];
