begin;

alter table public.parts
  add column if not exists part_number text;

commit;
