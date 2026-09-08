import { toLegacyPublicPath } from './public/vitriny-public-routes.js';
export { CLEAN_PUBLIC_ROUTES, toCleanPublicHref, toLegacyPublicPath } from './public/vitriny-public-routes.js';

// Register immediately after `const app = express()`, before production
// hardening, membership/auth middleware, HTML injection or static serving.
// Rewriting through existing handlers preserves their authorization and headers;
// originalUrl remains the browser's clean URL for return paths and access logs.
export function cleanPublicRoutes(req, _res, next) {
  if (!['GET', 'HEAD'].includes(req.method) || typeof req.url !== 'string' || /[#\u0000-\u0020\u007f]/.test(req.url)) return next();
  const separator = req.url.indexOf('?');
  const pathname = separator < 0 ? req.url : req.url.slice(0, separator);
  const destination = toLegacyPublicPath(pathname);
  if (destination !== pathname) req.url = destination + (separator < 0 ? '' : req.url.slice(separator));
  return next();
}
