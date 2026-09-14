import { getHeaderTemplate } from './templateRegistry.js';

export function HeaderBlock({ header, showActions, onPrint, pdfHref, template = 'classic' }) {
  if (!header) return null;
  const { Component } = getHeaderTemplate(template);
  return <Component header={header} showActions={showActions} onPrint={onPrint} pdfHref={pdfHref} />;
}
