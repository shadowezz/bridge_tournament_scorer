/**
 * Name of the anonymous client-id cookie.
 *
 * Kept in its own module so both the proxy (Edge runtime) and server
 * components can read it without either pulling in the other's imports.
 */
export const CLIENT_COOKIE = "bt_cid";
