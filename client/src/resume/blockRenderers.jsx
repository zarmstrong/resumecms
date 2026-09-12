export function HeadingBlock({ data }) {
  return <h2 className="r-heading">{data.text}</h2>;
}

export function SkillsGroupBlock({ data }) {
  return (
    <div className="r-skills-row">
      <div className="r-skills-label">{data.category}</div>
      <div className="r-skills-value">{data.items}</div>
    </div>
  );
}

export function ExperienceBlock({ data }) {
  return (
    <div className="r-experience">
      <div className="r-experience-top">
        <div className="r-experience-title">{data.jobTitle}</div>
        <div className="r-experience-dates">
          {data.startDate} – {data.endDate}
        </div>
      </div>
      <div className="r-experience-company">
        {data.companyUrl ? (
          <a href={data.companyUrl} target="_blank" rel="noreferrer">
            {data.company}
          </a>
        ) : (
          data.company
        )}
        {data.location ? <span className="r-experience-location">, {data.location}</span> : null}
      </div>
      {data.tagline ? <div className="r-experience-tagline">{data.tagline}</div> : null}
      {Array.isArray(data.bullets) && data.bullets.length > 0 && (
        <ul className="r-bullets">
          {data.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EducationBlock({ data }) {
  return (
    <div className="r-education">
      <div className="r-experience-top">
        <div className="r-experience-title">{data.degree}</div>
        <div className="r-experience-dates">
          {data.startDate} – {data.endDate}
        </div>
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
  skills_group: SkillsGroupBlock,
  experience: ExperienceBlock,
  education: EducationBlock,
  custom: CustomBlock,
};
