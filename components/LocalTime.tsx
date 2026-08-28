"use client";

import { useEffect, useState } from "react";

/**
 * Render an instant in the reader's local format, without breaking hydration.
 *
 * `toLocaleString()` resolves differently on the server and in the browser -
 * Node picked en-SG ("6:22:11 pm") where the browser picked en-GB
 * ("18:22:11") on the very same machine. That text mismatch fails hydration
 * and silently kills every interactive element on the page, so the first
 * render must be something both sides agree on.
 */
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`);

  useEffect(() => setText(new Date(iso).toLocaleString()), [iso]);

  return <time dateTime={iso}>{text}</time>;
}
