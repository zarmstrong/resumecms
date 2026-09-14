// Placeholder resume content used by TemplatePreviewPage.jsx (a shareable,
// no-auth preview of a header/layout/preset) so a template can be previewed
// there without touching anyone's real draft. Mirrors the seed content
// server/src/db.js inserts for a brand-new install — kept as a separate
// client-side copy since the client can't import server code and this
// placeholder text changes essentially never.

export const sampleHeader = {
  name: 'Your Name',
  title: 'Your Professional Title',
  subtitle: '',
  location: 'City, State, Country',
  email: 'you@example.com',
  phone: '',
  links: [{ label: 'linkedin.com/in/you', url: 'https://linkedin.com/in/you' }],
};

export const sampleBlocks = [
  {
    id: 'sample-heading-skills',
    type: 'heading',
    position: 0,
    visibleWeb: true,
    visiblePrint: true,
    data: { text: 'Technical Skills' },
  },
  {
    id: 'sample-skills',
    type: 'skills_group',
    position: 1,
    visibleWeb: true,
    visiblePrint: true,
    data: { category: 'Technologies', items: 'AWS, Docker, Ansible, Linux, PostgreSQL' },
  },
  {
    id: 'sample-heading-experience',
    type: 'heading',
    position: 2,
    visibleWeb: true,
    visiblePrint: true,
    data: { text: 'Professional Experience' },
  },
  {
    id: 'sample-experience',
    type: 'experience',
    position: 3,
    visibleWeb: true,
    visiblePrint: true,
    data: {
      jobTitle: 'Senior Engineer',
      company: 'Example Corp',
      companyUrl: 'https://example.com',
      location: 'Remote',
      startDate: '2022',
      endDate: 'Current',
      tagline: 'A short description of what the company does.',
      bullets: [
        { text: 'Describe an impactful accomplishment.', children: [] },
        { text: 'Add another bullet point here.', children: [] },
      ],
    },
  },
  {
    id: 'sample-heading-education',
    type: 'heading',
    position: 4,
    visibleWeb: true,
    visiblePrint: true,
    data: { text: 'Education' },
  },
  {
    id: 'sample-education',
    type: 'education',
    position: 5,
    visibleWeb: true,
    visiblePrint: true,
    data: {
      degree: 'B.S. in Your Field',
      institution: 'Your University',
      location: 'City, State',
      startDate: '2010',
      endDate: '2014',
    },
  },
];
