/* ==========================================================
   CONFIGURAÇÃO — edite aqui
   ========================================================== */
const WEBHOOK_URL = "COLE_AQUI";             // URL que recebe o POST (JSON) com o lead

// Use true se o seu webhook bloquear o envio por CORS (ex.: Zapier). O corpo continua
// sendo JSON, mas é enviado como text/plain, o que dispensa a checagem "preflight".
const WEBHOOK_AS_TEXT_PLAIN = false;

(function () {
  "use strict";

  /* ========================================================
     Constantes
     ======================================================== */
  const STORAGE_KEY = "solarForm.v1";
  const TOTAL_QUESTIONS = 6;
  const THANKS_STEP = 7;
  const AUTO_ADVANCE_MS = 300;
  const REQUEST_TIMEOUT_MS = 15000;
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const CAPI_ENDPOINT ="/api/capi";                       // Pages Function (functions/api/capi.js)
  const CAL_LINK ="nicolas2024/reuniao-de-diagnostico";   // usuário/tipo-de-evento no Cal.com
  const CAL_NAMESPACE = "reuniao-de-diagnostico";
  const CAL_ELEMENT_ID = "my-cal-inline-reuniao-de-diagnostico";
  const UTM_KEYS =["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  // A ordem das opções define a qualificação (ver isQualified)
  const INSTALACOES = ["Até 5", "6 a 15", "16 a 30", "Mais de 30"];
  const INVESTIMENTO = ["Até R$ 2.000", "R$ 2.000 a R$ 5.000", "R$ 5.000 a R$ 10.000", "Acima de R$ 10.000"];

  /* ========================================================
     Funil de vendas — eventos no console (teste antes do pixel da Meta)
     ======================================================== */
  const FUNNEL_COLORS = {
    ViewForm: "#5A6B7D",
    FormSubmitted: "#0B2545",
    FormSubmittedQualified: "#E07F0A",
    ViewScheduling: "#5A6B7D",
    SchedulingConfirmed: "#2E7D32"
  };

  // Evento do funil -> [método do fbq, evento da Meta]. ViewForm fica de fora porque o
  // PageView já é disparado pelo código base do pixel no <head> do index.html.
  const META_EVENTS = {
    FormSubmitted: ["track", "Lead"],
    FormSubmittedQualified: ["trackCustom", "LeadQualificado"],
    ViewScheduling: ["track", "ViewContent"],
    SchedulingConfirmed: ["track", "Schedule"]
  };

  // Histórico da sessão: digite window.funnelEvents no console para conferir a ordem.
  window.funnelEvents = [];

  function track(name, data) {
    const entry = { event: name, time: new Date().toISOString(), data: data || {} };
    window.funnelEvents.push(entry);
    console.log("%c[funil] " + name, "color:#fff;background:" + (FUNNEL_COLORS[name] || "#0B2545") +
      ";padding:2px 8px;border-radius:4px;font-weight:700", entry.data);

    // Pixel (navegador) + API de Conversões (servidor) com o MESMO event_id: a Meta deduplica.
    const meta = META_EVENTS[name];
    if (!meta) return;
    const eventId = name + "." + Date.now() + "." + Math.random().toString(36).slice(2, 10);
    const params = { content_name: name };
    entry.eventId = eventId;
    if (typeof window.fbq === "function") window.fbq(meta[0], meta[1], params, { eventID: eventId });
    sendCapi(meta[1], eventId, params);
  }

  function cookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  // _fbc: cookie do pixel ou, na falta dele, montado a partir do fbclid da URL
  function metaClickId() {
    const fbc = cookie("_fbc");
    if (fbc) return fbc;
    const fbclid = new URLSearchParams(window.location.search).get("fbclid");
    return fbclid ? "fb.1." + Date.now() + "." + fbclid : "";
  }

  // Envia o evento ao nosso servidor, que guarda o token e repassa à Meta (functions/api/capi.js).
  // Nome, WhatsApp e cidade seguem em texto só até o servidor, que normaliza e aplica o hash.
  function sendCapi(eventName, eventId, customData) {
    const a = state.answers;
    fetch(CAPI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        event_name: eventName,
        event_id: eventId,
        event_source_url: window.location.href,
        fbp: cookie("_fbp"),
        fbc: metaClickId(),
        user: { nome: a.nome || "", whatsapp: a.whatsapp || "", email: a.email || "", cidade: a.cidade || "" },
        custom_data: customData
      })
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
    }).catch(function (err) {
      console.warn("[funil] API de Conversões não enviou " + eventName + ":", err.message);
    });
  }

  /* ========================================================
     Elementos
     ======================================================== */
  const screens = Array.from(document.querySelectorAll(".screen"));
  const progressEl = document.getElementById("progress");
  const progressBar = document.getElementById("progress-bar");
  const submitBtn = document.getElementById("submit-btn");
  const submitError = document.getElementById("err-submit");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ========================================================
     Estado + localStorage
     ======================================================== */
  let state = loadState();
  let locked = false;      // trava cliques durante o auto-avanço
  let submitting = false;

  function emptyState() {
    return { step: 0, answers: {}, utm: {} };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === "object") {
        const step = Number.isInteger(saved.step) ? Math.min(Math.max(saved.step, 0), TOTAL_QUESTIONS) : 0;
        return {
          step: step,
          answers: saved.answers && typeof saved.answers === "object" ? saved.answers : {},
          utm: saved.utm && typeof saved.utm === "object" ? saved.utm : {}
        };
      }
    } catch (e) { /* localStorage indisponível ou corrompido */ }
    return emptyState();
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignora */ }
  }

  function clearStorage() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignora */ }
  }

  /* ========================================================
     UTMs — capturados no carregamento
     ======================================================== */
  function captureUtms() {
    const params = new URLSearchParams(window.location.search);
    UTM_KEYS.forEach(function (key) {
      const value = params.get(key);
      if (value) state.utm[key] = value;
    });
  }

  /* ========================================================
     Navegação entre telas
     ======================================================== */
  function showStep(step, goingBack) {
    const target = screens.find(function (s) { return Number(s.dataset.step) === step; });
    if (!target) return;

    screens.forEach(function (s) {
      s.hidden = s !== target;
      s.classList.remove("enter-fwd", "enter-back");
    });
    void target.offsetWidth; // reinicia a animação
    if (!reduceMotion) target.classList.add(goingBack ? "enter-back" : "enter-fwd");

    state.step = step;
    if (step < THANKS_STEP) saveState();
    updateProgress(step);
    window.scrollTo(0, 0);
    focusScreen(target);
  }

  function updateProgress(step) {
    const pct = Math.round((Math.min(step, TOTAL_QUESTIONS) / TOTAL_QUESTIONS) * 100);
    const done = step >= THANKS_STEP ? 100 : pct;
    progressBar.style.width = done + "%";
    progressEl.setAttribute("aria-valuenow", String(done));
  }

  function focusScreen(screen) {
    // Campo de texto, quando houver; senão o título (leitores de tela)
    const field = screen.querySelector("input");
    const heading = screen.querySelector("h1, h2");
    const el = field || heading;
    if (el) el.focus({ preventScroll: true });
  }

  function next() { showStep(state.step + 1, false); }
  function back() { if (state.step > 0 && state.step < THANKS_STEP) showStep(state.step - 1, true); }

  /* ========================================================
     Máscara e validações
     ======================================================== */
  function digitsOnly(value) { return String(value || "").replace(/\D/g, ""); }

  function maskPhone(value) {
    let d = digitsOnly(value);
    if (d.length > 11 && d.indexOf("55") === 0) d = d.slice(2);   // colou com +55
    d = d.slice(0, 11);
    let out = "";
    if (d.length > 0) out = "(" + d.slice(0, 2);
    if (d.length >= 3) out += ") " + d.slice(2, 7);
    if (d.length > 7) out += "-" + d.slice(7);
    return out;
  }

  const validators = {
    1: function (f) {
      const errors = {};
      if (f.nome.value.trim().length < 2) errors.nome = "Digite seu nome (mínimo 2 letras).";
      return errors;
    },
    2: function (f) {
      const errors = {};
      if (digitsOnly(f.whatsapp.value).length !== 11) errors.whatsapp = "Digite um WhatsApp válido com DDD.";
      if (!EMAIL_PATTERN.test(f.email.value.trim())) errors.email = "Digite um e-mail válido.";
      return errors;
    },
    3: function (f) {
      const errors = {};
      if (f.empresa.value.trim().length < 2) errors.empresa = "Informe o nome da empresa.";
      if (f.cidade.value.trim().length < 2) errors.cidade = "Informe a cidade e a UF.";
      return errors;
    }
  };

  function showErrors(form, errors) {
    let firstInvalid = null;
    Array.from(form.querySelectorAll("input")).forEach(function (input) {
      const msg = errors[input.name] || "";
      const errEl = document.getElementById("err-" + input.name);
      if (errEl) errEl.textContent = msg;
      if (msg) {
        input.setAttribute("aria-invalid", "true");
        if (!firstInvalid) firstInvalid = input;
      } else {
        input.removeAttribute("aria-invalid");
      }
    });
    if (firstInvalid) firstInvalid.focus();
  }

  function clearFieldError(input) {
    input.removeAttribute("aria-invalid");
    const errEl = document.getElementById("err-" + input.name);
    if (errEl) errEl.textContent = "";
  }

  /* ========================================================
     Eventos: formulários de texto
     ======================================================== */
  document.querySelectorAll(".step-form").forEach(function (form) {
    const step = Number(form.dataset.step);

    form.addEventListener("submit", function (event) {   // botão Continuar e tecla Enter
      event.preventDefault();
      const errors = validators[step](form.elements);
      showErrors(form, errors);
      if (Object.keys(errors).length) return;

      Array.from(form.querySelectorAll("input")).forEach(function (input) {
        state.answers[input.name] = input.name === "whatsapp" ? input.value : input.value.trim();
      });
      next();
    });

    form.addEventListener("input", function (event) {
      const input = event.target;
      if (input.name === "whatsapp") input.value = maskPhone(input.value);
      clearFieldError(input);
      state.answers[input.name] = input.value;           // guarda rascunho
      saveState();
    });
  });

  /* ========================================================
     Eventos: opções de múltipla escolha
     ======================================================== */
  document.querySelectorAll(".option").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (locked || submitting) return;
      const field = btn.dataset.field;
      state.answers[field] = btn.dataset.value;
      saveState();
      markSelected(btn.closest(".options"), btn.dataset.value);

      const step = state.step;
      if (step === TOTAL_QUESTIONS) {
        submitBtn.disabled = false;
        submitError.textContent = "";
      }

      locked = true;
      setTimeout(function () {
        locked = false;
        if (state.step !== step) return;                 // usuário já navegou
        if (step === TOTAL_QUESTIONS) submit();
        else next();
      }, AUTO_ADVANCE_MS);
    });
  });

  function markSelected(group, value) {
    group.querySelectorAll(".option").forEach(function (opt) {
      const on = opt.dataset.value === value;
      opt.classList.toggle("is-selected", on);
      opt.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ========================================================
     Eventos: botões de ação (iniciar, voltar, enviar)
     ======================================================== */
  document.addEventListener("click", function (event) {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    if (action === "start") showStep(1, false);
    else if (action === "back") back();
    else if (action === "submit") submit();
  });

  /* ========================================================
     Envio
     ======================================================== */
  function isQualified(a) {
    return INSTALACOES.indexOf(a.instalacoes) >= 1 && INVESTIMENTO.indexOf(a.investimento) >= 1;
  }

  function buildPayload() {
    const a = state.answers;
    const payload = {
      nome: (a.nome || "").trim(),
      whatsapp: a.whatsapp || "",
      email: (a.email || "").trim(),
      empresa: (a.empresa || "").trim(),
      cidade_uf: (a.cidade || "").trim(),
      instalacoes_mes: a.instalacoes || "",
      origem_clientes: a.origem || "",
      investimento_mensal: a.investimento || "",
      qualificado: isQualified(a) ? "sim" : "não",
      data_hora: new Date().toISOString(),
      url_pagina: window.location.href
    };
    UTM_KEYS.forEach(function (key) { payload[key] = state.utm[key] || ""; });
    return payload;
  }

  function sendOnce(payload) {
    if (!WEBHOOK_URL || WEBHOOK_URL === "COLE_AQUI") {
      // Webhook ainda não configurado: simula o envio para permitir testes locais.
      console.warn("[form-solar] WEBHOOK_URL não configurada. Payload (não enviado):", payload);
      return new Promise(function (resolve) { setTimeout(resolve, 600); });
    }

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

    return fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": WEBHOOK_AS_TEXT_PLAIN ? "text/plain;charset=UTF-8" : "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
    }).finally(function () { clearTimeout(timer); });
  }

  function setLoading(on) {
    submitting = on;
    submitBtn.classList.toggle("is-loading", on);
    submitBtn.setAttribute("aria-busy", on ? "true" : "false");
    submitBtn.disabled = on || !state.answers.investimento;
    submitBtn.querySelector(".btn__label").textContent = on ? "Enviando..." : "Enviar";
  }

  function submit() {
    if (submitting) return;
    if (!state.answers.investimento) return;
    submitError.textContent = "";
    setLoading(true);

    const payload = buildPayload();    // mesmo payload nas duas tentativas

    sendOnce(payload)
      .catch(function () { return sendOnce(payload); })   // 1 nova tentativa
      .then(function () {
        setLoading(false);
        onSuccess(payload);
      })
      .catch(function (err) {
        console.error("[form-solar] Falha no envio:", err);
        setLoading(false);
        submitError.textContent = "Ops, algo deu errado. Tente novamente.";
      });
  }

  /* ========================================================
     Tela final
     ======================================================== */
  function onSuccess(payload) {
    clearStorage();
    state.step = THANKS_STEP;

    const qualified = payload.qualificado === "sim";
    const firstName = payload.nome.split(/\s+/)[0] || payload.nome;
    const title = document.getElementById("thanks-title");
    const text = document.getElementById("thanks-text");
    const cal = document.getElementById(CAL_ELEMENT_ID);

    track("FormSubmitted", { qualificado: payload.qualificado, instalacoes_mes: payload.instalacoes_mes, investimento_mensal: payload.investimento_mensal });
    if (qualified) track("FormSubmittedQualified", { instalacoes_mes: payload.instalacoes_mes, investimento_mensal: payload.investimento_mensal });

    if (qualified) {
      title.textContent = "✅ Recebemos suas informações, " + firstName + "!";
      text.textContent = "Último passo: escolha o melhor dia e horário para a sua reunião de diagnóstico.";
      cal.hidden = false;
      initCal(payload);
    } else {
      title.textContent = "✅ Obrigado, " + firstName + "!";
      text.textContent = "Vamos analisar seu perfil e entraremos em contato se houver encaixe.";
      cal.hidden = true;
    }

    showStep(THANKS_STEP, false);
  }

  /* ========================================================
     Agenda (Cal.com, incorporação inline)
     ======================================================== */
  let calReady = false;

  function initCal(payload) {
    if (calReady) return;
    calReady = true;
    track("ViewScheduling", { calLink: CAL_LINK });

    // Loader oficial do Cal.com
    (function (C, A, L) { let p = function (a, ar) { a.q.push(ar); }; let d = C.document; C.Cal = C.Cal || function () { let cal = C.Cal; let ar = arguments; if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; } if (ar[0] === L) { const api = function () { p(api, arguments); }; const namespace = ar[1]; api.q = api.q || []; if (typeof namespace === "string") { cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ["initNamespace", namespace]); } else p(cal, ar); return; } p(cal, ar); }; })(window, "https://app.cal.com/embed/embed.js", "init");

    Cal("init", CAL_NAMESPACE, { origin: "https://app.cal.com" });
    Cal.config = Cal.config || {};
    Cal.config.forwardQueryParams = true;

    // Nome, e-mail e resumo do lead já chegam preenchidos na página de reserva
    const notes = "Empresa: " + payload.empresa + " (" + payload.cidade_uf + ")" +
      "\nInstalações/mês: " + payload.instalacoes_mes +
      "\nOrigem dos clientes: " + payload.origem_clientes +
      "\nInvestimento mensal: " + payload.investimento_mensal +
      "\nWhatsApp: " + payload.whatsapp;

    Cal.ns[CAL_NAMESPACE]("inline", {
      elementOrSelector: "#" + CAL_ELEMENT_ID,
      config: {
        layout: "month_view",
        useSlotsViewOnSmallScreen: "true",
        theme: "light",
        name: payload.nome,
        email: payload.email,
        notes: notes
      },
      calLink: CAL_LINK
    });
    // O Cal.com avisa quando a reunião é confirmada dentro do iframe
    Cal.ns[CAL_NAMESPACE]("on", {
      action: "bookingSuccessful",
      callback: function (e) {
        const booking = (e && e.detail && e.detail.data) || {};
        track("SchedulingConfirmed", { calLink: CAL_LINK, booking: booking });
      }
    });
    Cal.ns[CAL_NAMESPACE]("ui", { theme: "light", hideEventTypeDetails: true, layout: "month_view" });
  }

  /* ========================================================
     Inicialização
     ======================================================== */
  function restoreFields() {
    const a = state.answers;
    ["nome", "whatsapp", "email", "empresa", "cidade"].forEach(function (name) {
      const input = document.querySelector('input[name="' + name + '"]');
      if (input && a[name]) input.value = name === "whatsapp" ? maskPhone(a[name]) : a[name];
    });
    document.querySelectorAll(".options").forEach(function (group) {
      const field = group.querySelector(".option").dataset.field;
      if (a[field]) markSelected(group, a[field]);
    });
    if (a.investimento) submitBtn.disabled = false;
  }

  captureUtms();
  restoreFields();
  saveState();
  showStep(state.step, false);
  track("ViewForm", { etapa: state.step, url_pagina: window.location.href });
  // Na capa, não rouba o foco do usuário
  if (state.step === 0 && document.activeElement && document.activeElement.blur) document.activeElement.blur();
})();
