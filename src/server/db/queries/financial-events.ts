import "server-only";

import type { EventRole, EventType, FinancialEventWithMembers, MatchSettings } from "@/lib/types";
import type { MatchSettingsMap, ProposedEvent } from "@/server/lib/matching";
import { getDb } from "../index";

// DB-applying half of the deduplication engine. The pure proposal logic lives in
// src/server/lib/matching.ts; this module persists events, lists them for review,
// and reverses them losslessly. See docs/transaction-deduplication-design.md.

const EVENT_TYPES: EventType[] = [
  "internal_transfer",
  "credit_card_payment",
  "credit_card_statement",
  "atm_withdrawal",
  "loan_repayment",
  "investment_transfer",
  "refund_reversal",
  "fee",
  "duplicate",
];

// Fallback thresholds for workspaces created before a per-type row exists. Mirror
// the seed in migration 022_financial_events.sql.
const DEFAULT_SETTINGS: Record<EventType, MatchSettings> = {
  internal_transfer: mk("internal_transfer", 0.01, 2, 0.8, 0.97, true),
  credit_card_payment: mk("credit_card_payment", 0.01, 5, 0.8, 0.97, true),
  credit_card_statement: mk("credit_card_statement", 1.0, 38, 0.8, 0.97, false),
  atm_withdrawal: mk("atm_withdrawal", 0.01, 2, 0.8, 0.97, true),
  loan_repayment: mk("loan_repayment", 0.01, 5, 0.8, 0.97, true),
  investment_transfer: mk("investment_transfer", 0.01, 5, 0.8, 0.97, true),
  refund_reversal: mk("refund_reversal", 0.01, 90, 0.8, 0.97, false),
  fee: mk("fee", 0.01, 2, 0.8, 0.97, false),
  duplicate: mk("duplicate", 0.0, 10, 0.8, 0.97, false),
};

function mk(
  eventType: EventType,
  epsilon: number,
  dayWindow: number,
  minScore: number,
  autoScore: number,
  requireKeyword: boolean,
): MatchSettings {
  return { eventType, epsilon, dayWindow, minScore, autoScore, requireKeyword, enabled: true };
}

interface MatchSettingsRow {
  event_type: EventType;
  epsilon: number;
  day_window: number;
  min_score: number;
  auto_score: number;
  require_keyword: number;
  enabled: number;
}

export function getMatchSettingsMap(workspaceId: number): MatchSettingsMap {
  const rows = getDb()
    .prepare(
      `SELECT event_type, epsilon, day_window, min_score, auto_score, require_keyword, enabled
       FROM match_settings WHERE workspace_id = ?`,
    )
    .all(workspaceId) as MatchSettingsRow[];

  const map: MatchSettingsMap = {};
  for (const type of EVENT_TYPES) map[type] = DEFAULT_SETTINGS[type];
  for (const r of rows) {
    map[r.event_type] = {
      eventType: r.event_type,
      epsilon: r.epsilon,
      dayWindow: r.day_window,
      minScore: r.min_score,
      autoScore: r.auto_score,
      requireKeyword: r.require_keyword === 1,
      enabled: r.enabled === 1,
    };
  }
  return map;
}

export interface ApplyResult {
  eventsCreated: number;
  transactionsGrouped: number;
}

/**
 * Persist proposed events. Idempotent: a proposal whose event_key already exists
 * (including a rejected tombstone) is skipped, so a re-sync never duplicates an
 * event or re-suggests a dismissed one. Grouping legs get their kind flipped and
 * transactions.event_id set; 'purchase' legs are linked but stay spendable.
 */
export function applyProposedEvents(
  workspaceId: number,
  proposals: readonly ProposedEvent[],
): ApplyResult {
  if (proposals.length === 0) return { eventsCreated: 0, transactionsGrouped: 0 };
  const db = getDb();

  const insertEvent = db.prepare(
    `INSERT INTO financial_events
       (workspace_id, event_type, canonical_transaction_id, status, source, confidence, reasons, event_key)
     VALUES (@workspaceId, @eventType, @canonicalTransactionId, @status, 'heuristic', @confidence, @reasons, @eventKey)
     ON CONFLICT(workspace_id, event_key) DO NOTHING`,
  );
  const insertMember = db.prepare(
    `INSERT INTO event_members
       (workspace_id, event_id, transaction_id, role, prior_kind, match_confidence)
     VALUES (@workspaceId, @eventId, @transactionId, @role, @priorKind, @matchConfidence)`,
  );
  const groupTxn = db.prepare(
    `UPDATE transactions
       SET event_id = @eventId, event_role = @role, match_confidence = @confidence,
           kind = CASE WHEN @flipKindTo IS NOT NULL THEN @flipKindTo ELSE kind END,
           needs_review = CASE WHEN @needsReview = 1 THEN 1 ELSE needs_review END,
           updated_at = datetime('now')
     WHERE workspace_id = @workspaceId AND id = @transactionId`,
  );

  let eventsCreated = 0;
  let transactionsGrouped = 0;

  const run = db.transaction(() => {
    for (const p of proposals) {
      const info = insertEvent.run({
        workspaceId,
        eventType: p.eventType,
        canonicalTransactionId: p.canonicalTransactionId,
        status: p.needsReview ? "suggested" : "confirmed",
        confidence: p.confidence,
        reasons: JSON.stringify(p.reasons),
        eventKey: p.eventKey,
      });
      if (info.changes === 0) continue; // existing event or rejected tombstone
      const eventId = Number(info.lastInsertRowid);
      eventsCreated++;

      for (const m of p.members) {
        insertMember.run({
          workspaceId,
          eventId,
          transactionId: m.transactionId,
          role: m.role,
          priorKind: m.priorKind,
          matchConfidence: p.confidence,
        });
        if (m.grouping) {
          groupTxn.run({
            workspaceId,
            eventId,
            transactionId: m.transactionId,
            role: m.role,
            confidence: p.confidence,
            flipKindTo: m.flipKindTo,
            needsReview: p.needsReview ? 1 : 0,
          });
          transactionsGrouped++;
        }
      }
    }
  });
  run();

  return { eventsCreated, transactionsGrouped };
}

interface EventRow {
  id: number;
  workspace_id: number;
  event_type: EventType;
  canonical_transaction_id: number | null;
  status: "suggested" | "confirmed" | "rejected";
  source: "heuristic" | "rule" | "user" | "ai";
  confidence: number;
  reasons: string | null;
  event_key: string;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  event_id: number;
  id: number;
  workspace_id: number;
  transaction_id: number;
  role: EventRole;
  prior_kind: "expense" | "income" | "transfer" | null;
  match_confidence: number | null;
  created_at: string;
  description: string;
  date: string;
  charged_amount: number;
  charged_currency: string | null;
  provider: string;
  account_label: string | null;
}

export interface ListEventsParams {
  statuses?: ("suggested" | "confirmed" | "rejected")[];
  limit?: number;
  offset?: number;
}

export function listEvents(
  workspaceId: number,
  params: ListEventsParams = {},
): FinancialEventWithMembers[] {
  const db = getDb();
  const statuses =
    params.statuses && params.statuses.length > 0 ? params.statuses : ["suggested", "confirmed"];
  const placeholders = statuses.map(() => "?").join(",");
  const limit = Math.min(params.limit ?? 100, 500);
  const offset = params.offset ?? 0;

  const events = db
    .prepare(
      `SELECT * FROM financial_events
       WHERE workspace_id = ? AND status IN (${placeholders})
       ORDER BY (status = 'suggested') DESC, confidence ASC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(workspaceId, ...statuses, limit, offset) as EventRow[];

  if (events.length === 0) return [];

  const ids = events.map((e) => e.id);
  const memberPlaceholders = ids.map(() => "?").join(",");
  const members = db
    .prepare(
      `SELECT m.*, t.description, t.date, t.charged_amount, t.charged_currency, t.provider,
              bc.label AS account_label
       FROM event_members m
       JOIN transactions t ON t.id = m.transaction_id
       LEFT JOIN bank_credentials bc ON t.credential_id = bc.id
       WHERE m.workspace_id = ? AND m.event_id IN (${memberPlaceholders})
       ORDER BY m.id ASC`,
    )
    .all(workspaceId, ...ids) as MemberRow[];

  const membersByEvent = new Map<number, MemberRow[]>();
  for (const m of members) {
    const list = membersByEvent.get(m.event_id) ?? [];
    list.push(m);
    membersByEvent.set(m.event_id, list);
  }

  return events.map((e) => ({
    id: e.id,
    workspaceId: e.workspace_id,
    eventType: e.event_type,
    canonicalTransactionId: e.canonical_transaction_id,
    status: e.status,
    source: e.source,
    confidence: e.confidence,
    reasons: e.reasons ? (JSON.parse(e.reasons) as string[]) : [],
    eventKey: e.event_key,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    members: (membersByEvent.get(e.id) ?? []).map((m) => ({
      id: m.id,
      workspaceId: m.workspace_id,
      eventId: m.event_id,
      transactionId: m.transaction_id,
      role: m.role,
      priorKind: m.prior_kind,
      matchConfidence: m.match_confidence,
      createdAt: m.created_at,
      description: m.description,
      date: m.date,
      chargedAmount: m.charged_amount,
      chargedCurrency: m.charged_currency,
      provider: m.provider,
      accountLabel: m.account_label,
    })),
  }));
}

/** Accept a suggested event. Clears the review flag on its grouping legs. */
export function confirmEvent(workspaceId: number, eventId: number): boolean {
  const db = getDb();
  const run = db.transaction(() => {
    const info = db
      .prepare(
        `UPDATE financial_events SET status = 'confirmed', updated_at = datetime('now')
         WHERE workspace_id = ? AND id = ? AND status != 'rejected'`,
      )
      .run(workspaceId, eventId);
    if (info.changes === 0) return false;
    db.prepare(
      `UPDATE transactions SET needs_review = 0, updated_at = datetime('now')
       WHERE workspace_id = ? AND id IN (
         SELECT transaction_id FROM event_members WHERE workspace_id = ? AND event_id = ?
       )`,
    ).run(workspaceId, workspaceId, eventId);
    return true;
  });
  return run();
}

/**
 * Reverse an event losslessly: restore each grouping leg's prior kind, detach it,
 * drop the membership rows, and keep the event row as a rejected tombstone so the
 * same match is never re-suggested on the next sync.
 */
export function rejectEvent(workspaceId: number, eventId: number): boolean {
  const db = getDb();
  const run = db.transaction(() => {
    const members = db
      .prepare(
        `SELECT transaction_id, role, prior_kind FROM event_members
         WHERE workspace_id = ? AND event_id = ?`,
      )
      .all(workspaceId, eventId) as {
      transaction_id: number;
      role: EventRole;
      prior_kind: "expense" | "income" | "transfer" | null;
    }[];

    const exists = db
      .prepare("SELECT 1 FROM financial_events WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, eventId);
    if (!exists) return false;

    const restore = db.prepare(
      `UPDATE transactions
         SET event_id = NULL, event_role = NULL, match_confidence = NULL, needs_review = 0,
             kind = CASE WHEN @priorKind IS NOT NULL THEN @priorKind ELSE kind END,
             updated_at = datetime('now')
       WHERE workspace_id = @workspaceId AND id = @transactionId`,
    );
    for (const m of members) {
      if (m.role === "purchase") continue; // never set event_id; nothing to restore
      restore.run({ workspaceId, transactionId: m.transaction_id, priorKind: m.prior_kind });
    }

    db.prepare("DELETE FROM event_members WHERE workspace_id = ? AND event_id = ?").run(
      workspaceId,
      eventId,
    );
    db.prepare(
      `UPDATE financial_events
         SET status = 'rejected', canonical_transaction_id = NULL, updated_at = datetime('now')
       WHERE workspace_id = ? AND id = ?`,
    ).run(workspaceId, eventId);
    return true;
  });
  return run();
}
