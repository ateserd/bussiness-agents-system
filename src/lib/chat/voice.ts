/**
 * Voice notes → text, so a command can be spoken instead of typed (§6).
 *
 * The Brain holds "Sahip sesli not gönderdiğinde bu bir talimattır, bilgi
 * değil" — so a transcript is fed straight back through `parseCommand`, the
 * same path a typed message takes. Nothing here interprets what was said.
 *
 * Transcription is the one place this system calls a provider other than
 * Anthropic: Anthropic's API has no speech-to-text endpoint. Without
 * `OPENAI_API_KEY` the caller reports the gap rather than guessing at the
 * audio — §3 rule 3, the same rule that keeps `lighthouse` honest.
 */

/** Telegram's own cap for getFile is 20MB; Whisper's is 25MB. The lower wins. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Longer than this and it is a monologue, not a command. Transcription bills
 * by the minute, so an accidental hour-long recording should cost nothing.
 */
const MAX_DURATION_SEC = 300;

const TRANSCRIBE_MODEL = "whisper-1";

export type Transcription = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Downloads a Telegram voice note and returns what was said.
 *
 * `fileId` comes from `message.voice.file_id`; the bot token is the same one
 * the webhook already authenticated with.
 */
export async function transcribeVoice(options: {
  fileId: string;
  botToken: string;
  durationSec?: number;
}): Promise<Transcription> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "OPENAI_API_KEY tanımlı değil" };
  }

  if (options.durationSec && options.durationSec > MAX_DURATION_SEC) {
    return {
      ok: false,
      reason: `ses ${options.durationSec} saniye, sınır ${MAX_DURATION_SEC} saniye`,
    };
  }

  // 1. file_id → a path on Telegram's file host.
  const lookup = await fetch(
    `https://api.telegram.org/bot${options.botToken}/getFile?file_id=${encodeURIComponent(options.fileId)}`,
  );
  if (!lookup.ok) {
    return { ok: false, reason: `Telegram getFile ${lookup.status}` };
  }
  const meta = (await lookup.json()) as {
    ok: boolean;
    result?: { file_path?: string; file_size?: number };
  };
  const filePath = meta.result?.file_path;
  if (!meta.ok || !filePath) {
    return { ok: false, reason: "Telegram dosya yolu döndürmedi" };
  }
  if (meta.result?.file_size && meta.result.file_size > MAX_FILE_BYTES) {
    return { ok: false, reason: "ses dosyası çok büyük" };
  }

  // 2. Download the audio itself.
  const audio = await fetch(
    `https://api.telegram.org/file/bot${options.botToken}/${filePath}`,
  );
  if (!audio.ok) {
    return { ok: false, reason: `ses indirilemedi (${audio.status})` };
  }
  const bytes = await audio.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return { ok: false, reason: "ses dosyası çok büyük" };
  }

  // 3. Transcribe. Telegram voice notes are OGG/Opus, which Whisper accepts.
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/ogg" }), "voice.ogg");
  form.append("model", TRANSCRIBE_MODEL);
  // The owner speaks Turkish; naming it beats letting the model guess from
  // two seconds of audio, which is where short commands get misread.
  form.append("language", "tr");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    return { ok: false, reason: `transkripsiyon ${res.status}` };
  }

  const body = (await res.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text) {
    return { ok: false, reason: "ses boş çıktı" };
  }

  return { ok: true, text };
}
