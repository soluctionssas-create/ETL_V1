INSERT INTO tenants (id, name, tax_id, country_code)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo SAS', '900123456', 'CO')
ON CONFLICT DO NOTHING;

INSERT INTO users (id, tenant_id, email, password_hash, role)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'admin@demo.com',
  '$2b$12$replace_with_real_hash',
  'tenant_admin'
)
ON CONFLICT DO NOTHING;
