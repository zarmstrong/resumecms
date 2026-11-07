import { HeaderBlock } from '../resume/HeaderBlock.jsx';
import { resumePageStyle, usePrintBackground } from '../resume/pageStyle.js';
import { normalizeTemplate } from '../resume/templateRegistry.js';
import { letterParts } from './letterParts.js';
import '../resume/resume.css';
import './letter.css';

// A cover letter (issue #71) under its resume's header, in its colors and
// fonts, so the two read as a set. The resume's layout doesn't come into
// it: that arranges blocks, and a letter has none. `letter` is the
// letter's data, `today` the date a letter without one shows.
// mode: 'print' (the PDF renderer's /print/letter) | 'preview' (the editor).
// `highlighted` (preview only) outlines the body while it shows an AI
// proposal that isn't saved yet.
export function CoverLetterView({ header, site, letter, today, mode = 'preview', highlighted = false }) {
  const { colors, style } = resumePageStyle(site);
  usePrintBackground(mode, colors.background);
  const parts = letterParts(letter, header, today);

  return (
    <div className={`r-page r-mode-${mode} r-letter`} style={style}>
      <HeaderBlock header={header} showActions={false} template={normalizeTemplate(site)} />
      <div className={`r-letter-body${highlighted && mode === 'preview' ? ' r-block-ai-preview' : ''}`}>
        <p className="r-letter-date">{parts.date}</p>
        {parts.recipient.length > 0 && (
          <address className="r-letter-recipient">
            {parts.recipient.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </address>
        )}
        {parts.salutation && <p className="r-letter-salutation">{parts.salutation}</p>}
        {parts.paragraphs.map((paragraph, i) => (
          <p key={i} className="r-letter-paragraph">
            {paragraph}
          </p>
        ))}
        {(parts.closing || parts.signature) && (
          <div className="r-letter-signoff">
            {parts.closing && <p className="r-letter-closing">{parts.closing}</p>}
            {parts.signature && <p className="r-letter-signature">{parts.signature}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
