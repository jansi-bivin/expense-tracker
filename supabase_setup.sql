-- ============================================
-- Expense Tracker - Supabase Database Setup
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  sms_id TEXT,
  address TEXT NOT NULL,
  body TEXT NOT NULL,
  sms_date BIGINT NOT NULL,
  amount DECIMAL(15,2),
  transaction_type TEXT,
  account_number TEXT,
  merchant TEXT,
  transaction_date TEXT,
  balance DECIMAL(15,2),
  reference_id TEXT,
  device_id TEXT DEFAULT 'default',
  category TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sms_date, address, body)
);

-- 2. Index for fast queries
CREATE INDEX IF NOT EXISTS idx_transactions_sms_date ON transactions(sms_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_device ON transactions(device_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_number);

-- 3. Enable Row Level Security (but allow all for now - we'll add auth later)
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- 4. Policy: Allow anyone with the anon key to read/write (we'll restrict later with auth)
CREATE POLICY "Allow all operations" ON transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. API key table for Android app authentication
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  device_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read api_keys" ON api_keys
  FOR SELECT
  USING (true);
