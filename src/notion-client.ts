import { Client, isFullBlock, isFullPage, isFullDatabase, isFullUser, isFullComment } from "@notionhq/client";
import type {
  BlockObjectResponse,
  PageObjectResponse,
  DatabaseObjectResponse,
  UserObjectResponse,
  CommentObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";

// ── Rate Limiter ──────────────────────────────────────────────────────────

const TOKENS_PER_SEC = 3;
const MAX_TOKENS = 3;

let tokens = MAX_TOKENS;
let lastRefill = Date.now();

function refillTokens() {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  tokens = Math.min(MAX_TOKENS, tokens + elapsed * TOKENS_PER_SEC);
  lastRefill = now;
}

const queue: Array<{ resolve: () => void }> = [];
let draining = false;

async function drainQueue() {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    refillTokens();
    if (tokens >= 1) {
      tokens -= 1;
      queue.shift()!.resolve();
    } else {
      const waitMs = ((1 - tokens) / TOKENS_PER_SEC) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  draining = false;
}

async function acquireToken(): Promise<void> {
  refillTokens();
  if (tokens >= 1) {
    tokens -= 1;
    return;
  }
  return new Promise((resolve) => {
    queue.push({ resolve });
    drainQueue();
  });
}

// ── API Call Wrapper ──────────────────────────────────────────────────────

export async function apiCall<T>(fn: () => Promise<T>): Promise<T> {
  await acquireToken();
  return fn();
}

// ── Client Singleton ──────────────────────────────────────────────────────

const token = process.env.NOTION_API_TOKEN;
if (!token) {
  console.error("NOTION_API_TOKEN environment variable is required");
  process.exit(1);
}

export const notion = new Client({ auth: token });

// ── Pagination Helper ─────────────────────────────────────────────────────

export async function collectAllBlocks(blockId: string): Promise<BlockObjectResponse[]> {
  const blocks: BlockObjectResponse[] = [];
  let cursor: string | undefined = undefined;

  do {
    const response = await apiCall(() =>
      notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      })
    );

    for (const block of response.results) {
      if (isFullBlock(block)) {
        blocks.push(block);
      }
    }

    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return blocks;
}

// ── Re-exports ────────────────────────────────────────────────────────────

export { isFullBlock, isFullPage, isFullDatabase, isFullUser, isFullComment };
export type {
  BlockObjectResponse,
  PageObjectResponse,
  DatabaseObjectResponse,
  UserObjectResponse,
  CommentObjectResponse,
};
