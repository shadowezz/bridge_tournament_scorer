/**
 * The storage primitives the game store needs: a hash per game, addressed by
 * field. Both adapters implement exactly this, so all game logic - including
 * the recompute-on-write rule - lives in one place above them.
 */
export interface Backend {
  readAll(key: string): Promise<Record<string, string> | null>;
  write(key: string, fields: Record<string, string>, remove?: string[]): Promise<void>;
  exists(key: string): Promise<boolean>;
}
