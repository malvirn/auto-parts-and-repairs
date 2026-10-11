-- Fingerprint (passkey / WebAuthn) sign-in: up to 3 per account. Applied 2026-10-11.
-- Used by the `passkey` edge function (verify_jwt = false; it checks JWTs itself).
create table if not exists public.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  label text not null default 'Fingerprint',
  rp_id text not null,
  origin text not null,
  device_type text,
  backed_up boolean,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists webauthn_credentials_user_idx on public.webauthn_credentials(user_id);

create table if not exists public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge text not null,
  kind text not null check (kind in ('register','login')),
  user_id uuid references auth.users(id) on delete cascade,
  origin text not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists webauthn_challenges_created_idx on public.webauthn_challenges(created_at);

alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges enable row level security;

create policy webauthn_credentials_select_own on public.webauthn_credentials
  for select to authenticated using (user_id = auth.uid());
create policy webauthn_credentials_update_own on public.webauthn_credentials
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy webauthn_credentials_delete_own on public.webauthn_credentials
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.webauthn_limit_three()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.webauthn_credentials where user_id = new.user_id) >= 3 then
    raise exception 'This account already has 3 fingerprint sign-ins. Remove one first.';
  end if;
  return new;
end $$;
create trigger webauthn_limit_three before insert on public.webauthn_credentials
  for each row execute function public.webauthn_limit_three();

revoke update on public.webauthn_credentials from authenticated;
grant update (label) on public.webauthn_credentials to authenticated;
revoke all on public.webauthn_challenges from anon, authenticated;
revoke insert on public.webauthn_credentials from anon, authenticated;
