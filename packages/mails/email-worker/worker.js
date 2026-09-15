/**
 * Cloudflare Email Worker — inbound générique `@creezio/mails`.
 *
 * Catch-all Email Routing → POST vers l'instance client :
 *   https://{slug}.{MAIL_ROOT_DOMAIN}/api/v1/email/inbound
 *
 * Destinataires acceptés :
 *   *@ {slug}.mail.{MAIL_ROOT_DOMAIN}   (recommandé — MX sans conflit CNAME tunnel)
 *   *@ {slug}.{MAIL_ROOT_DOMAIN}        (si MX un jour compatible)
 *
 * Secrets / vars Worker :
 *   EMAIL_INBOUND_SECRET  — Bearer partagé avec le CRM
 *   MAIL_ROOT_DOMAIN      — ex. tempoflow.fr | certivan.creez.io | fidu.creez.io
 *   MAIL_SUBDOMAIN        — défaut "mail" → {slug}.mail.{root}
 *   CRM_INBOUND_URL_TEMPLATE — optionnel, défaut
 *     https://{slug}.{MAIL_ROOT_DOMAIN}/api/v1/email/inbound
 *
 * Déploiement (ops) :
 *   wrangler deploy  (voir README + wrangler.toml.example)
 */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRecipient(to, env) {
  const root = String(env.MAIL_ROOT_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");
  if (!root) return null;
  const sub = String(env.MAIL_SUBDOMAIN || "mail").trim() || "mail";
  const addr = String(to || "").trim().toLowerCase();
  const zoneMail = new RegExp(
    `^([^@]+)@([a-z0-9-]+)\\.${escapeRegex(sub)}\\.${escapeRegex(root)}$`,
    "i",
  );
  const zoneSlug = new RegExp(
    `^([^@]+)@([a-z0-9-]+)\\.${escapeRegex(root)}$`,
    "i",
  );
  let m = addr.match(zoneMail);
  if (m) {
    return {
      local: m[1],
      slug: m[2],
      domain: `${m[2]}.${sub}.${root}`,
    };
  }
  m = addr.match(zoneSlug);
  if (m) {
    const slug = m[2];
    if (slug === sub || slug === "www" || slug === "crm") return null;
    return { local: m[1], slug, domain: `${slug}.${root}` };
  }
  return null;
}

function inboundUrl(slug, env) {
  const root = String(env.MAIL_ROOT_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");
  const tpl = String(
    env.CRM_INBOUND_URL_TEMPLATE ||
      `https://{slug}.${root}/api/v1/email/inbound`,
  ).trim();
  return tpl.replaceAll("{slug}", slug).replaceAll("{root}", root);
}

async function streamToArrayBuffer(stream) {
  const reader = stream.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

/** Parse MIME minimal (text/plain, text/html, multipart). */
async function parseRawEmail(rawBuffer) {
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(rawBuffer);
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const headerPart = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
  const bodyPart =
    headerEnd >= 0 ? raw.slice(headerEnd).replace(/^\r?\n\r?\n/, "") : "";

  const headers = {};
  let current = "";
  for (const line of headerPart.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] += " " + line.trim();
      continue;
    }
    const i = line.indexOf(":");
    if (i < 0) continue;
    current = line.slice(0, i).trim().toLowerCase();
    headers[current] = line.slice(i + 1).trim();
  }

  let text = null;
  let html = null;
  const attachments = [];
  const ct = headers["content-type"] || "text/plain";
  const boundaryMatch = ct.match(/boundary="?([^";]+)"?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = bodyPart.split(`--${boundary}`);
    for (const part of parts) {
      if (!part || part.startsWith("--")) continue;
      const pe = part.search(/\r?\n\r?\n/);
      if (pe < 0) continue;
      const pHeaders = part.slice(0, pe);
      let pBody = part
        .slice(pe)
        .replace(/^\r?\n\r?\n/, "")
        .replace(/\r?\n$/g, "");
      const pct = (pHeaders.match(/content-type:\s*([^;\r\n]+)/i) || [])[1] || "";
      const cte =
        (pHeaders.match(/content-transfer-encoding:\s*(\S+)/i) || [])[1] || "";
      const disp =
        (pHeaders.match(/content-disposition:\s*([^;\r\n]+)/i) || [])[1] || "";
      const fname =
        (pHeaders.match(/filename\*?=(?:UTF-8''|"?)([^";\r\n]+)"?/i) ||
          [])[1] || "piece-jointe";
      if (/base64/i.test(cte)) {
        pBody = pBody.replace(/\s/g, "");
      }
      if (/attachment/i.test(disp) || (!/^text\//i.test(pct) && pct)) {
        if (/base64/i.test(cte) && pBody) {
          attachments.push({
            filename: decodeURIComponent(fname.replace(/"/g, "")),
            content_type: pct.trim() || "application/octet-stream",
            content_base64: pBody,
          });
        }
        continue;
      }
      let decoded = pBody;
      if (/base64/i.test(cte)) {
        try {
          decoded = atob(pBody);
        } catch {
          decoded = pBody;
        }
      } else if (/quoted-printable/i.test(cte)) {
        decoded = pBody
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-F]{2})/gi, (_, h) =>
            String.fromCharCode(parseInt(h, 16)),
          );
      }
      if (/text\/html/i.test(pct)) html = decoded;
      else if (/text\/plain/i.test(pct)) text = decoded;
    }
  } else if (/text\/html/i.test(ct)) {
    html = bodyPart;
  } else {
    text = bodyPart;
  }

  return {
    message_id: headers["message-id"] || null,
    subject: headers.subject || "(sans objet)",
    text,
    html,
    headers,
    attachments,
  };
}

export default {
  async email(message, env) {
    const secret = (env.EMAIL_INBOUND_SECRET || "").trim();
    if (!secret) {
      message.setReject("EMAIL_INBOUND_SECRET manquant");
      return;
    }
    if (!(env.MAIL_ROOT_DOMAIN || "").trim()) {
      message.setReject("MAIL_ROOT_DOMAIN manquant");
      return;
    }

    const to = message.to;
    const from = message.from;
    const parsedTo = parseRecipient(to, env);
    if (!parsedTo) {
      message.setReject("Destinataire non reconnu pour cette zone");
      return;
    }

    const slug = parsedTo.slug;
    const rawBuffer = await streamToArrayBuffer(message.raw);
    const parsed = await parseRawEmail(rawBuffer);

    if (!parsed.text && !parsed.html && rawBuffer.byteLength < 200_000) {
      parsed.text = new TextDecoder("utf-8", { fatal: false }).decode(rawBuffer);
    }

    const payload = {
      message_id: parsed.message_id,
      from,
      to,
      subject: message.headers.get("subject") || parsed.subject,
      text: parsed.text,
      html: parsed.html,
      received_at: new Date().toISOString(),
      headers: {
        "message-id": message.headers.get("message-id") || "",
        subject: message.headers.get("subject") || "",
      },
      attachments: parsed.attachments,
    };

    let attBytes = 0;
    payload.attachments = (payload.attachments || []).filter((a) => {
      const n = Math.floor((a.content_base64.length * 3) / 4);
      if (attBytes + n > 8 * 1024 * 1024) return false;
      attBytes += n;
      return true;
    });

    const url = inboundUrl(slug, env);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[creezio-email]", slug, res.status, errText.slice(0, 200));
      message.setReject(`CRM inbound ${res.status}`);
      return;
    }
  },
};
