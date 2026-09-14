export const BLOCK_TYPE_LABELS = {
  heading: 'Section Heading',
  summary: 'Professional Summary',
  skills_group: 'Skills Row',
  experience: 'Experience Entry',
  education: 'Education Entry',
  custom: 'Custom Block',
};

export const CUSTOM_BODY_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'list', label: 'List' },
  { value: 'link', label: 'Link' },
  { value: 'tags', label: 'Tags' },
];

export function defaultCustomItem() {
  return { heading: '', bodyType: 'text', text: 'New item.' };
}

export function defaultDataForType(type) {
  switch (type) {
    case 'heading':
      return { text: 'New Section' };
    case 'summary':
      return { text: 'A brief summary of your professional background and goals.' };
    case 'skills_group':
      return { category: 'Category', items: 'Item one, item two, item three' };
    case 'experience':
      return {
        jobTitle: 'Job Title',
        company: 'Company',
        companyUrl: '',
        location: '',
        startDate: '',
        endDate: '',
        tagline: '',
        bullets: [],
      };
    case 'education':
      return { degree: 'Degree', institution: 'Institution', location: '', startDate: '', endDate: '' };
    case 'custom':
      return { title: 'Custom Section', items: [defaultCustomItem()] };
    default:
      return {};
  }
}
