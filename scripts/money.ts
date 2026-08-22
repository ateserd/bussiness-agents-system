import { randomUUID } from "node:crypto";
import { desc, gte } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";
import { expenses, invoices } from "../src/db/schema";

/**
 * Records money in and money out, by hand.
 *
 * Payments arrive as cash or a bank transfer, so there is no processor to read
 * them from and no accounting tool connected. This is the source of truth for
 * the LEDGER's revenue and expense lines — entered by the owner, not inferred.
 *
 *   npm run money -- in  --branch web --amount 45000 --client "Kumsal Balık" [--at 2026-08-14]
 *   npm run money -- out --branch web --amount 1200 --category "abonelik" "Framer yıllık"
 *   npm run money -- out --amount 18000 --category "kira" --recurring "Ofis kirası"
 *   npm run money -- list [--days 30]
 *
 * `--branch` is omitted only for costs that belong to the business rather than
 * to one branch; the two branches keep separate P&Ls, so anything attributable
 * should be attributed.
 */

const USAGE = `
npm run money -- in   --amount N --branch <web|automation> --client "<ad>" [--at YYYY-MM-DD]
npm run money -- out  --amount N --category "<tür>" [--branch <şube>] [--recurring] [--at YYYY-MM-DD] "<açıklama>"
npm run money -- list [--days N]

  in         tahsil edilen para (nakit veya IBAN) — ödenmiş fatura olarak yazılır
  out        gider — kira, abonelik, araç, reklam, ne varsa
  --branch   web | automation. Giderde atlanabilir: iki şubeye de ait olmayan
             masraflar (muhasebeci, banka ücreti) şubesiz kalır
  --recurring  her ay tekrar eden gider olarak işaretle
  --at       tarih (varsayılan: bugün)

Ajan token maliyeti gider olarak girilmez — her çalışmada zaten kaydediliyor,
iki kez sayılmış olur.
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(+y, +mo - 1, +d, 12, 0, 0);
}

function amountOf(args: string[]): number | null {
  const raw = flag(args, "amount");
  if (raw === undefined) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function branchOf(args: string[]): "web" | "automation" | null | undefined {
  const raw = flag(args, "branch");
  if (raw === undefined) return null;
  const b = raw.toLowerCase();
  if (b === "web") return "web";
  if (b === "automation" || b === "otomasyon") return "automation";
  return undefined;
}

/** Everything not consumed by a flag is the free-text description. */
function freeText(args: string[], flags: string[], bare: string[]): string {
  const consumed = new Set<number>([0]);
  for (const name of flags) {
    const i = args.indexOf(`--${name}`);
    if (i >= 0) {
      consumed.add(i);
      consumed.add(i + 1);
    }
  }
  for (const name of bare) {
    const i = args.indexOf(`--${name}`);
    if (i >= 0) consumed.add(i);
  }
  return args.filter((_, i) => !consumed.has(i)).join(" ").trim();
}

async function recordIn(args: string[]) {
  const amount = amountOf(args);
  const branch = branchOf(args);
  const at = parseDate(flag(args, "at"));
  const client = flag(args, "client") ?? freeText(args, ["amount", "branch", "client", "at"], []);

  if (amount === null) return fail("--amount zorunlu ve pozitif olmalı.");
  if (branch === null) return fail("--branch zorunlu: web veya automation.");
  if (branch === undefined) return fail("--branch web ya da automation olmalı.");
  if (!at) return fail("--at YYYY-MM-DD biçiminde olmalı.");
  if (!client) return fail("Kimden tahsil edildi? --client ile yaz.");

  const db = await getDb();
  const number = `M-${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await db.insert(invoices).values({
    id: randomUUID(),
    branch,
    clientId: null,
    number,
    amountUsd: amount.toFixed(2),
    state: "paid",
    issuedAt: at,
    dueAt: at,
    paidAt: at,
  });

  console.log(`\n  Tahsilat yazıldı\n  ${client} · ${amount} · ${branch}\n  tarih ${at.toLocaleDateString("tr-TR")} · no ${number}\n`);
}

async function recordOut(args: string[]) {
  const amount = amountOf(args);
  const branch = branchOf(args);
  const at = parseDate(flag(args, "at"));
  const category = flag(args, "category");
  const recurring = args.includes("--recurring");
  const description = freeText(args, ["amount", "branch", "category", "at"], ["recurring"]);

  if (amount === null) return fail("--amount zorunlu ve pozitif olmalı.");
  if (branch === undefined) return fail("--branch web ya da automation olmalı.");
  if (!at) return fail("--at YYYY-MM-DD biçiminde olmalı.");
  if (!category) return fail("--category zorunlu: kira, abonelik, araç, reklam …");
  if (!description) return fail("Gider açıklaması yok. Tırnak içinde yaz.");

  const db = await getDb();
  await db.insert(expenses).values({
    id: randomUUID(),
    branch: branch ?? null,
    category,
    description,
    amountUsd: amount.toFixed(2),
    recurring,
    spentAt: at,
    createdAt: new Date(),
  });

  console.log(
    `\n  Gider yazıldı\n  ${description} · ${amount} · ${category}${recurring ? " · her ay" : ""}\n  ${branch ?? "şubesiz"} · tarih ${at.toLocaleDateString("tr-TR")}\n`,
  );
}

async function list(args: string[]) {
  const days = Number(flag(args, "days") ?? 30);
  const since = new Date(Date.now() - (Number.isFinite(days) ? days : 30) * 86_400_000);
  const db = await getDb();

  const [paid, spent] = await Promise.all([
    db.select().from(invoices).where(gte(invoices.paidAt, since)).orderBy(desc(invoices.paidAt)),
    db.select().from(expenses).where(gte(expenses.spentAt, since)).orderBy(desc(expenses.spentAt)),
  ]);

  const income = paid.filter((i) => i.state === "paid").reduce((n, i) => n + Number(i.amountUsd), 0);
  const outgoing = spent.reduce((n, e) => n + Number(e.amountUsd), 0);

  console.log(`\n  Son ${days} gün\n`);
  console.log(`  Giren    ${income.toFixed(2)}  (${paid.length} tahsilat)`);
  console.log(`  Çıkan    ${outgoing.toFixed(2)}  (${spent.length} gider)`);
  console.log(`  Fark     ${(income - outgoing).toFixed(2)}\n`);

  for (const e of spent.slice(0, 20)) {
    const when = e.spentAt.toLocaleDateString("tr-TR");
    console.log(`  −${String(e.amountUsd).padStart(10)}  ${when}  [${e.category}] ${e.description}${e.recurring ? " (her ay)" : ""}`);
  }
  console.log();
}

function fail(message: string): never {
  console.error(`\n${message}\n${USAGE}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || args.includes("--help")) {
    console.log(USAGE);
  } else if (command === "in") {
    await recordIn(args);
  } else if (command === "out") {
    await recordOut(args);
  } else if (command === "list") {
    await list(args);
  } else {
    console.error(`\nBilinmeyen komut: ${command}\n${USAGE}`);
    await closeDb();
    process.exit(1);
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(`\n${(err as Error).message}\n`);
  await closeDb().catch(() => {});
  process.exit(1);
});
