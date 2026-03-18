package com.example.smsreader.data;

import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "sms_pattern")
public class SmsPatternEntity {

    @PrimaryKey(autoGenerate = true)
    public int id;

    @ColumnInfo(name = "sender_address")
    public String senderAddress;

    @ColumnInfo(name = "pattern_name")
    public String patternName;

    @ColumnInfo(name = "template_regex")
    public String templateRegex;

    @ColumnInfo(name = "original_sms_body")
    public String originalSmsBody;

    @ColumnInfo(name = "field_definitions_json")
    public String fieldDefinitionsJson;

    @ColumnInfo(name = "created_at")
    public long createdAt;

    @ColumnInfo(name = "is_active")
    public boolean isActive = true;

    public String getSenderAddress() { return senderAddress; }
    public String getTemplateRegex() { return templateRegex; }
    public String getPatternName() { return patternName; }
    public String getFieldDefinitionsJson() { return fieldDefinitionsJson; }
}
