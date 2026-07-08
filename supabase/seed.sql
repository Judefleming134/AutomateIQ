-- Seed data. products rows are written ONLY here (or in a future migration
-- when a new module ships) — never via the admin UI. Idempotent so this can
-- be re-run safely.

insert into products (key, name, description, icon_name, status)
values
  ('review-agent', 'Review Agent', 'Automate review requests and follow-ups to grow your online reputation.', 'star', 'active'),
  ('website-agent', 'Website Agent', 'AI-powered websites that convert and engage.', 'globe', 'active'),
  ('ai-assistant', 'AI Assistant', 'A smart assistant that helps your business around the clock.', 'bot', 'active'),
  ('custom-solutions', 'Custom Solutions', 'Bespoke AI modules built specifically for your business.', 'box', 'framework'),
  ('content-agent', 'Content Agent', 'AI-written blogs, social posts, emails and ad copy — on brand, on demand.', 'pen-line', 'active'),
  ('instant-quote-agent', 'Instant Quote Agent', 'Turns a job description into a priced, itemised quote in seconds.', 'calculator', 'active'),
  ('crm-agent', 'CRM Agent', 'Every customer and lead in one place, searchable and up to date.', 'contact', 'active'),
  ('speed-to-lead-agent', 'Speed-to-Lead Agent', 'Replies to every new lead in under 60 seconds, day or night.', 'zap', 'active'),
  ('voice-agent', 'Voice Agent', 'An AI receptionist that answers missed calls, books jobs and texts you the details.', 'mic', 'active')
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon_name = excluded.icon_name,
  status = excluded.status;
