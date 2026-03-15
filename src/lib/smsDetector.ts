export interface DetectedTransaction {
  address: string;
  body: string;
  date: number;
  amount: number | null;
  transactionType: string | null;
  accountNumber: string | null;
  merchant: string | null;
  transactionDate: string | null;
  balance: number | null;
  referenceId: string | null;
}

function parseAmount(amountStr: string): number {
  // Remove everything except digits, dots, and commas, then strip commas
  let cleaned = amountStr.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  // Handle multiple dots — keep only the last one as decimal separator
  const lastDot = cleaned.lastIndexOf(".");
  if (lastDot >= 0) {
    cleaned = cleaned.substring(0, lastDot).replace(/\./g, "") + "." + cleaned.substring(lastDot + 1);
  }
  return parseFloat(cleaned) || 0;
}

function isMerchantFalsePositive(merchant: string): boolean {
  const lower = merchant.toLowerCase().trim();
  if (/^(your|the|a|an|this|that|bank|account|card|balance|amt|amount|date|ref|no|id|rs|inr|be|cancel|you|dispute)$/i.test(lower)) return true;
  if (/^(icici|sbi|hdfc|idbi|axis|kotak|pnb|bob|canara|union|federal|indusind|paytm|yes\s)/i.test(lower)) return true;
  if (/^(your |be )/i.test(lower)) return true;
  if (/\bbank\b/i.test(lower)) return true;
  return false;
}

export function detectFields(body: string): Partial<DetectedTransaction> {
  const result: Partial<DetectedTransaction> = {};

  // --- AMOUNT ---
  const amountRegex = /(?:^|\b)(?:Rs\.?|INR|₹)\s*([0-9,]+\.\d{2}|[0-9,]+)/gi;
  let amountMatch;
  let bestAmount: string | null = null;
  while ((amountMatch = amountRegex.exec(body)) !== null) {
    const start = amountMatch.index;
    if (start > 0 && /[a-zA-Z]/.test(body.charAt(start - 1))) continue;
    const digitsOnly = amountMatch[1].replace(/[^0-9]/g, "");
    if (digitsOnly.length > 10) continue; // Skip reference numbers
    if (!bestAmount) bestAmount = amountMatch[1];
  }
  if (!bestAmount) {
    const fallback = body.match(/(?:debited|credited|withdrawn|deposited|received|transferred|spent)\s+(?:by|for|with|of)\s+([0-9,]+\.\d{2})/i);
    if (fallback) bestAmount = fallback[1];
  }
  if (bestAmount) result.amount = parseAmount(bestAmount);

  // --- TRANSACTION TYPE ---
  const typeMatch = body.match(/\b(credited|debited|withdrawn|deposited|received|sent|transferred|reversed|spent)\b/i);
  if (typeMatch) {
    const t = typeMatch[1].toLowerCase();
    if (["credited", "deposited", "received"].includes(t)) result.transactionType = "CREDIT";
    else if (["debited", "withdrawn", "sent", "transferred", "spent"].includes(t)) result.transactionType = "DEBIT";
    else if (t === "reversed") result.transactionType = "REVERSAL";
  }

  // --- ACCOUNT NUMBER ---
  const acctMatch = body.match(/(?:A\/[cC]|a\/c|account|acct?|A\.C\.)\.?\s*(?:no\.?\s*)?[:\s]*[A-Za-z*Xx]*\d{3,}/i);
  if (acctMatch) {
    result.accountNumber = acctMatch[0].trim();
  } else {
    const cardMatch = body.match(/(?:(?:debit|credit)\s+)?card\s+[Xx*]*\d{4,}/i);
    if (cardMatch) result.accountNumber = cardMatch[0].trim();
  }

  // --- DATE ---
  const datePatterns = [
    /\b(\d{4}[-/]\d{2}[-/]\d{2})\b/,                                                          // YYYY-MM-DD
    /\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/,                                                    // DD-MM-YY
    /\b(\d{1,2}[-/](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[-/]\d{2,4})\b/i,     // DD-Mon-YY
    /\b(\d{1,2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\d{2,4})\b/i,             // DDMonYY
    /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{2,4})\b/i,      // DD Mon YYYY
  ];
  for (const p of datePatterns) {
    const m = body.match(p);
    if (m) { result.transactionDate = m[1]; break; }
  }

  // --- BALANCE ---
  const balMatch = body.match(/(?:C\.?\s*)?(?:avl\.?\s*bal|available\s*balance|bal\.?)[:\s]*(?:Rs\.?|INR|₹)?\s*([0-9,]+\.?\d{0,2})/i);
  if (balMatch) result.balance = parseAmount(balMatch[1]);

  // --- REFERENCE ---
  const refMatch = body.match(/(?:ref\.?\s*(?:no\.?)?|txn\s*(?:id|no\.?)?|UPI\s*(?:ref)?|IMPS\s*(?:ref)?)[:\s]*([A-Za-z0-9]{6,})/i);
  if (refMatch) result.referenceId = refMatch[0].trim();

  // --- MERCHANT ---
  const merchantPatterns: [RegExp, number][] = [
    [/;\s*([A-Z][A-Za-z0-9 &.''-]{2,30})\s+credited/i, 1],
    [/(?:trf|transfer)\s+to\s+([A-Z][A-Za-z0-9 &.''-]{2,30})(?=\s+Ref|\s*$|[.,;])/i, 1],
    [/towards\s+(?:Merchant\s+)?([A-Z][A-Za-z0-9 &.''-]{2,30}?)(?=\s+to\s+be|\s+is\s+|[.,;]|$)/i, 1],
    [/\b([A-Z]{2,}\*[A-Za-z0-9 ]+?)(?=\s{2,}|\s+C\.|\s+Avl|\s+Bal|[.,;]|$)/i, 1],
    [/(?:at|for)\s+([A-Z][A-Za-z0-9 &.''-]{2,30})(?=[.,;\s]|$)/i, 1],
    [/(?:to)\s+([A-Z][A-Za-z0-9 &.''-]{2,30})(?=[.,;\s]|$)/i, 1],
  ];
  for (const [pattern, group] of merchantPatterns) {
    const m = body.match(pattern);
    if (m && m[group]) {
      const merchant = m[group].trim();
      if (!isMerchantFalsePositive(merchant)) {
        result.merchant = merchant;
        break;
      }
    }
  }

  return result;
}

// Only allow known bank sender codes
const KNOWN_BANK_CODES = /^[A-Z]{2}-(ICICI[TB]?(-[ST])?|SBIUPI(-[ST])?|CBSSBI|SBIBNK|SBIINB|ATMSBI|SBIPSG|HDFCBK|AXISBK|KOTAKB|IDBIBK(-[ST])?|PNBSMS|BOBTXN|CANBNK|INDBNK|UNBINB|FEDBK|PAYTMB|YESBK|EPFOHO|ICICIB)/i;

function isKnownBankSender(address: string): boolean {
  if (KNOWN_BANK_CODES.test(address)) return true;
  return false;
}

export function processAllSms(smsData: Array<{ address: string; body: string; date: number }>): DetectedTransaction[] {
  const transactions: DetectedTransaction[] = [];

  for (const sms of smsData) {
    // Skip personal phone numbers - these are spam
    if (!isKnownBankSender(sms.address)) continue;
    const fields = detectFields(sms.body);
    if (!fields.amount || fields.amount <= 0) continue; // Skip if no amount detected

    transactions.push({
      address: sms.address,
      body: sms.body,
      date: sms.date,
      amount: fields.amount ?? null,
      transactionType: fields.transactionType ?? null,
      accountNumber: fields.accountNumber ?? null,
      merchant: fields.merchant ?? null,
      transactionDate: fields.transactionDate ?? null,
      balance: fields.balance ?? null,
      referenceId: fields.referenceId ?? null,
    });
  }

  return transactions;
}
