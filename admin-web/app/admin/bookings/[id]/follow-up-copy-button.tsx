'use client';

import { useState } from 'react';

export default function FollowUpCopyButton({ message }: { message: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function handleCopy() {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }

      await navigator.clipboard.writeText(message);
      setStatus('copied');
      window.setTimeout(() => setStatus('idle'), 1500);
    } catch {
      setStatus('failed');
      window.setTimeout(() => setStatus('idle'), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
    >
      {status === 'copied' ? '已複製' : status === 'failed' ? '請手動複製' : '複製話術'}
    </button>
  );
}
