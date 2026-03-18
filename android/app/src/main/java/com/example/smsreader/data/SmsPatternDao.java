package com.example.smsreader.data;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.Query;
import androidx.room.Update;

import java.util.List;

@Dao
public interface SmsPatternDao {

    @Insert
    long insert(SmsPatternEntity pattern);

    @Update
    void update(SmsPatternEntity pattern);

    @Query("SELECT * FROM sms_pattern ORDER BY created_at DESC")
    List<SmsPatternEntity> getAllPatterns();

    @Query("SELECT * FROM sms_pattern WHERE is_active = 1 ORDER BY created_at DESC")
    List<SmsPatternEntity> getActivePatterns();

    @Query("SELECT * FROM sms_pattern WHERE LOWER(sender_address) = LOWER(:sender) AND is_active = 1")
    List<SmsPatternEntity> getActivePatternsForSender(String sender);

    @Query("DELETE FROM sms_pattern WHERE id = :id")
    void deletePattern(int id);

    @Query("SELECT * FROM sms_pattern WHERE id = :id")
    SmsPatternEntity getPatternById(int id);
}
