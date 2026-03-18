package com.example.smsreader.data;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.Query;

import java.util.List;

@Dao
public interface ExtractedTransactionDao {

    @Insert
    long insert(ExtractedTransactionEntity transaction);

    @Query("SELECT * FROM extracted_transaction ORDER BY sms_date DESC")
    List<ExtractedTransactionEntity> getAllTransactions();

    @Query("SELECT * FROM extracted_transaction ORDER BY sms_date DESC LIMIT :limit")
    List<ExtractedTransactionEntity> getRecentTransactions(int limit);

    @Query("SELECT * FROM extracted_transaction WHERE pattern_id = :patternId ORDER BY sms_date DESC")
    List<ExtractedTransactionEntity> getTransactionsForPattern(int patternId);

    @Query("SELECT * FROM extracted_transaction WHERE sms_date BETWEEN :from AND :to ORDER BY sms_date DESC")
    List<ExtractedTransactionEntity> getTransactionsBetweenDates(long from, long to);

    @Query("SELECT COALESCE(SUM(amount), 0) FROM extracted_transaction WHERE transaction_type = 'CREDIT'")
    double getTotalCredited();

    @Query("SELECT COALESCE(SUM(amount), 0) FROM extracted_transaction WHERE transaction_type = 'DEBIT'")
    double getTotalDebited();

    @Query("DELETE FROM extracted_transaction WHERE id = :id")
    void deleteTransaction(int id);

    @Query("SELECT * FROM extracted_transaction WHERE sms_id = :smsId LIMIT 1")
    ExtractedTransactionEntity getTransactionBySmsId(String smsId);

    @Query("SELECT * FROM extracted_transaction WHERE sms_date = :smsDate AND raw_body = :rawBody LIMIT 1")
    ExtractedTransactionEntity findBySmsDateAndBody(long smsDate, String rawBody);

    @Query("DELETE FROM extracted_transaction")
    void deleteAll();
}
