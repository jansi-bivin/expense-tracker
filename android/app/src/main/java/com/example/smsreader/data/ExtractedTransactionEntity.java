package com.example.smsreader.data;

import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "extracted_transaction")
public class ExtractedTransactionEntity {

    @PrimaryKey(autoGenerate = true)
    public int id;

    @ColumnInfo(name = "pattern_id")
    public int patternId;

    @ColumnInfo(name = "sms_id")
    public String smsId;

    @ColumnInfo(name = "sender_address")
    public String senderAddress;

    @ColumnInfo(name = "amount")
    public double amount;

    @ColumnInfo(name = "transaction_type")
    public String transactionType;

    @ColumnInfo(name = "account_number")
    public String accountNumber;

    @ColumnInfo(name = "merchant")
    public String merchant;

    @ColumnInfo(name = "balance")
    public double balance;

    @ColumnInfo(name = "reference_id")
    public String referenceId;

    @ColumnInfo(name = "transaction_date")
    public String transactionDate;

    @ColumnInfo(name = "sms_date")
    public long smsDate;

    @ColumnInfo(name = "raw_body")
    public String rawBody;

    @ColumnInfo(name = "extracted_fields_json")
    public String extractedFieldsJson;

    @ColumnInfo(name = "created_at")
    public long createdAt;
}
