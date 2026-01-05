/**
 * URL helpers for deployments that have multiple reachable domains
 * (e.g. Cloudflare Pages *.pages.dev + a custom domain).
 */

/**
 * Returns the public site origin to use for auth redirects.
 *
 * Prefer setting `VITE_SITE_URL` (e.g. https://winballot.com) in your deployment env
 * so OAuth always returns to the custom domain rather than *.pages.dev.
 */
export function getPublicSiteOrigin(): string {
  const env = import.meta.env.VITE_SITE_URL;
  if (typeof env === 'string') {
    const trimmed = env.trim().replace(/\/+$/, '');
    if (trimmed) return trimmed;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return '';
}



