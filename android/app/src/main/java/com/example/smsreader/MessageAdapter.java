package com.example.smsreader;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MessageAdapter extends RecyclerView.Adapter<MessageAdapter.ViewHolder> {

    public interface OnMessageLongClickListener {
        void onMessageLongClick(SmsMessage message);
    }

    private static final int TYPE_INCOMING = 0;
    private static final int TYPE_OUTGOING = 1;

    private List<SmsMessage> messages;
    private OnMessageLongClickListener longClickListener;

    public MessageAdapter(List<SmsMessage> messages) {
        this.messages = messages;
    }

    public MessageAdapter(List<SmsMessage> messages, OnMessageLongClickListener longClickListener) {
        this.messages = messages;
        this.longClickListener = longClickListener;
    }

    @Override
    public int getItemViewType(int position) {
        return messages.get(position).isIncoming() ? TYPE_INCOMING : TYPE_OUTGOING;
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        int layout = (viewType == TYPE_INCOMING)
                ? R.layout.item_message_incoming
                : R.layout.item_message_outgoing;
        View view = LayoutInflater.from(parent.getContext()).inflate(layout, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        SmsMessage msg = messages.get(position);
        holder.tvBody.setText(msg.getBody());
        holder.tvTime.setText(formatTime(msg.getDate()));

        if (longClickListener != null) {
            holder.itemView.setOnLongClickListener(v -> {
                longClickListener.onMessageLongClick(msg);
                return true;
            });
        }
    }

    @Override
    public int getItemCount() {
        return messages.size();
    }

    private String formatTime(long timestamp) {
        return new SimpleDateFormat("MMM d, h:mm a", Locale.getDefault()).format(new Date(timestamp));
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvBody, tvTime;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvBody = itemView.findViewById(R.id.tvBody);
            tvTime = itemView.findViewById(R.id.tvTime);
        }
    }
}
