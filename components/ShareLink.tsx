"use client";

import { useEffect, useState } from "react";

export function ShareLink() {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const { origin, pathname } = location;
    setUrl(origin + pathname.replace(/\/(round|results)\/.*$/, ""));
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="row" style={{ flexWrap: "nowrap" }}>
      <input readOnly value={url} className="mono" onFocus={(e) => e.target.select()} />
      <button type="button" className="ghost" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
