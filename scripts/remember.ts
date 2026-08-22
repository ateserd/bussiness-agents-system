import { closeDb } from "../src/db/client";
import type { MemoryKind } from "../src/db/schema";
import { writeMemory } from "../src/lib/brain/write";

/**
 * Writes a business fact into the Brain from the command line.
 *
 * This is the intended path for ICPs, price bands and standing preferences —
 * the things §3 rule 2 keeps out of prompt files so that changing a price is
 * not a code change. It needs no API key and no dev server.
 *
 *   npm run remember -- --scope branch.web --kind fact "Web ICP'si: ..."
 *   npm run remember -- --scope global --permanent "Sahip önce sayı ister."
 *   npm run remember -- --scope dept.web.sales --kind decision "Stale eşiği 14 gün."
 *   npm run remember -- --list branch.web
 *   npm run remember -- --forget <id>   # --list'te görünen id ile, kalıcı siler
 *
 * Scope is required and deliberately not defaulted: the chat `/remember`
 * writes `global`, which is right for a note from the phone and wrong for
 * anything branch-specific. Making the caller name the scope is what stops a
 * web ICP from silently becoming an automation ICP too.
 */

const KINDS: MemoryKind[] = [
  "fact",
  "decision",
  "preference",
  "client_context",
  "lesson",
  "metric_snapshot",
];

const USAGE = `
npm run remember -- --scope <kapsam> [--kind <tür>] [--permanent] [--confidence N] "<bilgi>"
npm run remember -- --list [kapsam]
npm run remember -- --forget <id>

  --scope       zorunlu. global | branch.web | branch.automation
                | dept.<şube>.<departman> | client.<id>
  --kind        ${KINDS.join(" | ")}   (varsayılan: fact)
  --permanent   kalıcı işaretle — Brain Keeper budamaz
  --confidence  0–1 arası (varsayılan: 0.9)
  --forget      bir anıyı kalıcı sil — id'yi --list çıktısından al. Geri
                alınamaz; Brain Keeper'ın budaması gibi geçici değil.

Bir anı ya global ya kapsamlıdır, ikisi birden değil. İki şubede de aynı
departman adları olduğu için dept kapsamları şube nitelikli olmak zorunda.

Örnekler:
  npm run remember -- --scope branch.web --permanent \\
    "Web ICP'si: 5-30 çalışanlı, İstanbul/İzmir/Antalya'daki bağımsız işletmeler."
  npm run remember -- --scope branch.automation --kind decision \\
    "Kurulum bandı 45.000-120.000 TL, aylık bakım 8.000 TL'den başlar."
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function list(scope?: string) {
  const { getDb } = await import("../src/db/client");
  const { memories } = await import("../src/db/schema");
  const db = await getDb();
  const rows = await db.select().from(memories);
  const shown = scope ? rows.filter((r) => r.scopes.includes(scope)) : rows;

  if (shown.length === 0) {
    console.log(scope ? `\n"${scope}" kapsamında anı yok.\n` : "\nBeyin boş.\n");
    return;
  }

  console.log(`\n${shown.length} anı${scope ? ` — ${scope}` : ""}\n`);
  for (const m of shown.slice(0, 60)) {
    const mark = m.permanent ? "•" : " ";
    console.log(`${mark} [${m.kind}] ${m.scopes.join(", ")}  ·  id: ${m.id}`);
    console.log(`    ${m.content}`);
  }
  if (shown.length > 60) console.log(`\n… ${shown.length - 60} tane daha`);
  console.log();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    console.log(USAGE);
    await closeDb();
    return;
  }

  if (args.includes("--list")) {
    await list(flag(args, "list"));
    await closeDb();
    return;
  }

  if (args.includes("--forget")) {
    const id = flag(args, "forget");
    if (!id) {
      console.error("\n--forget için bir id gerekli — önce --list ile bul.\n");
      await closeDb();
      process.exit(1);
    }
    const { deleteMemory } = await import("../src/lib/brain/write");
    const result = await deleteMemory(id);
    if (!result.deleted) {
      console.log(`\n"${id}" bulunamadı — zaten silinmiş olabilir.\n`);
    } else {
      console.log(`\nSilindi: ${id}`);
      if (result.unlinked > 0) {
        console.log(`${result.unlinked} anının "bunun yerine geçti" referansı da temizlendi.`);
      }
      console.log();
    }
    await closeDb();
    return;
  }

  const scope = flag(args, "scope");
  if (!scope) {
    console.error("\n--scope zorunlu. Kapsamsız bir anı nereye ait olduğunu söyleyemez.\n");
    console.error(USAGE);
    await closeDb();
    process.exit(1);
  }

  const kindArg = flag(args, "kind") ?? "fact";
  if (!KINDS.includes(kindArg as MemoryKind)) {
    console.error(`\n"${kindArg}" geçerli bir tür değil. Seçenekler: ${KINDS.join(", ")}\n`);
    await closeDb();
    process.exit(1);
  }

  const confidenceArg = flag(args, "confidence");
  const confidence = confidenceArg === undefined ? 0.9 : Number(confidenceArg);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    console.error(`\n--confidence 0 ile 1 arasında olmalı, "${confidenceArg}" verildi.\n`);
    await closeDb();
    process.exit(1);
  }

  // Whatever is left once the flags and their values are removed is the fact.
  const consumed = new Set<number>();
  for (const name of ["scope", "kind", "confidence"]) {
    const i = args.indexOf(`--${name}`);
    if (i >= 0) {
      consumed.add(i);
      consumed.add(i + 1);
    }
  }
  const permanentIndex = args.indexOf("--permanent");
  if (permanentIndex >= 0) consumed.add(permanentIndex);

  const content = args.filter((_, i) => !consumed.has(i)).join(" ").trim();
  if (!content) {
    console.error("\nYazılacak bilgi yok. Bilgiyi tırnak içinde ver.\n");
    console.error(USAGE);
    await closeDb();
    process.exit(1);
  }

  // `writeMemory` validates the scope itself — this only reports it kindly.
  const result = await writeMemory({
    kind: kindArg as MemoryKind,
    scopes: [scope],
    content,
    sourceAgentId: "shared.command.chief_of_staff",
    confidence,
    permanent: permanentIndex >= 0,
  });

  const verb =
    result.action === "merged"
      ? "Bunu zaten biliyordum — güveni artırdım"
      : result.action === "superseded"
        ? "Yazıldı, öncekinin yerine geçti"
        : "Yazıldı";

  console.log(`
  ${verb}
  kapsam      ${result.memory.scopes.join(", ")}
  tür         ${result.memory.kind}
  güven       ${result.memory.confidence}
  kalıcı      ${result.memory.permanent ? "evet" : "hayır"}
  id          ${result.memory.id}

  ${result.memory.content}
`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(`\n${(err as Error).message}\n`);
  await closeDb().catch(() => {});
  process.exit(1);
});
