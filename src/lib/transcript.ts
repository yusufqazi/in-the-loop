import { AppError } from "./errors";
import type { Chunk, Transcript, Turn } from "./types";

export const MAX_FILE_BYTES = 100 * 1024;
export const formatTurn = (turn: Turn) =>
  `${turn.timestamp ? `[${turn.timestamp}] ` : ""}${turn.speaker ? `${turn.speaker}: ` : "[Speaker not provided] "}${turn.text}`;

function meetingDate(value: string): string | null {
  let iso = value;
  const written = value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (written) {
    const months = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const month = months.indexOf(written[1].toLowerCase());
    if (month < 0) return null;
    iso = `${written[3]}-${String(month + 1).padStart(2, "0")}-${written[2].padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === iso
    ? iso
    : null;
}

function validTimestamp(value: string): boolean {
  const parts = value.split(":").map(Number);
  return parts.at(-1)! < 60 && (parts.length === 2 || parts[1] < 60);
}

// Recognize explicit labels only. Other text remains unattributed evidence;
// there is no model call to guess speakers or repair missing metadata.
function heading(
  line: string,
): { speaker: string | null; timestamp: string | null; text: string } | null {
  const time = "(\\d{1,3}:\\d{2}(?::\\d{2})?)";
  const name = "([\\p{L}\\p{N}][\\p{L}\\p{N} ._'’()\\-]{0,79})";
  const first = line.match(
    new RegExp(`^(?:\\[${time}\\]|${time})\\s*${name}:\\s*(.*)$`, "u"),
  );
  if (first) {
    const timestamp = first[1] || first[2];
    return validTimestamp(timestamp)
      ? { timestamp, speaker: first[3].trim(), text: first[4] }
      : null;
  }
  const last = line.match(
    new RegExp(`^${name}\\s*[\\[(]${time}[\\])]\\s*:?\\s*(.*)$`, "u"),
  );
  if (last)
    return validTimestamp(last[2])
      ? { speaker: last[1].trim(), timestamp: last[2], text: last[3] }
      : null;
  const speaker = line.match(new RegExp(`^${name}:\\s*(.*)$`, "u"));
  const words = speaker?.[1].trim().split(/\s+/) || [];
  if (
    speaker &&
    (words.length === 1 ||
      words.every(
        (part) =>
          /^[\p{Lu}\p{N}]/u.test(part) ||
          /^(?:van|von|de|del|da|der|di|la|le|bin|al)$/i.test(part),
      )) &&
    !/^(?:https?|notes?|summary|agenda|action items?|decisions?|attendees|participants|date|deadline|owner|due|topic|task|(?:meeting )?title)$/i.test(
      speaker[1],
    )
  )
    return { speaker: speaker[1].trim(), timestamp: null, text: speaker[2] };
  const timestamp = line.match(new RegExp(`^\\[${time}\\]\\s*(.*)$`));
  return timestamp && validTimestamp(timestamp[1])
    ? { speaker: null, timestamp: timestamp[1], text: timestamp[2] }
    : null;
}

export function parseTranscript(
  input: string,
  fallbackTitle: string,
): Transcript {
  const lines = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const result: Transcript = {
    title: fallbackTitle.slice(0, 120) || "Untitled meeting",
    date: null,
    turns: [],
  };
  let current: Turn | null = null;
  let blank = false;
  let bodyStarted = false;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) {
      blank = true;
      continue;
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(line))
      throw new AppError(
        "INVALID_TRANSCRIPT",
        `Line ${index + 1}: unsupported control character.`,
      );
    if (!bodyStarted) {
      const title = line.match(/^(?:Meeting\s+)?Title:\s*(.+)$/i);
      if (title && title[1].length <= 120) {
        result.title = title[1];
        continue;
      }
      const date = line.match(/^(?:Meeting\s+)?Date:\s*(.+)$/i);
      const parsedDate = date ? meetingDate(date[1]) : null;
      if (parsedDate) {
        result.date = parsedDate;
        continue;
      }
    }
    bodyStarted = true;
    const label = heading(line);
    if (label) {
      current = { id: result.turns.length + 1, ...label, line: index + 1 };
      result.turns.push(current);
    } else if (
      current &&
      (current.speaker !== null || current.timestamp !== null) &&
      !/^\[|:$/.test(line)
    ) {
      current.text += `${current.text ? (blank ? "\n\n" : "\n") : ""}${line}`;
    } else if (
      current &&
      current.speaker === null &&
      current.timestamp === null &&
      !blank
    ) {
      current.text += `\n${line}`;
    } else {
      current = {
        id: result.turns.length + 1,
        speaker: null,
        timestamp: null,
        text: line,
        line: index + 1,
      };
      result.turns.push(current);
    }
    blank = false;
  }
  // Preserve empty headings literally instead of inventing speech or dropping it.
  for (const turn of result.turns) {
    if (!turn.text) {
      turn.text = lines[turn.line - 1].trim();
      turn.speaker = null;
      turn.timestamp = null;
    }
  }
  if (!result.turns.length)
    throw new AppError(
      "INVALID_TRANSCRIPT",
      "The transcript contains no text. Paste or upload a nonempty transcript.",
    );
  return result;
}

function splitPassage(text: string, limit: number): string[] {
  const parts: string[] = [];
  while (text.length > limit) {
    const window = text.slice(0, limit);
    const boundary = [...window.matchAll(/\n|[.!?]\s|\s/g)].at(-1);
    let end =
      boundary && boundary.index > limit / 2
        ? boundary.index + boundary[0].length
        : limit;
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (text) parts.push(text);
  return parts;
}

export function chunkTranscript(turns: Turn[], targetChars = 2400): Chunk[] {
  if (targetChars < 100)
    throw new Error("Chunk target must be at least 100 characters.");
  const chunks: Chunk[] = [];
  const add = (group: Turn[]) =>
    chunks.push({
      position: chunks.length,
      content: group.map(formatTurn).join("\n"),
      turns: group,
    });
  let start = 0;
  while (start < turns.length) {
    const turn = turns[start];
    // Bound long passages and oversized turns. Each
    // fragment retains its original speaker, timestamp, line and turn id.
    if (formatTurn(turn).length > targetChars) {
      const prefixSize = formatTurn({ ...turn, text: "" }).length;
      for (const text of splitPassage(
        turn.text,
        Math.max(40, targetChars - prefixSize),
      ))
        add([{ ...turn, text }]);
      start++;
      continue;
    }
    let end = start;
    let size = 0;
    while (end < turns.length) {
      const next = turns[end];
      if (end > start && formatTurn(next).length > targetChars) break;
      const added = formatTurn(next).length + 1;
      if (end > start && size + added > targetChars) break;
      size += added;
      end++;
    }
    add(turns.slice(start, end));
    if (end === turns.length) break;
    start =
      end - start > 1 &&
      formatTurn(turns[end - 1]).length + formatTurn(turns[end]).length + 2 <=
        targetChars
        ? end - 1
        : end;
  }
  return chunks;
}
