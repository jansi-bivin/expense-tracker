package com.example.smsreader.sync;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.Query;
import androidx.room.Update;

import java.util.List;

@Dao
public interface OutboxDao {

    @Insert
    long insert(OutboxEntity e);

    @Update
    void update(OutboxEntity e);

    @Query("SELECT * FROM outbox WHERE smsDate BETWEEN :from AND :to")
    List<OutboxEntity> inWindow(long from, long to);

    @Query("SELECT * FROM outbox WHERE status = 'pending' ORDER BY smsDate ASC LIMIT :limit")
    List<OutboxEntity> pending(int limit);

    @Query("SELECT COUNT(*) FROM outbox WHERE status = 'pending'")
    int pendingCount();

    @Query("SELECT source, COUNT(*) AS n FROM outbox WHERE createdAt > :since AND status != 'dup' GROUP BY source")
    List<SourceCount> capturedSince(long since);

    @Query("DELETE FROM outbox WHERE status != 'pending' AND createdAt < :before")
    int prune(long before);

    /** Row shape for capturedSince(). */
    class SourceCount {
        public String source;
        public int n;
    }
}
