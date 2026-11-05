import { domainToASCII } from 'node:url';
import { httpError } from './httpError.js';

// The domains a resume can be mapped to (issue #53): a request whose host
// is one of them is served that resume instead of the default. Pure, so
// hostnames.test.js covers them without a database.

export const MAX_HOSTNAMES = 20;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// A domain as stored in resume_hosts: lowercase ASCII (an internationalized
// name becomes its xn-- form, which is what browsers send in Host), no
// trailing dot, at least two labels, no port, scheme, path or wildcard.
// Anything else is a 400 rather than a silent rewrite, so what's saved is
// exactly what will match.
export function normalizeHostname(raw) {
  const invalid = () =>
    httpError(
      400,
      `${JSON.stringify(String(raw).slice(0, 100))} isn't a domain name like sales.example.com (no "https://", port, path or "*")`
    );
  if (typeof raw !== 'string') throw httpError(400, 'each domain must be a string');
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!trimmed || /[/:*@?#\\\s]/.test(trimmed)) throw invalid();
  const ascii = domainToASCII(trimmed);
  if (!ascii || ascii.length > 253) throw invalid();
  const labels = ascii.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) throw invalid();
  return ascii;
}

// A whole `hostnames` list from an update: each one normalized, duplicates
// dropped, sorted so the stored and returned order doesn't depend on input.
export function normalizeHostnames(list) {
  if (!Array.isArray(list)) throw httpError(400, 'hostnames must be an array of domain names');
  if (list.length > MAX_HOSTNAMES) throw httpError(400, `a resume can have at most ${MAX_HOSTNAMES} domains`);
  return [...new Set(list.map((raw) => normalizeHostname(raw)))].sort();
}

// The key to look a request's host up by: Express's req.hostname (already
// without the port; X-Forwarded-Host's when 'trust proxy' is on),
// lowercased and without a trailing dot. Never throws: a host that can't
// match anything simply gets the default resume.
export function requestHostKey(hostname) {
  if (typeof hostname !== 'string' || !hostname) return null;
  return hostname.toLowerCase().replace(/\.$/, '');
}

// The request headers a host-resolved response depends on, for its Vary:
// req.hostname reads X-Forwarded-Host instead of Host when the request
// comes from a trusted proxy, so a cache has to key on both.
export const HOST_HEADERS = ['Host', 'X-Forwarded-Host'];
