import type { StoredTokens, TokenStorage } from './types';

/**
 * Keeps bearer tokens in memory only: the session ends with the page or app.
 * The default for bearer mode. For a session that survives an app restart on
 * React Native, pass a {@link TokenStorage} backed by secure storage.
 */
export class MemoryTokenStorage implements TokenStorage {
  private tokens: StoredTokens | null = null;

  load(): StoredTokens | null {
    return this.tokens;
  }

  save(tokens: StoredTokens): void {
    this.tokens = { ...tokens };
  }

  clear(): void {
    this.tokens = null;
  }
}
