/* ==========================================================
   Entrada de leads no Twenty CRM — Cloudflare Pages Function
   Rota: POST /api/lead

   O formulário chama esta rota (mesmo domínio) e ela repassa o lead ao webhook do
   workflow "Novo lead do formulário (site)" no Twenty. Assim a URL do webhook fica
   escondida do navegador.

   Variáveis (Cloudflare Pages > projeto > Settings > Variables and Secrets):
     TWENTY_WEBHOOK_URL   URL do webhook do workflow no Twenty (SEGREDO)
     ALLOWED_ORIGIN       (opcional) ex.: https://seusite.com
   ========================================================== */

const MAX_BODY_BYTES = 8 * 1024;
const MAX_FIELD_LENGTH = 300;

// Campos aceitos do formulário (qualquer outro é descartado)
const TEXT_FIELDS = [
  "nome", "whatsapp", "email", "empresa", "cidade_uf",
  "instalacoes_mes", "origem_clientes", "investimento_mensal", "url_pagina",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"
];

export async function onRequestPost({ request, env }) {
  if (!env.TWENTY_WEBHOOK_URL) return json({ ok: false, error: "CRM não configurado" }, 500);

  if (env.ALLOWED_ORIGIN && request.headers.get("Origin") !== env.ALLOWED_ORIGIN) {
    return json({ ok: false, error: "origem não permitida" }, 403);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "corpo grande demais" }, 413);

  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ ok: false, error: "JSON inválido" }, 400); }

  const lead = {};
  TEXT_FIELDS.forEach(function (key) {
    lead[key] = String(body[key] == null ? "" : body[key]).trim().slice(0, MAX_FIELD_LENGTH);
  });

  if (!lead.nome || !lead.email || !lead.empresa) {
    return json({ ok: false, error: "campos obrigatórios ausentes" }, 400);
  }

  // Nome separado em primeiro nome e sobrenome (o Twenty guarda os dois campos)
  const parts = lead.nome.split(/\s+/);
  lead.primeiro_nome = parts[0];
  lead.sobrenome = parts.slice(1).join(" ");

  // Telefone nacional (DDD + número), sem o 55
  let digits = lead.whatsapp.replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  lead.whatsapp_digitos = digits;

  // Qualificado entra direto na etapa "Screening"; os demais ficam em "New"
  const qualified = String(body.qualificado || "").toLowerCase() === "sim";
  lead.qualificado = qualified ? "sim" : "não";
  lead.qualificado_codigo = qualified ? "SIM" : "NAO";
  lead.etapa = qualified ? "SCREENING" : "NEW";

  const res = await fetch(env.TWENTY_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lead)
  });

  if (!res.ok) {
    console.error("[lead] Twenty recusou o lead:", res.status, await res.text().catch(function () { return ""; }));
    return json({ ok: false, error: "erro no CRM" }, 502);
  }
  return json({ ok: true });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
