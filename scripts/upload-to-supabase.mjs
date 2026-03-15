/**
 * Bulk upload raw SMS data from sms_data.json to Supabase.
 * Only uploads address, body, sms_date — no field detection.
 * All intelligence lives in the web app (smsDetector.ts).
 *
 * Usage: node scripts/upload-to-supabase.mjs
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aeypofbcgzwdrejmrwpa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFleXBvZmJjZ3p3ZHJlam1yd3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NjAwNzAsImV4cCI6MjA4OTEzNjA3MH0.y1jRcxpbArTe8gg9juEI8mvltXdQ_CW4IVwbQMmap4w';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Known bank sender codes — same as Android SmsReceiver
const KNOWN_BANK_CODES = /^[A-Z]{2}-(ICICI[TB]?(-[ST])?|SBIUPI(-[ST])?|CBSSBI|SBIBNK|SBIINB|ATMSBI|SBIPSG|HDFCBK|AXISBK|KOTAKB|IDBIBK(-[ST])?|PNBSMS|BOBTXN|CANBNK|INDBNK|UNBINB|FEDBK|PAYTMB|YESBK|EPFOHO|ICICIB)/i;

async function main() {
  console.log('Reading sms_data.json...');
  const raw = readFileSync('C:/tmp/sms_data.json', 'utf-8');
  const smsData = JSON.parse(raw);
  console.log(`Total SMS messages: ${smsData.length}`);

  // Filter to bank SMS only
  const bankSms = [];
  let skippedNonBank = 0;

  for (const sms of smsData) {
    if (!KNOWN_BANK_CODES.test(sms.address)) {
      skippedNonBank++;
      continue;
    }
    bankSms.push({
      address: sms.address,
      body: sms.body,
      sms_date: Math.floor(sms.date / 1000) * 1000, // Round to nearest second
    });
  }

  console.log(`\nResults:`);
  console.log(`  Bank SMS: ${bankSms.length}`);
  console.log(`  Non-bank (skipped): ${skippedNonBank}`);

  // Upload in batches of 500
  const BATCH_SIZE = 500;
  let uploaded = 0;
  let errors = 0;

  console.log(`\nUploading ${bankSms.length} raw SMS to Supabase...`);

  for (let i = 0; i < bankSms.length; i += BATCH_SIZE) {
    const batch = bankSms.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('transactions')
      .upsert(batch, { onConflict: 'sms_date,address,body', ignoreDuplicates: true });

    if (error) {
      console.error(`  Batch ${Math.floor(i/BATCH_SIZE)+1} ERROR:`, error.message);
      errors += batch.length;
    } else {
      uploaded += batch.length;
      console.log(`  Uploaded ${uploaded}/${bankSms.length} (batch ${Math.floor(i/BATCH_SIZE)+1})`);
    }
  }

  console.log(`\nDone! Uploaded: ${uploaded}, Errors: ${errors}`);
}

main().catch(console.error);
