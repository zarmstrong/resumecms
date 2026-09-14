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

export function splitItems(items) {
  return (items || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(items) {
  return (items || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Legacy custom items were saved as `{ heading, body }` with no bodyType.
// Treat those as plain text so old data keeps rendering unchanged.
function normalizeCustomItem(item) {
  if (item.bodyType) return item;
  return { ...item, bodyType: 'text', text: item.body };
}

export function SkillsGroupBlock({ data, skillsDisplay = 'rows' }) {
  if (skillsDisplay === 'chips') {
    return (
      <div className="r-skills-chips-row">
        <div className="r-skills-label">{data.category}</div>
        <div className="r-skills-chip-list">
          {splitItems(data.items).map((item, i) => (
            <span className="r-skills-chip" key={i}>
              {item}
            </span>
          ))}
        </div>
      </div>
    );
  }

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
      {data.description ? <p className="r-experience-description">{data.description}</p> : null}
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

function CustomItemBody({ item }) {
  switch (item.bodyType) {
    case 'list':
      return (
        <ul className="r-bullets">
          {splitLines(item.items).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      );
    case 'link':
      return safeHref(item.url) ? (
        <a className="r-custom-item-body" href={safeHref(item.url)} target="_blank" rel="noreferrer">
          {item.label || item.url}
        </a>
      ) : item.label ? (
        <div className="r-custom-item-body">{item.label}</div>
      ) : null;
    case 'tags':
      return (
        <div className="r-skills-chip-list" style={item.tagColor ? { '--r-tag-color': item.tagColor } : undefined}>
          {splitItems(item.items).map((tag, i) => (
            <span className="r-skills-chip" key={i}>
              {tag}
            </span>
          ))}
        </div>
      );
    case 'text':
    default:
      return item.text ? <div className="r-custom-item-body">{item.text}</div> : null;
  }
}

export function CustomBlock({ data }) {
  return (
    <div className="r-custom">
      {data.title ? <h3 className="r-custom-title">{data.title}</h3> : null}
      {Array.isArray(data.items) &&
        data.items.map((item, i) => {
          const normalized = normalizeCustomItem(item);
          return (
            <div className="r-custom-item" key={i}>
              {normalized.heading ? <div className="r-custom-item-heading">{normalized.heading}</div> : null}
              <CustomItemBody item={normalized} />
            </div>
          );
        })}
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
