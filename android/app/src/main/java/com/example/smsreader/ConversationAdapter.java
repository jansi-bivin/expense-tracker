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

public class ConversationAdapter extends RecyclerView.Adapter<ConversationAdapter.ViewHolder> {

    public interface OnConversationClickListener {
        void onConversationClick(SmsConversation conversation);
    }

    private List<SmsConversation> conversations;
    private OnConversationClickListener listener;

    public ConversationAdapter(List<SmsConversation> conversations, OnConversationClickListener listener) {
        this.conversations = conversations;
        this.listener = listener;
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_conversation, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        SmsConversation conv = conversations.get(position);

        holder.tvName.setText(conv.getDisplayName());
        holder.tvPreview.setText(conv.getLastMessage());
        holder.tvDate.setText(formatDate(conv.getLastDate()));
        holder.tvCount.setText(String.valueOf(conv.getMessageCount()));

        // Avatar initial
        String name = conv.getDisplayName();
        holder.tvAvatar.setText(name.substring(0, 1).toUpperCase());

        holder.itemView.setOnClickListener(v -> {
            if (listener != null) listener.onConversationClick(conv);
        });
    }

    @Override
    public int getItemCount() {
        return conversations.size();
    }

    public void updateData(List<SmsConversation> newData) {
        this.conversations = newData;
        notifyDataSetChanged();
    }

    private String formatDate(long timestamp) {
        long now = System.currentTimeMillis();
        long diff = now - timestamp;

        if (diff < 60 * 1000) return "Just now";
        if (diff < 60 * 60 * 1000) return (diff / (60 * 1000)) + "m ago";
        if (diff < 24 * 60 * 60 * 1000) return (diff / (60 * 60 * 1000)) + "h ago";
        if (diff < 7 * 24 * 60 * 60 * 1000) return (diff / (24 * 60 * 60 * 1000)) + "d ago";

        return new SimpleDateFormat("MMM d", Locale.getDefault()).format(new Date(timestamp));
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvAvatar, tvName, tvPreview, tvDate, tvCount;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvAvatar = itemView.findViewById(R.id.tvAvatar);
            tvName = itemView.findViewById(R.id.tvName);
            tvPreview = itemView.findViewById(R.id.tvPreview);
            tvDate = itemView.findViewById(R.id.tvDate);
            tvCount = itemView.findViewById(R.id.tvCount);
        }
    }
}
