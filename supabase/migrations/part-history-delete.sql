-- Preserve purchasing audit history while allowing obsolete parts to be
-- removed from inventory. Historical purchase rows retain a part-name snapshot.
begin;

alter table public.restocks
  add column if not exists part_name text;

update public.restocks r
set part_name = p.name
from public.parts p
where r.part_id = p.id
  and r.part_name is null;

alter table public.restocks
  alter column part_id drop not null;

alter table public.restocks
  drop constraint if exists restocks_part_id_fkey;

alter table public.restocks
  add constraint restocks_part_id_fkey
  foreign key (part_id) references public.parts(id) on delete set null;

alter table public.purchase_shipment_items
  add column if not exists part_name text;

update public.purchase_shipment_items i
set part_name = p.name
from public.parts p
where i.part_id = p.id
  and i.part_name is null;

alter table public.purchase_shipment_items
  alter column part_id drop not null;

alter table public.purchase_shipment_items
  drop constraint if exists purchase_shipment_items_part_id_fkey;

alter table public.purchase_shipment_items
  add constraint purchase_shipment_items_part_id_fkey
  foreign key (part_id) references public.parts(id) on delete set null;

commit;
