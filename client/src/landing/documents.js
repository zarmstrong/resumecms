// A documents section (issue #128), the pure part: how a file's size (in
// bytes, as resolveLanding() gives it) reads next to its link, e.g.
// "240 KB" or "1.2 MB". Never "0 KB": a stored PDF is at least a few
// hundred bytes. '' for anything that isn't a size.
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return `${mb} MB`;
}
