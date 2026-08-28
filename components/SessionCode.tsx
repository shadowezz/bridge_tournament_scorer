"use client";

import { useEffect, useState } from "react";

const COOKIE = "bt_cid";
const STORAGE_KEY = "bridge-client-id";

function readCookie(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function writeCookie(value: string) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${encodeURIComponent(value)}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${secure}`;
}

/**
 * Shows the browser's anonymous id and lets a player move it between devices.
 *
 * While a round is open this id is the only thing that decides which results
 * are visible, so losing it hides your own entries until the round closes.
 * Mirroring it to localStorage restores it automatically after a cookie is
 * evicted; the visible code covers the cases that cannot be automated, like
 * switching to a different phone.
 */
export function SessionCode() {
  const [code, setCode] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const fromCookie = readCookie();
    const stored = localStorage.getItem(STORAGE_KEY);

    if (fromCookie) {
      if (stored !== fromCookie) localStorage.setItem(STORAGE_KEY, fromCookie);
      setCode(fromCookie);
    } else if (stored) {
      // The cookie was cleared but the browser still knows who it was.
      writeCookie(stored);
      location.reload();
    }
  }, []);

  function restore() {
    const next = draft.trim().toUpperCase();
    if (next.length !== 10) return;
    writeCookie(next);
    localStorage.setItem(STORAGE_KEY, next);
    location.reload();
  }

  if (!code) return null;

  return (
    <div style={{ textAlign: "right" }}>
      <button type="button" className="link" onClick={() => setOpen(!open)}>
        Session {code}
      </button>

      {open && (
        <div className="card" style={{ marginTop: ".5rem", textAlign: "left", maxWidth: "22rem" }}>
          <p className="muted" style={{ marginTop: 0 }}>
            This code identifies your entries while a round is open. Keep it to carry your
            session to another device. Once a round closes, everyone sees everything anyway.
          </p>
          <label htmlFor="restore-code">Restore a session</label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input
              id="restore-code"
              className="mono"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="10-character code"
              maxLength={10}
              autoComplete="off"
            />
            <button type="button" onClick={restore} disabled={draft.trim().length !== 10}>
              Use
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
