package com.example.smsreader.sync;

import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/** A captured bank message waiting for (or done with) upload. */
@Entity(tableName = "outbox", indices = {@Index("smsDate"), @Index("status")})
public class OutboxEntity {

    public static final String PENDING = "pending";
    public static final String SENT = "sent";
    /** Already on the server (caught by another path or an older app version). */
    public static final String DUPLICATE = "dup";
    /** Gave up after repeated server rejections. */
    public static final String FAILED = "failed";

    @PrimaryKey(autoGenerate = true)
    public long id;

    /** How it was caught: "sms" (live receiver), "notif" (notification), "scan" (inbox check). */
    public String source;
    public String address;
    public String body;
    /** BankSenders.normalize(body), used for duplicate checks. */
    public String norm;
    public long smsDate;

    public String status;
    public int attempts;
    public String lastError;
    public long createdAt;
    public long uploadedAt;
}
