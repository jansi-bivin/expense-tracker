package com.example.smsreader.parser;

public enum FieldType {
    AMOUNT("[0-9,]+\\.?\\d{0,2}"),
    ACCOUNT_NUMBER("[Xx*]*\\d{4,}"),
    TRANSACTION_TYPE("(?:credited|debited|withdrawn|deposited|received|sent|transferred|reversed)"),
    MERCHANT(".+?"),
    DATE("\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}"),
    BALANCE("[0-9,]+\\.?\\d{0,2}"),
    REFERENCE_ID("[A-Za-z0-9]+"),
    CUSTOM(".+?");

    private final String captureRegex;

    FieldType(String captureRegex) {
        this.captureRegex = captureRegex;
    }

    public String getCaptureRegex() {
        return captureRegex;
    }
}
