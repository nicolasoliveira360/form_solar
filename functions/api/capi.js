/* ==========================================================
   API de Conversões da Meta — Cloudflare Pages Function
   Rota: POST /api/capi

   Variáveis de ambiente (Cloudflare Pages > Settings > Variables and Secrets):
     META_PIXEL_ID          ID do pixel (não é segredo)
     META_ACCESS_TOKEN      token da API de Conversões (SEGREDO — nunca no front-end)
     ALLOWED_ORIGIN         (opcional) ex.: https://seusite.com — recusa chamadas de outros domínios
     META_TEST_EVENT_CODE   (opcional) código da aba "Teste de eventos"; remova ao publicar
   ========================================================== */

const GRAPH_VERSION = "v23.0";
const ALLOWED_EVENTS = ["Lead", "LeadQualificado", "ViewContent", "Schedule"];
const MAX_BODY_BYTES = 8 * 1024;

export async function onRequestPost({ request, env }) {
  if (!env.META_PIXEL_ID || !env.META_ACCESS_TOKEN) {
    return json({ ok: false, error: "CAPI não configurada" }, 500);
  }

  if (env.ALLOWED_ORIGIN) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== env.ALLOWED_ORIGIN) return json({ ok: false, error: "origem não permitida" }, 403);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "corpo grande demais" }, 413);

  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ ok: false, error: "JSON inválido" }, 400); }

  if (!ALLOWED_EVENTS.includes(body.event_name) || !body.event_id) {
    return json({ ok: false, error: "evento inválido" }, 400);
  }

  const event = {
    event_name: body.event_name,
    event_id: String(body.event_id),            // mesmo ID do pixel: a Meta conta o evento uma vez só
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_source_url: String(body.event_source_url || ""),
    user_data: await buildUserData(body, request),
    custom_data: { content_name: String((body.custom_data && body.custom_data.content_name) || body.event_name) }
  };

  const payload = { data: [event], access_token: env.META_ACCESS_TOKEN };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  const res = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + env.META_PIXEL_ID + "/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await res.json().catch(function () { return {}; });

  if (!res.ok) {
    console.error("[capi] Meta recusou o evento:", JSON.stringify(result));
    return json({ ok: false, error: (result.error && result.error.message) || "erro na Meta" }, 502);
  }
  return json({ ok: true, events_received: result.events_received, fbtrace_id: result.fbtrace_id });
}

/* ----------------------------------------------------------
   Dados do lead: normalizados e com hash SHA-256 (exigência da Meta)
   ---------------------------------------------------------- */
async function buildUserData(body, request) {
  const u = body.user || {};
  const userData = {
    client_ip_address: request.headers.get("CF-Connecting-IP") || "",
    client_user_agent: request.headers.get("User-Agent") || "",
    country: [await sha256("br")]
  };
  if (body.fbp) userData.fbp = String(body.fbp);
  if (body.fbc) userData.fbc = String(body.fbc);

  const phone = normalizePhone(u.whatsapp);
  if (phone) {
    const hashedPhone = await sha256(phone);
    userData.ph = [hashedPhone];
    userData.external_id = [hashedPhone];        // identificador estável do lead
  }

  const email = String(u.email || "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) userData.em = [await sha256(email)];

  const nameParts = normalizeText(u.nome).split(" ").filter(Boolean);
  if (nameParts.length) userData.fn = [await sha256(nameParts[0])];
  if (nameParts.length > 1) userData.ln = [await sha256(nameParts[nameParts.length - 1])];

  const place = String(u.cidade || "").split(/[\/\-,]/);
  const city = normalizeText(place[0]).replace(/\s/g, "");
  const state = normalizeText(place[1]).replace(/\s/g, "");
  if (city) userData.ct = [await sha256(city)];
  if (state.length === 2) userData.st = [await sha256(state)];

  return userData;
}

function normalizeText(value) {
  return String(value || "")
    .trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // tira acentos
    .replace(/[^a-z\s]/g, "");
}

// DDD + número -> 55 + DDD + número, só dígitos
function normalizePhone(value) {
  let d = String(value || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d.length === 12 || d.length === 13 ? d : "";
}

async function sha256(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
