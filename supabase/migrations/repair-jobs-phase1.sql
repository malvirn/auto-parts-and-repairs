-- ============================================================
-- REPAIR JOBS OVERHAUL — PHASE 1: Vehicle & Customer foundation
-- ============================================================
-- Everything else in this project (CRO numbering, rate tiers, filters)
-- depends on this existing first: knowing whether a customer is a company
-- or an individual, and having chassis + engine numbers as real,
-- reliable vehicle identifiers — a plate alone isn't enough since plates
-- can be reissued, cloned, or simply illegible.
-- ============================================================

-- ---- Company vs Individual, set on the customer record itself ----
-- A company customer (e.g. a logistics firm) typically has a fleet of
-- vehicles all linked to one customer row — that's what makes this a
-- customer-level property rather than something set per vehicle.
alter table public.customers add column if not exists customer_type text not null default 'individual';
alter table public.customers drop constraint if exists customers_type_check;
alter table public.customers add constraint customers_type_check check (customer_type in ('individual', 'company'));

-- ---- Chassis number: renaming vin to chassis_number for clarity ----
-- "VIN" and "chassis number" are the same physical identifier in this
-- market's terminology — renaming rather than adding a duplicate column,
-- since keeping both would just invite them drifting out of sync.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vehicles' and column_name = 'vin')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vehicles' and column_name = 'chassis_number') then
    alter table public.vehicles rename column vin to chassis_number;
  end if;
end $$;

-- ---- Engine number: genuinely new, doesn't exist yet ----
alter table public.vehicles add column if not exists engine_number text;

-- Note: NOT adding a hard NOT NULL constraint on either column here — your
-- existing vehicles were registered before these were mandatory, and a
-- strict constraint would break every one of those old rows immediately.
-- "Mandatory" is enforced at the form level going forward (repairs.js);
-- if you want the database itself to refuse a blank value later, that's
-- a separate step once your existing records are backfilled.
