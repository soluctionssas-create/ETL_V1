-- Migration script to create tables for ETL SaaS
-- Run this in Supabase SQL Editor

-- ── Tenants ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tax_id TEXT,
  country_code TEXT DEFAULT 'CO',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, email)
);

-- ── Enable Row Level Security ────────────────────────────────────────────────
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ── Policies for Tenants ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own tenant" ON tenants;
CREATE POLICY "Users can view own tenant"
ON tenants
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.tenant_id = tenants.id
    AND users.id = auth.uid()
  )
);

-- ── Policies for Users ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own tenant users" ON users;
CREATE POLICY "Users can view own tenant users"
ON users
FOR SELECT
USING (
  tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Tenant admins can manage users" ON users;
CREATE POLICY "Tenant admins can manage users"
ON users
FOR UPDATE
USING (
  role = 'tenant_admin' AND
  tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  )
);

-- ── Indexes for Performance ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- ── Invoices (future use) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  amount DECIMAL(19,2) NOT NULL,
  currency TEXT DEFAULT 'COP',
  invoice_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, invoice_number)
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tenant invoices" ON invoices;
CREATE POLICY "Users can view own tenant invoices"
ON invoices
FOR SELECT
USING (
  tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices(tenant_id);
