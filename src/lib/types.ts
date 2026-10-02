export type Turn = {
  id: number;
  speaker: string | null;
  timestamp: string | null;
  text: string;
  line: number;
};
export type Transcript = { title: string; date: string | null; turns: Turn[] };
export type Chunk = { position: number; content: string; turns: Turn[] };
export type Meeting = {
  id: string;
  title: string;
  meeting_date: string | null;
  created_at: string;
  turn_count: number;
  chunk_count: number;
  embedding_model: string;
};
export type MeetingTranscript = Pick<Meeting, "id" | "title"> & { raw_transcript: string };
export type Evidence = Chunk & { id: string; similarity: number };
export type Source = { id: string; meetingTitle: string; turns: Turn[] };
export type Answer = {
  status: "answered" | "insufficient_evidence";
  answer: string;
  sources: Source[];
};
export type ChatTurn = { role: "user" | "assistant"; content: string };
