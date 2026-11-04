import { useEffect, useRef, useState } from 'react';

// Whether a bullet's or custom item's AI rewrite panel is open. The row's ✨
// button toggles it, even while the row has a rewrite in flight or under
// review (closing only hides the panel; the rewrite stays open, in the
// preview and the banner count, until accepted or discarded).
//
// It follows the row's rewrite by request: it opens when a different
// request arrives here (a new one, one that followed its bullet or item to
// this row via EditorPage's relocation, or one already open when the row
// mounts), so a rewrite never lands in a collapsed row unseen, and closes
// when the row's rewrite goes away (accepted, discarded, or moved to
// another row). The same request staying put leaves it as the user set it.
// Used by the bullet rows in ExperienceForm and the item rows in CustomForm.
export function useRowPanelOpen(entry) {
  const requestId = entry ? entry.requestId ?? true : null;
  const [open, setOpen] = useState(requestId !== null);
  const seen = useRef(requestId);
  useEffect(() => {
    if (requestId === seen.current) return;
    seen.current = requestId;
    setOpen(requestId !== null);
  }, [requestId]);
  return [open, setOpen];
}
