package com.example.smsreader.sync;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

/** Separate small database so the existing app database needs no migration. */
@Database(entities = {OutboxEntity.class}, version = 1, exportSchema = false)
public abstract class OutboxDatabase extends RoomDatabase {

    private static volatile OutboxDatabase INSTANCE;

    public abstract OutboxDao dao();

    public static OutboxDatabase get(Context context) {
        if (INSTANCE == null) {
            synchronized (OutboxDatabase.class) {
                if (INSTANCE == null) {
                    INSTANCE = Room.databaseBuilder(context.getApplicationContext(),
                            OutboxDatabase.class, "outbox_db")
                        .fallbackToDestructiveMigration()
                        .build();
                }
            }
        }
        return INSTANCE;
    }
}
