export interface Snapshot {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  headSha: string;
  /** Commit date of the head commit, ISO 8601. */
  headDate: string;
  /** The login the watcher posts as: its own comments are not findings. */
  me: string;
  mergeState: string;
  checks: { name: string; state: string }[];
  reviewComments: {
    id: number;
    inReplyTo: number | null;
    author: string;
    path: string;
    line: number | null;
    body: string;
  }[];
  issueComments: { author: string; body: string }[];
  reactions: { content: string; author: string; createdAt: string }[];
}

export type WatchEvent =
  | { event: 'merged' | 'closed'; pr: number }
  | {
      event: 'findings';
      pr: number;
      comments: { id: number; author: string; path: string; line: number | null; text: string }[];
    }
  | { event: 'ci_failed'; pr: number; checks: string[] }
  | { event: 'ready'; pr: number; reason: string }
  | { event: 'waiting'; pr: number; reason: string };

export function evaluate(snapshot: Snapshot): WatchEvent;
export function cleanComment(body: string): string;
