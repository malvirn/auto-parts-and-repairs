-- Preserve vehicle labour rates referenced by repair orders by archiving
-- them instead of deleting their rows.
alter table public.vehicle_rate_tiers
  add column if not exists is_active boolean not null default true;
