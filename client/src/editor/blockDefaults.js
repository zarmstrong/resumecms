export const BLOCK_TYPE_LABELS = {
  heading: 'Section Heading',
  skills_group: 'Skills Row',
  experience: 'Experience Entry',
  education: 'Education Entry',
  custom: 'Custom Block',
};

export function defaultDataForType(type) {
  switch (type) {
    case 'heading':
      return { text: 'New Section' };
    case 'skills_group':
      return { category: 'Category', items: 'Item one, item two, item three' };
    case 'experience':
      return {
        jobTitle: 'Job Title',
        company: 'Company',
        companyUrl: '',
        location: '',
        startDate: '',
        endDate: 'Current',
        tagline: '',
        bullets: [{ text: 'New accomplishment.', visibleWeb: true, visiblePrint: true }],
      };
    case 'education':
      return { degree: 'Degree', institution: 'Institution', location: '', startDate: '', endDate: '' };
    case 'custom':
      return { title: 'Custom Section', items: [{ heading: '', body: 'New item.' }] };
    default:
      return {};
  }
}
