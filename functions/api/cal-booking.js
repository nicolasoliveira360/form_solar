/* ==========================================================
   Reunião marcada no Cal.com -> Twenty CRM — Cloudflare Pages Function
   Rota: POST /api/cal-booking

   O Cal.com chama esta rota (webhook) quando uma reunião é criada, remarcada ou cancelada.
   A rota confere a assinatura do Cal.com e repassa os dados ao workflow "Reunião agendada
   no Cal.com" do Twenty: criada/remarcada move a oportunidade para "Meeting" e grava a data;
   cancelada devolve a oportunidade para "Screening" e marca o comparecimento como "Cancelou".

   Variáveis (Cloudflare Pages > projeto > Settings > Variables and Secrets):
     CAL_WEBHOOK_SECRET        o mesmo "Secret" configurado no webhook do Cal.com (SEGREDO)
     TWENTY_CAL_WEBHOOK_URL    URL do webhook do workflow do Cal.com no Twenty (SEGREDO)
   ========================================================== */

const MAX_BODY_BYTES = 64 * 1024;
const FORWARDED_EVENTS = ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"];

export async function onRequestPost({ request, env }) {
  if (!env.CAL_WEBHOOK_SECRET || !env.TWENTY_CAL_WEBHOOK_URL) {
    return json({ ok: false, error: "integração não configurada" }, 500);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "corpo grande demais" }, 413);

  const signature = request.headers.get("X-Cal-Signature-256") || "";
  if (!(await isValidSignature(raw, signature, env.CAL_WEBHOOK_SECRET))) {
    return json({ ok: false, error: "assinatura inválida" }, 401);
  }

  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ ok: false, error: "JSON inválido" }, 400); }

  // PING (teste do Cal.com), cancelamentos etc.: confirma o recebimento e não faz nada
  if (!FORWARDED_EVENTS.includes(body.triggerEvent)) return json({ ok: true, ignored: body.triggerEvent });

  const booking = body.payload || {};
  const attendee = (booking.attendees && booking.attendees[0]) || {};
  if (!attendee.email || !booking.startTime) return json({ ok: false, error: "reserva sem e-mail ou horário" }, 400);

  const res = await fetch(env.TWENTY_CAL_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      evento: body.triggerEvent,
      email: String(attendee.email).trim().toLowerCase(),
      nome: String(attendee.name || ""),
      inicio: booking.startTime,
      fim: booking.endTime || "",
      titulo: String(booking.title || ""),
      uid: String(booking.uid || "")
    })
  });

  if (!res.ok) {
    console.error("[cal-booking] Twenty recusou:", res.status, await res.text().catch(function () { return ""; }));
    return json({ ok: false, error: "erro no CRM" }, 502);
  }
  return json({ ok: true });
}

/* HMAC-SHA256 do corpo bruto, em hexadecimal, comparado em tempo constante */
async function isValidSignature(rawBody, signature, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
