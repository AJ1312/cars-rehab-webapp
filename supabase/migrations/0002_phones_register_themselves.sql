-- Phones now register themselves the first time they upload a session. The one-time enrolment code (and the QR code that carried it) is gone.
alter table public.devices drop column if exists enrol_code_hash;
alter table public.devices drop column if exists enrol_expires_at;

comment on column public.devices.enrolled_at is 'When the phone first registered (its first upload).';
comment on column public.devices.token_hash is 'sha-256 of the phone''s token. Kept after removal (revoked_at set) so a removed phone can be told apart from an unknown one.';
