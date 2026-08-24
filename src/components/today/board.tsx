import Link from "next/link";
import { copy, fmt } from "@/lib/copy";
import type { Brief } from "@/lib/brief";
import type { ActivityRow, PendingApproval } from "@/lib/data";
import type { Task } from "@/db/schema";
import { shortId } from "@/lib/tasks";

/**
 * BUGÜN — what is happening, what needs him, what just happened.
 *
 * The view that replaced a board of agent cards. Agents were the wrong subject:
 * the owner does not think "what is Scout doing", he thinks "is anything stuck
 * on me". So the ordering here is by claim on his attention — the manager's two
 * sentences, the counts, what is blocked on him, today, what is running, what
 * just finished.
 *
 * Nothing on this page commands anything. Control moved to Telegram, and a
 * button that starts an agent would put a second, quieter path next to the one
 * that has the gates on it.
 */

const TONE: Record<string, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  crit: "var(--crit)",
  accent: "var(--accent)",
};

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <p className="label">{title}</p>
        {right}
      </div>
      <hr className="rule" />
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 px-5 py-4 text-[13.5px]" style={{ color: "var(--ink-3)" }}>
      {children}
    </p>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: string }) {
  return (
    <div className="card px-4 py-3.5 sm:px-5">
      <p className="label">{label}</p>
      <p
        className="mc-num m-0 mt-1.5 mb-0.5 text-[26px] font-medium leading-none sm:text-[30px]"
        style={{ color: value > 0 && tone ? TONE[tone] : "var(--ink)" }}
      >
        {value}
      </p>
      <p className="m-0 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
        {sub}
      </p>
    </div>
  );
}

export function TodayBoard({
  brief,
  narration,
  running,
  queued,
  parked,
  approvals,
  batch,
  activity,
  sentToday,
  memoryCount,
}: {
  brief: Brief;
  narration: string | null;
  running: Task[];
  queued: Task[];
  parked: Task[];
  approvals: PendingApproval[];
  batch: { pending: number; calls: number; planLine: string | null } | null;
  activity: ActivityRow[];
  sentToday: number;
  memoryCount: number;
}) {
  const c = copy.today;

  return (
    <div className="flex flex-col gap-5 px-4 pb-14 sm:px-8">
      {narration && (
        <div
          className="rounded-r-[10px] px-5 py-4"
          style={{ borderLeft: "2px solid var(--accent)", background: "var(--accent-soft)" }}
        >
          <p className="label" style={{ color: "var(--accent)" }}>
            Yönetici
          </p>
          <p className="m-0 mt-1.5 max-w-[74ch] whitespace-pre-line text-[14.5px] leading-relaxed">
            {narration}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          label={c.running}
          value={running.length}
          sub={
            queued.length > 0
              ? `${queued.length} kuyrukta`
              : running.length > 0
                ? "şu anda"
                : "boşta"
          }
          tone="ok"
        />
        <Stat
          label={c.parked}
          value={parked.length}
          sub={parked.length > 0 ? "cevabını bekliyor" : "soru yok"}
          tone="crit"
        />
        <Stat
          label={c.awaiting}
          value={approvals.length}
          sub={batch ? "günün listesi" : "onay kartı"}
          tone="warn"
        />
        <Stat label={c.sentToday} value={sentToday} sub="bugün gönderilen mail" />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card title={c.needsYou}>
            {parked.length === 0 && approvals.length === 0 && brief.needsYou.length === 0 ? (
              <Empty>{c.nothingNeedsYou}</Empty>
            ) : (
              <>
                {parked.map((task, i) => (
                  <Row
                    key={task.id}
                    tone="crit"
                    first={i === 0}
                    title={`#${shortId(task.id)} ${c.askedYou}`}
                    body={task.question ?? task.title}
                    meta={task.askedAt ? fmt.ago(task.askedAt) : undefined}
                  />
                ))}
                {batch && batch.pending > 0 && (
                  <Row
                    tone="accent"
                    first={parked.length === 0}
                    title={c.batchWaiting(batch.pending)}
                    body={c.batchWhere}
                    meta={batch.planLine ?? undefined}
                  />
                )}
                {approvals
                  .filter(() => !batch || batch.pending === 0)
                  .map((a) => (
                    <Row key={a.id} tone="accent" title={a.title} body={a.draft.slice(0, 160)} meta={a.agentName} />
                  ))}
              </>
            )}
          </Card>

          <Card title={c.today}>
            {brief.today.meetings.length === 0 ? (
              <Empty>{c.noMeetings}</Empty>
            ) : (
              brief.today.meetings.map((m, i) => (
                <div
                  key={`${m.title}-${i}`}
                  className="flex items-start gap-3 px-5 py-3"
                  style={i > 0 ? { borderTop: "1px solid var(--line)" } : undefined}
                >
                  <span className="mc-num text-[13.5px]" style={{ color: "var(--accent)" }}>
                    {fmt.clock(m.at)}
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-[13.5px]">{m.title}</p>
                    {m.meetUrl && (
                      <a
                        href={m.meetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mc-num m-0 block truncate text-[11.5px]"
                      >
                        {m.meetUrl.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </Card>

          <Card
            title={c.now}
            right={
              running.length > 0 ? (
                <span className="chip" style={{ borderColor: "var(--ok-line)", color: "var(--ok)" }}>
                  <span className="dot running" style={{ background: "var(--ok)" }} />
                  {c.live}
                </span>
              ) : undefined
            }
          >
            {running.length === 0 && queued.length === 0 ? (
              <Empty>{c.nothingRunning}</Empty>
            ) : (
              running.map((task, i) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                  style={i > 0 ? { borderTop: "1px solid var(--line)" } : undefined}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="dot running" style={{ background: "var(--ok)" }} />
                    <div className="min-w-0">
                      <p className="m-0 truncate text-[13.5px]">{task.title}</p>
                      <p className="mc-num m-0 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                        {task.agentId ?? "sistem"} · #{shortId(task.id)}
                      </p>
                    </div>
                  </div>
                  {task.startedAt && (
                    <span className="mc-num flex-none text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                      {fmt.ago(task.startedAt)}
                    </span>
                  )}
                </div>
              ))
            )}

            {/* Handed over, not started. Dimmed and unanimated on purpose: the
                one moving indicator on the panel means "running", and a queued
                row is precisely the thing that is not. */}
            {queued.length > 0 && (
              <div style={{ borderTop: "1px solid var(--line)" }}>
                <p className="label m-0 px-5 pt-3">{c.queued}</p>
                {queued.map((task) => (
                  <div key={task.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="dot" style={{ background: "var(--ink-3)" }} />
                      <div className="min-w-0">
                        <p className="m-0 truncate text-[13.5px]" style={{ color: "var(--ink-2)" }}>
                          {task.title}
                        </p>
                        <p className="mc-num m-0 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                          {task.agentId ?? "sistem"} · #{shortId(task.id)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                <p className="m-0 px-5 pb-3 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                  {c.queuedNote(queued.length)}
                </p>
              </div>
            )}
          </Card>
        </div>

        <Card title={c.recent}>
          {activity.length === 0 ? (
            <Empty>{c.noActivity}</Empty>
          ) : (
            activity.map((row, i) => (
              <div
                key={row.id}
                className="flex items-start gap-3 px-5 py-2.5"
                style={i > 0 ? { borderTop: "1px solid var(--line)" } : undefined}
              >
                <span
                  className="dot mt-[7px]"
                  style={{ background: TONE[row.outcome === "success" ? "ok" : row.outcome === "blocked" ? "warn" : "crit"] }}
                />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[13px]">{row.summary.slice(0, 120)}</p>
                  <p className="m-0 mt-0.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                    {row.agentName}
                  </p>
                </div>
                <span className="mc-num flex-none text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                  {fmt.ago(row.startedAt)}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      <div className="flex justify-center pt-1">
        <Link
          href="/brain"
          className="flex min-h-[44px] items-center gap-2.5 rounded-[10px] px-5 text-[13px]"
          style={{ border: "1px dashed var(--line-hi)", color: "var(--ink-2)" }}
        >
          <span className="dot" style={{ background: "var(--ok)" }} />
          Ajanların ortak hafızası —{" "}
          <b className="mc-num" style={{ color: "var(--ink)", fontWeight: 600 }}>
            {fmt.number(memoryCount)}
          </b>{" "}
          anı
        </Link>
      </div>
    </div>
  );
}

function Row({
  tone,
  title,
  body,
  meta,
  first,
}: {
  tone: keyof typeof TONE;
  title: string;
  body: string;
  meta?: string;
  first?: boolean;
}) {
  return (
    <div className="flex gap-3 px-5 py-4" style={first ? undefined : { borderTop: "1px solid var(--line)" }}>
      <span className="w-[2px] flex-none self-stretch rounded" style={{ background: TONE[tone] }} />
      <div className="min-w-0">
        <p className="m-0 text-[13.5px] font-semibold">{title}</p>
        <p className="m-0 mt-0.5 text-[13.5px]" style={{ color: "var(--ink-2)" }}>
          {body}
        </p>
        {meta && (
          <p className="m-0 mt-1 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
            {meta}
          </p>
        )}
      </div>
    </div>
  );
}
