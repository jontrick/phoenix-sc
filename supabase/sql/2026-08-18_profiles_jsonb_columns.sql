-- Pending profile columns — run in Supabase SQL Editor (project mxtowhccuqarszcwpbkq)
-- peptide_state: Peptide Portal cloud mirror (v4.9.138)
-- nut_recipes:   Nutrition per-serve recipe store cloud mirror (v4.9.144)
alter table profiles add column if not exists peptide_state jsonb;
alter table profiles add column if not exists nut_recipes   jsonb;
