import { useEffect, useRef, useState } from 'react';

// Whether a bullet's or custom item's AI rewrite panel is open. The row's ✨
// button toggles it, even while the row has a rewrite in flight or under
// review (closing only hides the panel; the rewrite stays open, in the
// preview and the banner count, until accepted or discarded). It opens by
// itself when a rewrite arrives for the row, including one that followed
// its bullet or item here (EditorPage's relocation) or was already open when
// the row mounted, and closes when the row's rewrite goes away: accepted,
// discarded, or moved to another row. Used by the bullet rows in
// ExperienceForm and the item rows in CustomForm.
export function useRowPanelOpen(entry) {
  const [open, setOpen] = useState(Boolean(entry));
  const had = useRef(Boolean(entry));
  useEffect(() => {
    const has = Boolean(entry);
    if (has !== had.current) setOpen(has);
    had.current = has;
  }, [entry]);
  return [open, setOpen];
}
