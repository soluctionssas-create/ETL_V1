CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(160) NOT NULL,
  tax_id VARCHAR(40) NOT NULL UNIQUE,
  country_code VARCHAR(2) NOT NULL DEFAULT 'CO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  UNIQUE (tenant_id, email)
);

CREATE TABLE invoice_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  status VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'upload',
  total_items INT NOT NULL DEFAULT 0,
  created_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  batch_id UUID NOT NULL REFERENCES invoice_batches(id),
  file_name VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  format VARCHAR(10) NOT NULL,
  status VARCHAR(32) NOT NULL,
  extracted_data JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE classifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  account_code VARCHAR(64) NOT NULL,
  confidence NUMERIC(5,4) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'ai',
  status VARCHAR(20) NOT NULL DEFAULT 'suggested',
  approved_by UUID NULL REFERENCES users(id),
  approved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE erp_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  batch_id UUID NOT NULL REFERENCES invoice_batches(id),
  destination VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL,
  external_reference VARCHAR(255) NULL,
  payload JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NULL REFERENCES tenants(id),
  user_id UUID NULL REFERENCES users(id),
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(120) NULL,
  metadata JSONB NULL,
  correlation_id VARCHAR(120) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_tenant_status ON invoices(tenant_id, status);
CREATE INDEX idx_classifications_tenant_status ON classifications(tenant_id, status);
CREATE INDEX idx_exports_tenant_status ON erp_exports(tenant_id, status);
CREATE INDEX idx_audit_tenant_created ON audit_events(tenant_id, created_at DESC);
