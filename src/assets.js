// Resolve a public asset against Vite's configured base path. Serves from "/"
// in dev and from "/<repo>/" on GitHub Pages, so absolute leading-slash paths
// keep working under a project subpath.
export const asset = (p) => import.meta.env.BASE_URL + String(p).replace(/^\//, '');
