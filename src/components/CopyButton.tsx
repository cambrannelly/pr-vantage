"use client";

import { useState } from "react";

/** Copies text to the clipboard and confirms briefly. */
export function CopyButton({ text, label = "copy url", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this URL", text);
    }
  }
  return (
    <button onClick={copy} title={text} className={`mono text-muted transition hover:text-amber ${className}`}>
      {copied ? "copied ✓" : label}
    </button>
  );
}
