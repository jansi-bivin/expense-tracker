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
}

// Enriched transaction after client-side field detection
export interface Transaction {
  id: number;
  address: string;
  body: string;
  sms_date: number;
  created_at: string;
  // Detected fields (computed client-side)
  amount: number | null;
  transaction_type: string | null;
  account_number: string | null;
  merchant: string | null;
  transaction_date: string | null;
  balance: number | null;
  reference_id: string | null;
}
