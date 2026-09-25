/**
 * `@awesome-lang-auth/react/server`: the parts that are safe to call from a
 * React Server Component or any non-React server code. The main entry is a
 * `'use client'` boundary, so its functions cannot be called on the server;
 * these can. Types are the same as the main entry's.
 */
export { hasRole } from './roles';
export { SERVER_SNAPSHOT } from './ssr';
export type * from './types';
