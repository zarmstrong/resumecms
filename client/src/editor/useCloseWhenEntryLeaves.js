import { useEffect, useRef } from 'react';

// Closes a row's AI rewrite panel once the row's proposal goes away:
// accepted, discarded, or moved to another row with its bullet or item
// (EditorPage re-keys it). Otherwise the row would keep an empty panel open.
// Used by the bullet rows in ExperienceForm and the item rows in CustomForm.
export function useCloseWhenEntryLeaves(entry, setOpen) {
  const had = useRef(false);
  useEffect(() => {
    if (had.current && !entry) setOpen(false);
    had.current = Boolean(entry);
  }, [entry, setOpen]);
}
