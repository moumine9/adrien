import {
  type Adr,
  AdrIndex,
  AdrienError,
  adrsForFiles,
  type Context,
  createAdr,
  type Filters,
  type LogView,
  loadLogView,
  resolveContext,
  STATUSES,
  unverifiedBaseNote,
  updateAdr,
  workingRevision,
} from '@adrien/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerOptions } from './server.ts';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const ok = (result: Record<string, unknown>): ToolResult => ({
  structuredContent: result,
  content: [{ type: 'text', text: JSON.stringify(result) }],
});

const fail = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] });

const strings = z.array(z.string());
const status = z.array(z.enum(STATUSES));

async function load(opts: ServerOptions): Promise<{ ctx: Context; view: LogView }> {
  const ctx = await resolveContext({ cwd: opts.cwd, log: opts.log, env: opts.env ?? process.env });
  return { ctx, view: await loadLogView(ctx.logRoot, ctx.config) };
}

/** Every call re-reads the log, so a tool never answers from state another process has since changed. */
function handler<A>(
  opts: ServerOptions,
  run: (args: A, ctx: Context, view: LogView) => ToolResult | Promise<ToolResult>,
): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      const { ctx, view } = await load(opts);
      return await run(args, ctx, view);
    } catch (e) {
      if (e instanceof AdrienError) return fail(`${e.code}: ${e.message}`);
      throw e;
    }
  };
}

async function withIndex<T>(ctx: Context, view: LogView, use: (index: AdrIndex) => T): Promise<T> {
  const index = await AdrIndex.open(ctx.logRoot);
  try {
    index.sync(view);
    return use(index);
  } finally {
    index.close();
  }
}

const adrView = (adr: Adr) => ({ meta: adr.meta, body: adr.body, path: adr.path });

const section = (heading: string, text?: string): string =>
  text?.trim() ? `## ${heading}\n\n${text.trim()}\n` : `## ${heading}\n`;

export function registerTools(server: McpServer, opts: ServerOptions): void {
  server.registerTool(
    'adr_for_files',
    {
      title: 'Decisions governing files',
      description:
        'Call this BEFORE editing code. For each file, returns the architecture decisions that govern it, with the review_rule to follow. binding:true means an accepted decision on the default branch; binding:false is a pending proposal or a hint. If `notes` is present, read it: it says the default branch could not be found, so bindingness is unverified.',
      inputSchema: { paths: z.array(z.string().min(1)).min(1).max(50) },
    },
    handler(opts, ({ paths }: { paths: string[] }, ctx, view) => {
      const note = unverifiedBaseNote(view);
      return ok({ files: adrsForFiles(ctx, view, paths), ...(note ? { notes: [note] } : {}) });
    }),
  );

  server.registerTool(
    'adr_search',
    {
      title: 'Search decisions',
      description: 'Full-text search over ADR titles, review rules and bodies. Accent-insensitive; prefix matching.',
      inputSchema: {
        query: z.string().min(1),
        tags: strings.optional(),
        components: strings.optional(),
        status: status.optional(),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    handler(
      opts,
      async (
        args: {
          query: string;
          tags?: string[];
          components?: string[];
          status?: (typeof STATUSES)[number][];
          limit: number;
        },
        ctx,
        view,
      ) =>
        ok({
          results: await withIndex(ctx, view, (index) =>
            index.search(
              args.query,
              { tags: args.tags, components: args.components, status: args.status, layer: 'all' },
              args.limit,
            ),
          ),
        }),
    ),
  );

  server.registerTool(
    'adr_list',
    {
      title: 'List decisions',
      description:
        'Compact rows (id, title, status, tags, components, review_rule). Tags must all match; components any.',
      inputSchema: {
        tags: strings.optional(),
        components: strings.optional(),
        status: status.optional(),
        pending_only: z.boolean().optional(),
      },
    },
    handler(
      opts,
      async (
        args: { tags?: string[]; components?: string[]; status?: (typeof STATUSES)[number][]; pending_only?: boolean },
        ctx,
        view,
      ) => {
        const filters: Filters = {
          tags: args.tags,
          components: args.components,
          status: args.status,
          layer: args.pending_only ? 'pending' : 'all',
        };
        return ok({ results: await withIndex(ctx, view, (index) => index.list(filters)) });
      },
    ),
  );

  server.registerTool(
    'adr_get',
    {
      title: 'Read one decision',
      description:
        'The full ADR: the binding version on the default branch, and any pending change to it, with `revision`, the version of the working copy that adr_propose_change must be based on.',
      inputSchema: { id: z.string().min(1) },
    },
    handler(opts, ({ id }: { id: string }, _ctx, view) => {
      const base = view.base.find((a) => a.meta.id === id) ?? null;
      const change = view.pending.find((c) => c.id === id) ?? null;
      if (!base && !change) throw new AdrienError('ADR_NOT_FOUND', `No ADR ${id} in the log`);
      return ok({
        id,
        revision: workingRevision(view, id),
        base: base && adrView(base),
        pending: change && {
          kind: change.kind,
          ...(change.current ? adrView(change.current) : {}),
        },
      });
    }),
  );

  server.registerTool(
    'adr_propose',
    {
      title: 'Propose a new decision',
      description:
        'Record a durable architecture decision as a PROPOSED ADR in the working copy. It is never accepted by this call: an architect accepts it by merging its merge request. Returns possible duplicates instead of writing; pass force:true only if the decision really is distinct.',
      inputSchema: {
        title: z.string().min(1),
        context: z.string().min(1),
        decision: z.string().min(1),
        rationale: z.string().min(1),
        review_rule: z.string().min(1),
        options: z.string().optional(),
        consequences: z.string().optional(),
        tags: strings.optional(),
        components: strings.optional(),
        code: strings.optional(),
        sources: strings.optional(),
        related: strings.optional(),
        force: z.boolean().optional(),
      },
    },
    handler(
      opts,
      (
        a: {
          title: string;
          context: string;
          decision: string;
          rationale: string;
          review_rule: string;
          options?: string;
          consequences?: string;
          tags?: string[];
          components?: string[];
          code?: string[];
          sources?: string[];
          related?: string[];
          force?: boolean;
        },
        ctx,
        view,
      ) => {
        const body = `\n${[
          section('Context', a.context),
          section('Considered options', a.options),
          section('Decision', a.decision),
          section('Rationale', a.rationale),
          section('Consequences', a.consequences),
        ].join('\n')}`;
        const result = createAdr(
          ctx,
          view,
          {
            title: a.title,
            tags: a.tags,
            components: a.components,
            code: a.code,
            review_rule: a.review_rule,
            sources: a.sources,
            related: a.related,
            body,
            origin: 'agent',
          },
          { today: opts.today?.(), force: a.force },
        );
        return ok(
          result.written
            ? { written: true, id: result.adr.meta.id, path: result.adr.path }
            : { written: false, duplicates: result.duplicates },
        );
      },
    ),
  );

  server.registerTool(
    'adr_propose_change',
    {
      title: 'Propose a change to a decision',
      description:
        'Edit an existing ADR in the working copy. The edit is pending until its merge request is approved; the default-branch version stays the binding one. You cannot change status. Pass `base_revision`, the revision adr_get returned when you read the ADR: if the ADR changed since (by another agent, the CLI or an editor), the call fails with ADR_CONFLICT and nothing is written. Then read it again, redo your change on the latest version and retry, as after a rejected push.',
      inputSchema: {
        id: z.string().min(1),
        // Optional in the schema so that a missing one gets a clear message from the handler, not the SDK's generic one.
        base_revision: z
          .string()
          .regex(/^[0-9a-f]{12}$/, 'Pass the `revision` that adr_get returned for this ADR as base_revision')
          .optional()
          .describe('REQUIRED: the `revision` that adr_get returned when you read this ADR.'),
        patch: z.strictObject({
          title: z.string().min(1).optional(),
          tags: strings.optional(),
          components: strings.optional(),
          code: strings.optional(),
          review_rule: z.string().min(1).optional(),
          sources: strings.optional(),
          related: strings.optional(),
          body: z.string().optional(),
        }),
        rationale: z.string().min(1),
      },
    },
    handler(
      opts,
      (a: { id: string; base_revision?: string; patch: Record<string, unknown>; rationale: string }, ctx, view) => {
        if (a.base_revision === undefined) {
          throw new AdrienError(
            'INVALID_INPUT',
            'Call adr_get first and pass its `revision` as base_revision: a change must say which version of the ADR it is based on.',
          );
        }
        const updated = updateAdr(ctx, view, a.id, a.patch, {
          expectedRevision: a.base_revision,
          note: a.rationale,
          origin: 'agent',
          today: opts.today?.(),
        });
        return ok({ id: updated.meta.id, path: updated.path, pending: true });
      },
    ),
  );
}
