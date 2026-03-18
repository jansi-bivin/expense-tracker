import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://aeypofbcgzwdrejmrwpa.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFleXBvZmJjZ3p3ZHJlam1yd3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NjAwNzAsImV4cCI6MjA4OTEzNjA3MH0.y1jRcxpbArTe8gg9juEI8mvltXdQ_CW4IVwbQMmap4w';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Raw SMS as stored in Supabase
export interface RawSms {
  id: number;
  address: string;
  body: string;
  sms_date: number;
  created_at: string;
  category: string | null;
  notes: string | null;
  status: 'new' | 'categorized' | 'ignored';
  phone_number: string | null;
}

// Enriched transaction after client-side field detection
export interface Transaction extends RawSms {
  amount: number | null;
  transaction_type: string | null;
  account_number: string | null;
  merchant: string | null;
  transaction_date: string | null;
  balance: number | null;
  reference_id: string | null;
}

export interface Category {
  id: number;
  name: string;
  cap: number;
  recurrence: 'Monthly' | 'Yearly';
  visible_to: 'all' | 'primary' | 'secondary';
}

export interface AppSettings {
  id: number;
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}

export interface User {
  id: number;
  phone_number: string;
  name: string;
  is_primary: boolean;
  upi_id: string | null;
}

export interface Due {
  id: number;
  transaction_id: number;
  category: string;
  amount: number;
  cleared: boolean;
  cleared_at: string | null;
  created_at: string;
  settlement_transaction_id: number | null;
}

export interface FeatureIdea {
  id: string;
  seq: number; // Sequential ID for display (F-1, B-2, etc.)
  text: string;
  type: 'feature' | 'bug';
  status: 'pending' | 'implemented';
  created_at: string;
}
