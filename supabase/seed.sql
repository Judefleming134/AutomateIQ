-- Seed data. products rows are written ONLY here (or in a future migration
-- when a new module ships) — never via the admin UI. Idempotent so this can
-- be re-run safely.

insert into products (key, name, description, icon_name, status)
values
  ('review-agent', 'Review Agent', 'Automate review requests and follow-ups to grow your online reputation.', 'star', 'active'),
  ('website-agent', 'Website Agent', 'AI-powered websites that convert and engage.', 'globe', 'coming_soon'),
  ('ai-assistant', 'AI Assistant', 'A smart assistant that helps your business around the clock.', 'bot', 'coming_soon'),
  ('custom-solutions', 'Custom Solutions', 'Bespoke AI modules built specifically for your business.', 'box', 'framework')
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon_name = excluded.icon_name,
  status = excluded.status;
