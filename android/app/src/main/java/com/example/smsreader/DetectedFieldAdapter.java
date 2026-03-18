package com.example.smsreader;

import android.graphics.drawable.GradientDrawable;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.example.smsreader.parser.DetectedField;

import java.util.List;

public class DetectedFieldAdapter extends RecyclerView.Adapter<DetectedFieldAdapter.ViewHolder> {

    public interface OnFieldRemovedListener {
        void onFieldRemoved(int position);
    }

    private final List<DetectedField> fields;
    private final OnFieldRemovedListener listener;

    public DetectedFieldAdapter(List<DetectedField> fields, OnFieldRemovedListener listener) {
        this.fields = fields;
        this.listener = listener;
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_detected_field, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        DetectedField field = fields.get(position);

        holder.tvFieldType.setText(field.getFieldType().name());
        holder.etFieldName.setText(field.getFieldName());
        holder.tvValue.setText(field.getValue());

        // Set badge color based on field type
        int color;
        switch (field.getFieldType()) {
            case AMOUNT: color = 0xFF4CAF50; break;   // green
            case BALANCE: color = 0xFF2196F3; break;   // blue
            case ACCOUNT_NUMBER: color = 0xFF9C27B0; break; // purple
            case TRANSACTION_TYPE: color = 0xFFFF9800; break; // orange
            case MERCHANT: color = 0xFF795548; break;  // brown
            case DATE: color = 0xFF607D8B; break;      // blue-gray
            case REFERENCE_ID: color = 0xFF00BCD4; break; // cyan
            default: color = 0xFF9E9E9E; break;        // gray
        }
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(color);
        bg.setCornerRadius(20);
        holder.tvFieldType.setBackground(bg);

        // Update field name when edited
        if (holder.textWatcher != null) {
            holder.etFieldName.removeTextChangedListener(holder.textWatcher);
        }
        holder.textWatcher = new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override
            public void afterTextChanged(Editable s) {
                field.setFieldName(s.toString());
            }
        };
        holder.etFieldName.addTextChangedListener(holder.textWatcher);

        holder.btnRemove.setOnClickListener(v -> {
            int pos = holder.getAdapterPosition();
            if (pos != RecyclerView.NO_POSITION) {
                fields.remove(pos);
                notifyItemRemoved(pos);
                if (listener != null) listener.onFieldRemoved(pos);
            }
        });
    }

    @Override
    public int getItemCount() {
        return fields.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvFieldType, tvValue, btnRemove;
        EditText etFieldName;
        TextWatcher textWatcher;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvFieldType = itemView.findViewById(R.id.tvFieldType);
            etFieldName = itemView.findViewById(R.id.etFieldName);
            tvValue = itemView.findViewById(R.id.tvValue);
            btnRemove = itemView.findViewById(R.id.btnRemove);
        }
    }
}
