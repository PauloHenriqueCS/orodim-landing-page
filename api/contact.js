// POST /api/contact
//
// Sends the public contact form to contato@orodim.com.br via the Resend
// HTTP API. Runs server-side only (Vercel Serverless Function) so the
// RESEND_API_KEY never reaches the browser and the recipient can't be
// changed from the client.
//
// Requires the RESEND_API_KEY environment variable. The FROM address below
// uses the auth.orodim.com.br sending domain, already verified in Resend.

const RECIPIENT = "contato@orodim.com.br";
const FROM = "Orodim <noreply@auth.orodim.com.br>";

const CATEGORIES = {
  support: "Suporte técnico",
  account: "Conta e acesso",
  billing: "Cobrança e assinatura",
  privacy: "Privacidade e LGPD",
  deletion: "Exclusão de conta",
  suggestion: "Sugestão",
  other: "Outro"
};

const LIMITS = { name: 120, subject: 150, message: 5000, email: 200 };
const ALLOWED_KEYS = ["name", "email", "category", "subject", "message", "company"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Best-effort, per-instance rate limit. Serverless instances are ephemeral
// and not shared across regions or cold starts, so this reduces obvious
// scripted abuse but is not a substitute for an edge/WAF-level limiter.
// Swap `rateLimited` for a shared store (Upstash, Supabase) if that's needed.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;
const hits = new Map();

function rateLimited(key) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    hits.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || "desconhecido";
}

// Placeholder for a future Cloudflare Turnstile check. Wire a `turnstileToken`
// field through ALLOWED_KEYS and call this before the rate-limit check once
// there is evidence of abuse that the honeypot + rate limit don't cover.
async function verifyTurnstile(/* token */) {
  return true;
}

function validate(body) {
  const errors = {};
  const extraKeys = Object.keys(body || {}).filter((key) => !ALLOWED_KEYS.includes(key));
  if (extraKeys.length > 0) {
    return { errors: { _form: "Campos inesperados." } };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!name || name.length < 2 || name.length > LIMITS.name) {
    errors.name = "Nome inválido.";
  }
  if (!email || email.length > LIMITS.email || !EMAIL_RE.test(email)) {
    errors.email = "E-mail inválido.";
  }
  if (!CATEGORIES[category]) {
    errors.category = "Categoria inválida.";
  }
  if (!subject || subject.length < 3 || subject.length > LIMITS.subject) {
    errors.subject = "Assunto inválido.";
  }
  if (!message || message.length < 10 || message.length > LIMITS.message) {
    errors.message = "Mensagem inválida.";
  }

  return { errors, values: { name, email, category, subject, message } };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = null;
    }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Requisição inválida." });
  }

  // Honeypot: real users never see or fill this field. Pretend success so
  // scripted submissions don't learn anything from the response.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return res.status(200).json({ ok: true });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Muitas solicitações. Tente novamente em alguns minutos." });
  }

  const turnstileOk = await verifyTurnstile();
  if (!turnstileOk) {
    return res.status(400).json({ error: "Não foi possível validar a solicitação." });
  }

  const { errors, values } = validate(body);
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: "Verifique os campos do formulário.", fields: errors });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[contact] RESEND_API_KEY não configurada");
    return res.status(503).json({ error: "Serviço de e-mail indisponível no momento." });
  }

  const categoryLabel = CATEGORIES[values.category];
  const submittedAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const userAgent = req.headers["user-agent"] || "desconhecido";

  const textBody = [
    `Data/hora: ${submittedAt}`,
    `Nome: ${values.name}`,
    `E-mail: ${values.email}`,
    `Categoria: ${categoryLabel}`,
    `Assunto: ${values.subject}`,
    "",
    "Mensagem:",
    values.message,
    "",
    "--- Informações técnicas (uso interno para investigação de abuso) ---",
    `IP: ${ip}`,
    `User-Agent: ${userAgent}`
  ].join("\n");

  const htmlBody =
    "<div>" +
    `<p><strong>Data/hora:</strong> ${escapeHtml(submittedAt)}</p>` +
    `<p><strong>Nome:</strong> ${escapeHtml(values.name)}</p>` +
    `<p><strong>E-mail:</strong> ${escapeHtml(values.email)}</p>` +
    `<p><strong>Categoria:</strong> ${escapeHtml(categoryLabel)}</p>` +
    `<p><strong>Assunto:</strong> ${escapeHtml(values.subject)}</p>` +
    "<p><strong>Mensagem:</strong></p>" +
    `<p>${escapeHtml(values.message).replace(/\n/g, "<br>")}</p>` +
    "<hr>" +
    `<p style="color:#666;font-size:12px">Informações técnicas (uso interno para investigação de abuso)<br>` +
    `IP: ${escapeHtml(ip)}<br>` +
    `User-Agent: ${escapeHtml(userAgent)}</p>` +
    "</div>";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM,
        to: [RECIPIENT],
        reply_to: values.email,
        subject: `[Orodim · ${categoryLabel}] ${values.subject}`,
        text: textBody,
        html: htmlBody
      })
    });

    if (!response.ok) {
      console.error(`[contact] Resend respondeu status ${response.status}`);
      return res.status(502).json({ error: "Não foi possível enviar sua mensagem agora." });
    }

    console.log(`[contact] enviado categoria=${values.category}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[contact] falha ao chamar a Resend:", err instanceof Error ? err.message : "erro desconhecido");
    return res.status(502).json({ error: "Não foi possível enviar sua mensagem agora." });
  }
};
