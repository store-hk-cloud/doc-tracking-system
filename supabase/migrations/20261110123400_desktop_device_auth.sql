create schema if not exists private;

create table private.desktop_device_auth (
  challenge text primary key check (challenge ~ '^[0-9a-f]{64}$'),
  actor_id uuid references auth.users(id) on delete cascade,
  expires_at timestamptz not null default clock_timestamp() + interval '2 minutes'
);

create index desktop_device_auth_expires_at_idx on private.desktop_device_auth (expires_at);

alter table private.desktop_device_auth enable row level security;
revoke all on private.desktop_device_auth from public, anon, authenticated;

create function public.desktop_device_register(p_challenge text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(20261110, 123400);
  delete from private.desktop_device_auth where expires_at <= clock_timestamp();
  if (select count(*) from private.desktop_device_auth) >= 250 then
    return false;
  end if;
  insert into private.desktop_device_auth (challenge) values (p_challenge)
  on conflict do nothing;
  return found;
end;
$$;

create function public.desktop_device_approve(p_challenge text, p_actor_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update private.desktop_device_auth
  set actor_id = p_actor_id
  where challenge = p_challenge and actor_id is null and expires_at > clock_timestamp();
  return found;
end;
$$;

create function public.desktop_device_claim(p_challenge text)
returns uuid
language sql security definer set search_path = ''
as $$
  delete from private.desktop_device_auth
  where challenge = p_challenge and actor_id is not null and expires_at > clock_timestamp()
  returning actor_id;
$$;

revoke all on function public.desktop_device_register(text) from public, anon, authenticated;
revoke all on function public.desktop_device_approve(text, uuid) from public, anon, authenticated;
revoke all on function public.desktop_device_claim(text) from public, anon, authenticated;
grant execute on function public.desktop_device_register(text) to service_role;
grant execute on function public.desktop_device_approve(text, uuid) to service_role;
grant execute on function public.desktop_device_claim(text) to service_role;
