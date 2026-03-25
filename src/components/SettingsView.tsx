"use client";

import { useState } from "react";
import { Category, FeatureIdea, User } from "@/lib/supabase";
import AddCategoryForm from "./AddCategoryForm";
import FeatureIdeas from "./FeatureIdeas";

interface Props {
  categories: Category[];
  featureIdeas: FeatureIdea[];
  currentUser: User | null;
  allUsers: User[];
  onAddCategory: (cat: Category) => void;
  onAddIdea: (text: string, type: "feature" | "bug") => void;
  onDeleteIdea: (id: string) => void;
  onUpdateIdea: (id: string, newText: string) => void;
  onResetData: () => void;
  onSwitchUser: (user: User) => void;
  onClose: () => void;
}

type Section = "menu" | "categories" | "feedback" | "reset" | "account";

export default function SettingsView({
  categories, featureIdeas, currentUser, allUsers,
  onAddCategory, onAddIdea, onDeleteIdea, onUpdateIdea,
  onResetData, onSwitchUser, onClose,
}: Props) {
  const [section, setSection] = useState<Section>("menu");
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  if (section === "feedback") {
    return (
      <FeatureIdeas
        ideas={featureIdeas}
        onAdd={onAddIdea}
        onDelete={onDeleteIdea}
        onUpdate={onUpdateIdea}
        onClose={() => setSection("menu")}
      />
    );
  }

  if (showAddCategory) {
    return (
      <AddCategoryForm
        onSave={(cat) => { onAddCategory(cat); setShowAddCategory(false); }}
        onClose={() => setShowAddCategory(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 sheet-backdrop z-50 flex items-end animate-fade-in" onClick={onClose}>
      <div className="sheet w-full p-5 animate-slide-up" onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "85vh", overflowY: "auto" }}>
        <div className="sheet-handle" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {section !== "menu" && (
              <button className="text-sm px-2 py-1 rounded-lg"
                style={{ color: "var(--accent)" }}
                onClick={() => { setSection("menu"); setConfirmReset(false); }}>
                ← Back
              </button>
            )}
            <span className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
              {section === "menu" ? "Settings" :
               section === "categories" ? "Categories" :
               section === "reset" ? "Reset Data" :
               section === "account" ? "Account" : "Settings"}
            </span>
          </div>
          <button className="text-xs px-3 py-1.5 rounded-lg"
            style={{ color: "var(--text-tertiary)", background: "rgba(255,255,255,0.06)" }}
            onClick={onClose}>
            Close
          </button>
        </div>

        {section === "menu" && (
          <div className="space-y-2">
            {/* Account */}
            <button className="w-full text-left px-4 py-3.5 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}
              onClick={() => setSection("account")}>
              <div className="flex items-center gap-3">
                <span className="text-lg">👤</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Account</div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {currentUser ? `${currentUser.name} — ${currentUser.is_primary ? "Primary" : "Secondary"}` : "Not logged in"}
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-tertiary)" }}><path d="M9 18l6-6-6-6" /></svg>
              </div>
            </button>

            {/* Categories */}
            <button className="w-full text-left px-4 py-3.5 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}
              onClick={() => setSection("categories")}>
              <div className="flex items-center gap-3">
                <span className="text-lg">📂</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Categories</div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {categories.length} categories configured
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-tertiary)" }}><path d="M9 18l6-6-6-6" /></svg>
              </div>
            </button>

            {/* Feedback / Feature Ideas */}
            <button className="w-full text-left px-4 py-3.5 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}
              onClick={() => setSection("feedback")}>
              <div className="flex items-center gap-3">
                <span className="text-lg">💡</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Feedback & Ideas</div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {featureIdeas.filter(i => i.status === "pending").length} pending items
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-tertiary)" }}><path d="M9 18l6-6-6-6" /></svg>
              </div>
            </button>

            {/* Reset Data */}
            <button className="w-full text-left px-4 py-3.5 rounded-xl transition-all"
              style={{ background: "rgba(255,90,110,0.04)", border: "1px solid rgba(255,90,110,0.15)" }}
              onClick={() => setSection("reset")}>
              <div className="flex items-center gap-3">
                <span className="text-lg">🗑️</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold" style={{ color: "var(--accent-red)" }}>Reset Data</div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    Delete all transactions & dues
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-tertiary)" }}><path d="M9 18l6-6-6-6" /></svg>
              </div>
            </button>

            {/* Version */}
            <div className="text-center pt-3">
              <span className="text-[10px]" style={{ color: "var(--text-tertiary)", opacity: 0.4 }}>
                v{process.env.APP_VERSION}
              </span>
            </div>
          </div>
        )}

        {section === "account" && (
          <div className="space-y-3">
            {currentUser && (
              <div className="px-4 py-3 rounded-xl" style={{ background: "rgba(123,108,246,0.08)", border: "1px solid rgba(123,108,246,0.2)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold"
                    style={{ background: currentUser.is_primary ? "linear-gradient(135deg, #7b6cf6, #5b4cd4)" : "linear-gradient(135deg, #00d4a1, #00a67d)", color: "#fff" }}>
                    {currentUser.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{currentUser.name}</div>
                    <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                      {currentUser.is_primary ? "Primary account" : "Secondary account"} — {currentUser.phone_number}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {allUsers.length > 1 && (
              <>
                <div className="section-label mt-4 mb-2">Switch account</div>
                {allUsers.filter(u => u.id !== currentUser?.id).map(u => (
                  <button key={u.id} className="w-full text-left px-4 py-3 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}
                    onClick={() => onSwitchUser(u)}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ background: u.is_primary ? "linear-gradient(135deg, #7b6cf6, #5b4cd4)" : "linear-gradient(135deg, #00d4a1, #00a67d)", color: "#fff" }}>
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{u.name}</div>
                        <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                          {u.is_primary ? "Primary" : "Secondary"}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {section === "categories" && (
          <div className="space-y-2">
            {categories.map(cat => (
              <div key={cat.id} className="px-4 py-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{cat.name}</div>
                    <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                      {cat.cap ? `₹${cat.cap.toLocaleString("en-IN")} / ${cat.recurrence || "Monthly"}` : "No cap"}
                      {cat.visible_to && cat.visible_to !== "all" ? ` — ${cat.visible_to} only` : ""}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <button
              className="w-full py-3 rounded-xl text-sm font-semibold mt-3"
              style={{ background: "rgba(123,108,246,0.1)", color: "var(--accent)", border: "1px dashed rgba(123,108,246,0.3)" }}
              onClick={() => setShowAddCategory(true)}>
              + Add Category
            </button>
          </div>
        )}

        {section === "reset" && (
          <div className="space-y-4">
            <div className="px-4 py-4 rounded-xl" style={{ background: "rgba(255,90,110,0.06)", border: "1px solid rgba(255,90,110,0.2)" }}>
              <div className="text-sm font-semibold mb-2" style={{ color: "var(--accent-red)" }}>
                Warning: This is destructive
              </div>
              <div className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                This will permanently delete all transactions and dues.
                Users and categories will be kept.
                This action cannot be undone.
              </div>
            </div>

            {!confirmReset ? (
              <button className="w-full py-3 rounded-xl text-sm font-semibold"
                style={{ background: "rgba(255,90,110,0.1)", color: "var(--accent-red)", border: "1px solid rgba(255,90,110,0.25)" }}
                onClick={() => setConfirmReset(true)}>
                Reset All Data
              </button>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-center" style={{ color: "var(--accent-red)" }}>
                  Are you sure? This cannot be undone.
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 py-3 rounded-xl text-sm font-semibold"
                    style={{ background: "var(--accent-red)", color: "#fff" }}
                    onClick={() => { onResetData(); onClose(); }}>
                    Yes, Delete Everything
                  </button>
                  <button className="flex-1 py-3 rounded-xl text-sm font-semibold btn-ghost"
                    onClick={() => setConfirmReset(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
