import type { Log } from "shared";

export const getLogSummary = (log: Pick<Log, "type" | "raw">): string => {
  if (log.type === "http") {
    const firstLine = log.raw.split(/\r?\n/, 1)[0] ?? "";
    const match = /^(\S+)\s+(\S+)\s+HTTP\/\d(?:\.\d)?\s*$/.exec(firstLine);
    return match ? `${match[1]} ${match[2]}` : "HTTP request";
  }

  // Read only the envelope, never matching fields inside a message body.
  const envelope = log.raw.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const fields = new Map<string, string>();
  for (const line of envelope.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toUpperCase();
    const value = line.slice(separator + 1).trim();
    if (value && !fields.has(key)) fields.set(key, value);
  }
  if (log.type === "dns") {
    return (
      [fields.get("QTYPE"), fields.get("QNAME")].filter(Boolean).join(" ") ||
      "DNS query"
    );
  }
  if (log.type === "smtp") {
    const recipient = fields.get("RCPT TO");
    const sender = fields.get("MAIL FROM");
    return (
      [
        recipient !== undefined ? `To: ${recipient}` : undefined,
        sender !== undefined ? `From: ${sender}` : undefined,
      ]
        .filter(Boolean)
        .join(" · ") || "SMTP message"
    );
  }
  return "Request details";
};
