import {
  faBook,
  faBriefcase,
  faCalendarCheck,
  faCalendarDays,
  faCircleCheck,
  faCode,
  faComments,
  faDownload,
  faEnvelope,
  faFileLines,
  faFilePdf,
  faGlobe,
  faGraduationCap,
  faHandshake,
  faLaptopCode,
  faLink,
  faLocationDot,
  faMugHot,
  faPaperPlane,
  faPen,
  faPhone,
  faRocket,
  faStar,
  faUser,
  faVideo,
} from '@fortawesome/free-solid-svg-icons';
import {
  faBehance,
  faBluesky,
  faDiscord,
  faDribbble,
  faGithub,
  faGitlab,
  faInstagram,
  faLinkedin,
  faMastodon,
  faMedium,
  faStackOverflow,
  faXTwitter,
  faYoutube,
} from '@fortawesome/free-brands-svg-icons';

// The icons a landing page button may show before its label, from Font
// Awesome Free (icons CC BY 4.0, code MIT; the build keeps the packages'
// license comments, the attribution that asks for). Only these are
// bundled, drawn as inline SVG, so the page loads no icon font or script. `value` is what the draft stores; the server's list of
// names is ACTION_ICONS in server/src/landingFields.js.
export const ACTION_ICONS = [
  { value: 'envelope', label: 'Envelope', group: 'Contact', icon: faEnvelope },
  { value: 'paper-plane', label: 'Paper plane', group: 'Contact', icon: faPaperPlane },
  { value: 'phone', label: 'Phone', group: 'Contact', icon: faPhone },
  { value: 'comments', label: 'Chat', group: 'Contact', icon: faComments },
  { value: 'calendar-days', label: 'Calendar', group: 'Contact', icon: faCalendarDays },
  { value: 'calendar-check', label: 'Booked', group: 'Contact', icon: faCalendarCheck },
  { value: 'video', label: 'Video call', group: 'Contact', icon: faVideo },
  { value: 'mug-hot', label: 'Coffee', group: 'Contact', icon: faMugHot },
  { value: 'handshake', label: 'Handshake', group: 'Contact', icon: faHandshake },
  { value: 'file-pdf', label: 'PDF', group: 'Documents', icon: faFilePdf },
  { value: 'file-lines', label: 'Document', group: 'Documents', icon: faFileLines },
  { value: 'download', label: 'Download', group: 'Documents', icon: faDownload },
  { value: 'briefcase', label: 'Briefcase', group: 'Documents', icon: faBriefcase },
  { value: 'graduation-cap', label: 'Graduation cap', group: 'Documents', icon: faGraduationCap },
  { value: 'book', label: 'Book', group: 'Documents', icon: faBook },
  { value: 'pen', label: 'Pen', group: 'Documents', icon: faPen },
  { value: 'globe', label: 'Globe', group: 'Web', icon: faGlobe },
  { value: 'link', label: 'Link', group: 'Web', icon: faLink },
  { value: 'code', label: 'Code', group: 'Web', icon: faCode },
  { value: 'laptop-code', label: 'Laptop', group: 'Web', icon: faLaptopCode },
  { value: 'rocket', label: 'Rocket', group: 'Web', icon: faRocket },
  { value: 'star', label: 'Star', group: 'Web', icon: faStar },
  { value: 'user', label: 'Person', group: 'Web', icon: faUser },
  { value: 'location-dot', label: 'Location', group: 'Web', icon: faLocationDot },
  { value: 'circle-check', label: 'Check', group: 'Web', icon: faCircleCheck },
  { value: 'linkedin', label: 'LinkedIn', group: 'Brands', icon: faLinkedin },
  { value: 'github', label: 'GitHub', group: 'Brands', icon: faGithub },
  { value: 'gitlab', label: 'GitLab', group: 'Brands', icon: faGitlab },
  { value: 'x-twitter', label: 'X / Twitter', group: 'Brands', icon: faXTwitter },
  { value: 'bluesky', label: 'Bluesky', group: 'Brands', icon: faBluesky },
  { value: 'mastodon', label: 'Mastodon', group: 'Brands', icon: faMastodon },
  { value: 'stack-overflow', label: 'Stack Overflow', group: 'Brands', icon: faStackOverflow },
  { value: 'medium', label: 'Medium', group: 'Brands', icon: faMedium },
  { value: 'youtube', label: 'YouTube', group: 'Brands', icon: faYoutube },
  { value: 'instagram', label: 'Instagram', group: 'Brands', icon: faInstagram },
  { value: 'dribbble', label: 'Dribbble', group: 'Brands', icon: faDribbble },
  { value: 'behance', label: 'Behance', group: 'Brands', icon: faBehance },
  { value: 'discord', label: 'Discord', group: 'Brands', icon: faDiscord },
];

export const ACTION_ICON_GROUPS = [...new Set(ACTION_ICONS.map((entry) => entry.group))];

export function actionIcon(name) {
  return ACTION_ICONS.find((entry) => entry.value === name) || null;
}
