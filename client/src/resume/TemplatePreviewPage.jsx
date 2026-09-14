import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ResumeView } from './ResumeView.jsx';
import { sampleHeader, sampleBlocks } from './sampleResume.js';
import { getPreset, DEFAULT_TEMPLATE, DEFAULT_LAYOUT } from './templateRegistry.js';

// Renders a template against placeholder data only — never a real resume.
// Two ways in:
//   /template-preview/preset/:id        — a curated preset (see templates/presets/)
//   /template-preview?header=X&layout=Y — any registered header/layout combo,
//                                          for previewing one before it has a preset
export function TemplatePreviewPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const preset = id ? getPreset(id) : null;
  const site = preset
    ? {
        template: preset.header,
        layout: preset.layout,
        colors: preset.colors,
        font: preset.font,
        fontSize: preset.fontSize,
        lineSpacing: preset.lineSpacing,
        pillPadding: preset.pillPadding,
      }
    : {
        template: searchParams.get('header') || DEFAULT_TEMPLATE,
        layout: searchParams.get('layout') || DEFAULT_LAYOUT,
      };

  useEffect(() => {
    // Mirrors PublicResumePage's window.__PDF_READY__ flag — lets an
    // external screenshot/automation tool know the page has finished
    // rendering, without it having to guess at a timeout.
    window.__PREVIEW_READY__ = true;
    return () => {
      delete window.__PREVIEW_READY__;
    };
  }, []);

  if (id && !preset) {
    return <div style={{ padding: 40, fontFamily: 'var(--font-ui)' }}>No template preset named "{id}".</div>;
  }

  return <ResumeView header={sampleHeader} site={site} blocks={sampleBlocks} mode="preview" />;
}
