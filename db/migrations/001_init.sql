-- Enable fuzzy search extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE cars (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  brand               text          NOT NULL,
  model               text          NOT NULL,
  generation          text,
  engine_code         text,
  engine_volume       numeric(4,1),
  year_from           integer       NOT NULL,
  year_to             integer,               -- NULL = still in production
  kw                  integer,
  bhp                 integer,
  fuel_type           text,
  motul_name          text,
  engine_name         text,

  -- Fluid capacities per aggregate.
  -- Shape: { engine, automatic, manual, transfer, diffFront, diffRear }
  -- Each value: { volumeTotal, volumeService, filterVolume, isCvt, isDct,
  --               motulProducts (array), label, rawText, atfWarn }
  fluid_capacities    jsonb         NOT NULL DEFAULT '{}',

  -- Filter part numbers. Shape:
  -- { vf: {part:"W7023",absent:false},
  --   mf: {part:"C2695",absent:false},
  --   sf: {part:null,  absent:true } }
  -- A record is complete only when every key is present and either
  -- absent:true OR part is a non-empty string.
  filter_part_numbers jsonb         NOT NULL DEFAULT '{}',

  -- Search fields — generated on every write by the backend
  name_normalized     text,          -- "kia rio 1.6 2017" (lowercase, no punct)
  name_cyrillic       text,          -- "киа рио 1.6 2017"
  name_translit       text,          -- Latin variant of Cyrillic + brand synonyms
  search_vector       tsvector,      -- GIN-indexed, built from all name variants

  created_at          timestamptz   DEFAULT now(),
  updated_at          timestamptz   DEFAULT now(),
  created_by          text
);

-- Primary lookup: engine code (most precise discriminator)
CREATE INDEX idx_cars_engine_code ON cars (lower(engine_code))
  WHERE engine_code IS NOT NULL;

-- Secondary lookup: brand + model for match endpoint
CREATE INDEX idx_cars_brand_model ON cars (lower(brand), lower(model));

-- Year-range queries
CREATE INDEX idx_cars_year_from ON cars (year_from);
CREATE INDEX idx_cars_year_to   ON cars (year_to)   WHERE year_to IS NOT NULL;

-- Full-text search
CREATE INDEX idx_cars_search_vector ON cars USING GIN (search_vector);

-- Trigram similarity on the combined normalized name
CREATE INDEX idx_cars_name_trgm ON cars USING GIN (name_normalized gin_trgm_ops);

-- Auto-bump updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cars_updated_at
  BEFORE UPDATE ON cars
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
