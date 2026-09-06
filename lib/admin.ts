/**
 * Whether a client holds admin on a game.
 *
 * An empty client id means the proxy has not issued one yet, and must never
 * be admin - the same safe direction `clientId()` fails in.
 */
export function isAdmin(admins: readonly string[], clientId: string): boolean {
  return clientId !== "" && admins.includes(clientId);
}
