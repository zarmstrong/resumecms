import { normalizeBullet } from './bulletUtils.js';
import { safeHref } from './safeUrl.js';
import { headingFontSize } from './blockStyle.js';

// Joins whichever of the two date fields is actually filled in — no
// dangling " – " when only a start or only an end date is set.
function formatDateRange(start, end) {
  return [start, end].filter(Boolean).join(' – ');
}

export function HeadingBlock({ data }) {
  return (
    <h2 className="r-heading" style={{ fontSize: headingFontSize(data) }}>
      {data.text}
    </h2>
  );
}

export function SummaryBlock({ data }) {
  if (!data.text) return null;
  return <p className="r-summary">{data.text}</p>;
}

export function SkillsGroupBlock({ data }) {
  return (
    <div className="r-skills-row">
      <div className="r-skills-label">{data.category}</div>
      <div className="r-skills-value">{data.items}</div>
    </div>
  );
}

function bulletsForMode(bullets, mode) {
  return mode === 'preview'
    ? bullets
    : bullets.filter((b) => (mode === 'print' ? b.visiblePrint : b.visibleWeb));
}

function BulletList({ bullets, mode }) {
  const visible = bulletsForMode(bullets, mode);
  if (visible.length === 0) return null;
  return (
    <ul className="r-bullets">
      {visible.map((b, i) => {
        const dimmed = mode === 'preview' && !(b.visibleWeb && b.visiblePrint);
        return (
          <li key={i} className={dimmed ? 'r-bullet-dimmed' : undefined}>
            {b.text}
            <BulletList bullets={b.children} mode={mode} />
          </li>
        );
      })}
    </ul>
  );
}

export function ExperienceBlock({ data, mode = 'web' }) {
  const bullets = (data.bullets || []).map((b) => normalizeBullet(b));

  return (
    <div className="r-experience">
      <div className="r-experience-top">
        <div className="r-experience-title">{data.jobTitle}</div>
        <div className="r-experience-dates">{formatDateRange(data.startDate, data.endDate)}</div>
      </div>
      <div className="r-experience-company">
        {safeHref(data.companyUrl) ? (
          <a href={safeHref(data.companyUrl)} target="_blank" rel="noreferrer">
            {data.company}
          </a>
        ) : (
          data.company
        )}
        {data.location ? <span className="r-experience-location">, {data.location}</span> : null}
      </div>
      {data.tagline ? <div className="r-experience-tagline">{data.tagline}</div> : null}
      <BulletList bullets={bullets} mode={mode} />
    </div>
  );
}

export function EducationBlock({ data }) {
  return (
    <div className="r-education">
      <div className="r-experience-top">
        <div className="r-experience-title">{data.degree}</div>
        <div className="r-experience-dates">{formatDateRange(data.startDate, data.endDate)}</div>
      </div>
      <div className="r-experience-company">
        {data.institution}
        {data.location ? <span className="r-experience-location">, {data.location}</span> : null}
      </div>
    </div>
  );
}

export function CustomBlock({ data }) {
  return (
    <div className="r-custom">
      {data.title ? <h3 className="r-custom-title">{data.title}</h3> : null}
      {Array.isArray(data.items) &&
        data.items.map((item, i) => (
          <div className="r-custom-item" key={i}>
            {item.heading ? <div className="r-custom-item-heading">{item.heading}</div> : null}
            {item.body ? <div className="r-custom-item-body">{item.body}</div> : null}
          </div>
        ))}
    </div>
  );
}

export const BLOCK_RENDERERS = {
  heading: HeadingBlock,
  summary: SummaryBlock,
  skills_group: SkillsGroupBlock,
  experience: ExperienceBlock,
  education: EducationBlock,
  custom: CustomBlock,
};
