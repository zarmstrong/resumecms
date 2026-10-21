// Shapes the published block list for one public surface (web or print).
//
// Hidden blocks are NOT dropped outright: column layouts group blocks into
// sections and pick a column per section (client/src/resume/blockColumns.js),
// and the editor preview — which renders every block, hidden ones dimmed —
// must agree with the published page about where each section lands. If a
// hidden heading simply vanished here, its children would become orphans and
// every later section could shift columns, so a hidden block is kept as a
// placeholder that carries only what grouping needs (id/type/parentId plus a
// heading's `data.column`) and is marked `hidden` so ResumeView skips it.
// Its content never leaves the server.

// Bullets used to be plain strings; treat those (and bullets missing a flag)
// as visible everywhere so old data keeps rendering without a migration.
function bulletVisible(bullet, mode) {
  if (typeof bullet === 'string') return true;
  return mode === 'print' ? bullet.visiblePrint !== false : bullet.visibleWeb !== false;
}

// Bullets can nest one level deep (2 levels total). Recurse into `children`
// so nested bullets get the same visibility filtering as top-level ones.
function filterBulletForMode(bullet, mode) {
  if (typeof bullet === 'string') return { text: bullet, children: [] };
  const children = Array.isArray(bullet.children)
    ? bullet.children.filter((c) => bulletVisible(c, mode)).map((c) => filterBulletForMode(c, mode))
    : [];
  return { text: bullet.text, children };
}

function filterBulletsForMode(block, mode) {
  if (block.type !== 'experience' || !Array.isArray(block.data?.bullets)) return block;
  return {
    ...block,
    data: {
      ...block.data,
      bullets: block.data.bullets
        .filter((b) => bulletVisible(b, mode))
        .map((b) => filterBulletForMode(b, mode)),
    },
  };
}

function blockVisible(block, mode) {
  return mode === 'print' ? Boolean(block.visiblePrint) : Boolean(block.visibleWeb);
}

function hiddenPlaceholder(block) {
  const data = {};
  if (block.type === 'heading' && block.data?.column != null) data.column = block.data.column;
  return {
    id: block.id,
    type: block.type,
    position: block.position,
    parentId: block.parentId ?? null,
    visibleWeb: Boolean(block.visibleWeb),
    visiblePrint: Boolean(block.visiblePrint),
    hidden: true,
    data,
  };
}

export function blocksForMode(blocks, mode) {
  return (blocks || []).map((b) => (blockVisible(b, mode) ? filterBulletsForMode(b, mode) : hiddenPlaceholder(b)));
}
