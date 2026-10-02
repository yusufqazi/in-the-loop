-- Run once in a new Supabase project's SQL editor. All ingestion is transactional.
begin;
create extension if not exists vector with schema extensions;

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  meeting_date date,
  raw_transcript text not null,
  turns jsonb not null check (jsonb_typeof(turns) = 'array'),
  turn_count integer not null check (turn_count > 0),
  chunk_count integer not null check (chunk_count between 1 and 100),
  embedding_model text not null,
  created_at timestamptz not null default now()
);
create table public.meeting_chunks (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  position integer not null,
  content text not null,
  turns jsonb not null,
  embedding extensions.vector(1536) not null,
  unique (meeting_id, position)
);
-- The unique index already supports filtering by meeting_id. Exact search is
-- sufficient for a small restricted demo; no approximate vector index needed.
alter table public.meetings enable row level security;
alter table public.meeting_chunks enable row level security;
revoke all on public.meetings, public.meeting_chunks from anon, authenticated;
grant all on public.meetings, public.meeting_chunks to service_role;

create function public.ingest_meeting(p_title text, p_date date, p_raw text, p_turns jsonb, p_model text, p_chunks jsonb)
returns uuid language plpgsql security invoker set search_path = public, extensions as $$
declare meeting_uuid uuid;
begin
  insert into public.meetings(title, meeting_date, raw_transcript, turns, turn_count, chunk_count, embedding_model)
  values (p_title, p_date, p_raw, p_turns, jsonb_array_length(p_turns), jsonb_array_length(p_chunks), p_model)
  returning id into meeting_uuid;
  insert into public.meeting_chunks(meeting_id, position, content, turns, embedding)
  select meeting_uuid, (c->>'position')::integer, c->>'content', c->'turns', (c->>'embedding')::extensions.vector(1536)
  from jsonb_array_elements(p_chunks) as c;
  return meeting_uuid;
end;
$$;

create function public.match_meeting_chunks(p_meeting_id uuid, p_embedding extensions.vector(1536), p_model text, p_count integer default 6)
returns table(id uuid, "position" integer, content text, turns jsonb, similarity double precision)
language sql stable security invoker set search_path = public, extensions as $$
  select c.id, c.position, c.content, c.turns, 1 - (c.embedding <=> p_embedding) as similarity
  from public.meeting_chunks c
  join public.meetings m on m.id = c.meeting_id
  where c.meeting_id = p_meeting_id and m.embedding_model = p_model
  order by c.embedding <=> p_embedding, c.position
  limit greatest(1, least(p_count, 6));
$$;

revoke execute on function public.ingest_meeting(text,date,text,jsonb,text,jsonb) from public, anon, authenticated;
revoke execute on function public.match_meeting_chunks(uuid,extensions.vector,text,integer) from public, anon, authenticated;
grant execute on function public.ingest_meeting(text,date,text,jsonb,text,jsonb) to service_role;
grant execute on function public.match_meeting_chunks(uuid,extensions.vector,text,integer) to service_role;
commit;
