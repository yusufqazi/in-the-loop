-- Run once for the existing schema. Old unowned shared-demo rows are marked
-- expire after one day. They are never returned to the app because they have
-- no session/user owner; keep this grace window in case the operator needs a backup.
begin;
alter table public.meetings add column user_id uuid references auth.users(id) on delete cascade;
alter table public.meetings add column session_id uuid;
alter table public.meetings add column expires_at timestamptz;
update public.meetings set expires_at = now() + interval '24 hours'
where user_id is null and session_id is null;
alter table public.meetings add constraint meetings_owner_check check (
  (user_id is not null and session_id is null and expires_at is null) or
  (user_id is null and session_id is not null and expires_at is not null)
) not valid;
create index meetings_expiry_idx on public.meetings(expires_at) where expires_at is not null;

drop function if exists public.ingest_meeting(text,date,text,jsonb,text,jsonb);
drop function if exists public.match_meeting_chunks(uuid,extensions.vector,text,integer);

create table public.meeting_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  answer jsonb,
  created_at timestamptz not null default now()
);
create index meeting_messages_owner_idx on public.meeting_messages(user_id, meeting_id, created_at);
alter table public.meeting_messages enable row level security;
revoke all on public.meeting_messages from anon, authenticated;
grant all on public.meeting_messages to service_role;

create function public.ingest_meeting(p_title text, p_date date, p_raw text, p_turns jsonb, p_model text, p_chunks jsonb, p_user_id uuid, p_session_id uuid)
returns uuid language plpgsql security invoker set search_path = public, extensions as $$
declare meeting_uuid uuid;
begin
  if (p_user_id is null) = (p_session_id is null) then raise exception 'Exactly one meeting owner is required'; end if;
  insert into public.meetings(title, meeting_date, raw_transcript, turns, turn_count, chunk_count, embedding_model, user_id, session_id, expires_at)
  values (p_title, p_date, p_raw, p_turns, jsonb_array_length(p_turns), jsonb_array_length(p_chunks), p_model,
          p_user_id, p_session_id, case when p_session_id is null then null else now() + interval '24 hours' end)
  returning id into meeting_uuid;
  insert into public.meeting_chunks(meeting_id, position, content, turns, embedding)
  select meeting_uuid, (c->>'position')::integer, c->>'content', c->'turns', (c->>'embedding')::extensions.vector(1536)
  from jsonb_array_elements(p_chunks) as c;
  return meeting_uuid;
end;
$$;
create function public.match_meeting_chunks(p_meeting_id uuid, p_embedding extensions.vector(1536), p_model text, p_count integer, p_user_id uuid, p_session_id uuid)
returns table(id uuid, "position" integer, content text, turns jsonb, similarity double precision)
language sql stable security invoker set search_path = public, extensions as $$
  select c.id, c.position, c.content, c.turns, 1 - (c.embedding <=> p_embedding) as similarity
  from public.meeting_chunks c join public.meetings m on m.id = c.meeting_id
  where c.meeting_id = p_meeting_id and m.embedding_model = p_model
    and ((p_user_id is not null and m.user_id = p_user_id) or (p_session_id is not null and m.session_id = p_session_id and m.expires_at > now()))
  order by c.embedding <=> p_embedding, c.position limit greatest(1, least(p_count, 6));
$$;
revoke execute on function public.ingest_meeting(text,date,text,jsonb,text,jsonb,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.match_meeting_chunks(uuid,extensions.vector,text,integer,uuid,uuid) from public, anon, authenticated;
grant execute on function public.ingest_meeting(text,date,text,jsonb,text,jsonb,uuid,uuid) to service_role;
grant execute on function public.match_meeting_chunks(uuid,extensions.vector,text,integer,uuid,uuid) to service_role;

create function public.claim_meeting_session(p_session_id uuid, p_user_id uuid, p_chats jsonb)
returns void language sql security invoker set search_path = public as $$
  with claimed as (
    update public.meetings set user_id = p_user_id, session_id = null, expires_at = null
    where session_id = p_session_id returning id
  )
  insert into public.meeting_messages(meeting_id, user_id, role, content, answer, created_at)
  select claimed.id, p_user_id, message.item->>'role', message.item->>'content',
         case when message.item->>'role' = 'assistant' then message.item->'answer' else null end,
         statement_timestamp() + (message.position * interval '1 millisecond')
  from jsonb_each(p_chats) as thread(meeting_id, messages)
  join claimed on claimed.id = thread.meeting_id::uuid
  cross join lateral jsonb_array_elements(thread.messages) with ordinality as message(item, position);
$$;
revoke execute on function public.claim_meeting_session(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.claim_meeting_session(uuid,uuid,jsonb) to service_role;
commit;
