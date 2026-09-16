import { ContactInline, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';

function initialsFor(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = words[0][0] || '';
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export default function InitialsHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-initials">
      <div className="r-header-identity">
        {header.photoUrl ? (
          <HeadshotImage header={header} />
        ) : (
          <div className="r-header-monogram" aria-hidden="true">
            {initialsFor(header.name)}
          </div>
        )}
        <div className="r-header-main">
          <h1 className="r-name">{header.name}</h1>
          <div className="r-title">{header.title}</div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          <ContactInline header={header} className="r-contact" />
        </div>
      </div>
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
