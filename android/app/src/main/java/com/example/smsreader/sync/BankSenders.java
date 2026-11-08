package com.example.smsreader.sync;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Which messages count as bank messages, and when two texts are the same message.
 * Shared by every capture path (SMS receiver, notification listener, inbox scan).
 */
public final class BankSenders {

    private BankSenders() {}

    /** SMS originating address, e.g. "JM-ICICIT-S", "VA-IDBIBK-S". */
    private static final Pattern SMS_ADDRESS = Pattern.compile(
        "^[A-Z]{2}-(ICICI[TB]?(-[ST])?|SBIUPI(-[ST])?|CBSSBI|SBIBNK|SBIINB|ATMSBI|SBIPSG|" +
        "HDFCBK|AXISBK|KOTAKB|IDBIBK(-[ST])?|PNBSMS|BOBTXN|CANBNK|INDBNK|UNBINB|FEDBK|" +
        "PAYTMB|YESBK|EPFOHO|ICICIB)",
        Pattern.CASE_INSENSITIVE
    );

    /**
     * Sender as an SMS app shows it in a notification title: "JM-ICICIT-S",
     * "AD-ICICIT", "ICICIT", "ICICI Bank", "IDBI Bank"...
     */
    private static final Pattern NOTIFICATION_TITLE = Pattern.compile(
        "(^|[^A-Z])(ICICI|SBIUPI|CBSSBI|SBIBNK|SBIINB|ATMSBI|SBIPSG|HDFCBK|AXISBK|KOTAKB|" +
        "IDBIBK|IDBI|PNBSMS|BOBTXN|CANBNK|INDBNK|UNBINB|FEDBK|PAYTMB|YESBK|EPFOHO)",
        Pattern.CASE_INSENSITIVE
    );

    /** Text mentions an amount: "Rs. 12,444", "Rs 30", "INR 199", "₹500". */
    private static final Pattern MONEY = Pattern.compile("(rs\\.?|inr|₹)\\s*[0-9]", Pattern.CASE_INSENSITIVE);

    /** Minimum length before a partial (truncated / prefixed) text can match a full one. */
    private static final int MIN_PARTIAL = 40;

    public static boolean isBankAddress(String address) {
        return address != null && SMS_ADDRESS.matcher(address.trim()).find();
    }

    public static boolean isBankTitle(String title) {
        return title != null && NOTIFICATION_TITLE.matcher(title).find();
    }

    public static boolean mentionsMoney(String body) {
        return body != null && MONEY.matcher(body).find();
    }

    /** Lower-case, single-spaced, no trailing ellipsis — the form used for comparing texts. */
    public static String normalize(String body) {
        if (body == null) return "";
        String t = body.replace(' ', ' ').replaceAll("\\s+", " ").trim().toLowerCase(Locale.ROOT);
        if (t.endsWith("…")) t = t.substring(0, t.length() - 1).trim();
        else if (t.endsWith("...")) t = t.substring(0, t.length() - 3).trim();
        return t;
    }

    /**
     * Same message? Bank texts carry a reference number, balance or date, so identical
     * text means the same transaction. A notification may show a shortened or prefixed
     * copy, so a long enough text contained in the other also counts.
     */
    public static boolean sameMessage(String normA, String normB) {
        if (normA == null || normB == null) return false;
        if (normA.equals(normB)) return true;
        if (Math.min(normA.length(), normB.length()) < MIN_PARTIAL) return false;
        return normA.contains(normB) || normB.contains(normA);
    }
}
