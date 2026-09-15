import { ContactInline, HeadshotImage, HeaderActions } from '@resume/headerParts.jsx';

export default function DoubleRuleHeader({ header, showActions, onPrint, pdfHref }) {
  return (
    <div className="r-header r-header-doublerule">
      <div className="r-header-identity">
        <HeadshotImage header={header} />
        <div className="r-header-main">
          <h1 className="r-name r-name-doublerule">{header.name}</h1>
          <div className="r-title">{header.title}</div>
          {header.subtitle && <div className="r-subtitle">{header.subtitle}</div>}
          <ContactInline header={header} className="r-contact" />
        </div>
      </div>
      {showActions && <HeaderActions onPrint={onPrint} pdfHref={pdfHref} />}
    </div>
  );
}
