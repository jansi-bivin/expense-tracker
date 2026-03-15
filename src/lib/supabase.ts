import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://aeypofbcgzwdrejmrwpa.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFleXBvZmJjZ3p3ZHJlam1yd3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NjAwNzAsImV4cCI6MjA4OTEzNjA3MH0.y1jRcxpbArTe8gg9juEI8mvltXdQ_CW4IVwbQMmap4w';

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface Transaction {
  id: number;
  sms_id: string | null;
  address: string;
  body: string;
  sms_date: number;
  amount: number | null;
  transaction_type: string | null;
  account_number: string | null;
  merchant: string | null;
  transaction_date: string | null;
  balance: number | null;
  reference_id: string | null;
  device_id: string | null;
  category: string | null;
  notes: string | null;
  created_at: string;
}
