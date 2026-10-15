import type { SessionConfig } from '@/lib/client/engine';
import type { StoredSession } from '@/lib/client/local';

export type Screen =
  | { name: 'home' }
  | { name: 'guide'; section?: string }
  | { name: 'setup'; code?: string }
  | { name: 'history' }
  | { name: 'stage'; cfg: SessionConfig }
  | { name: 'questions'; stored: StoredSession }
  | { name: 'done'; id: string };
