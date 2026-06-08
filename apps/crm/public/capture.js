/*!
 * CRM Persia — capture.js
 * Coleta leads de formulários e envia para o CRM via POST /api/leads/inbound.
 *
 * Uso:
 *   <script
 *     src="https://crm.funilpersia.top/capture.js"
 *     data-source-id="<ID DA ORIGEM>"
 *     data-api-key="pk_live_SUA_CHAVE_AQUI"
 *   ></script>
 *
 * API manual:
 *   window.CRMCapture.send({ name, phone, email, ... })
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuração
  // ---------------------------------------------------------------------------

  var script =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName("script");
      return s[s.length - 1];
    })();

  var SOURCE_ID = script && script.getAttribute("data-source-id");
  var API_KEY = script && script.getAttribute("data-api-key");
  var ENDPOINT =
    (script && script.getAttribute("data-endpoint")) ||
    "https://crm.funilpersia.top/api/leads/inbound";

  if (!SOURCE_ID || !API_KEY) {
    console.warn(
      "[CRM Capture] data-source-id e data-api-key são obrigatórios."
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // UTMs — captura na página de entrada e persiste na sessão
  // ---------------------------------------------------------------------------

  var UTM_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
  ];
  var UTM_STORAGE_KEY = "_crm_utms";

  function captureUtms() {
    var params = new URLSearchParams(window.location.search);
    var utms = {};
    UTM_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) utms[k] = v;
    });
    if (Object.keys(utms).length > 0) {
      try {
        sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(utms));
      } catch (e) {}
      return utms;
    }
    // Sem UTMs na URL → tenta recuperar da sessão anterior
    try {
      var stored = sessionStorage.getItem(UTM_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  }

  var currentUtms = captureUtms();

  // ---------------------------------------------------------------------------
  // Fila offline (localStorage)
  // ---------------------------------------------------------------------------

  var QUEUE_KEY = "_crm_queue";

  function loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveQueue(q) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    } catch (e) {}
  }

  function enqueue(payload) {
    var q = loadQueue();
    // Evita duplicar mesma chave de idempotência na fila
    for (var i = 0; i < q.length; i++) {
      if (q[i]._idem && q[i]._idem === payload._idem) return;
    }
    q.push(payload);
    saveQueue(q);
  }

  // ---------------------------------------------------------------------------
  // Envio HTTP com retry exponencial
  // ---------------------------------------------------------------------------

  function sendOnce(payload, attempt, onSuccess) {
    fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (res.ok) {
          if (onSuccess) onSuccess();
          return;
        }
        // 409 = dedup — lead já existe, não é erro
        if (res.status === 409) {
          if (onSuccess) onSuccess();
          return;
        }
        // 4xx (exceto 429) = erro do cliente, não adianta tentar de novo
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          res.json().then(function (body) {
            console.error("[CRM Capture] Erro " + res.status + ":", body);
          });
          return;
        }
        // 5xx ou 429 → retry
        throw new Error("retry");
      })
      .catch(function () {
        if (attempt < 3) {
          setTimeout(
            function () {
              sendOnce(payload, attempt + 1, onSuccess);
            },
            Math.pow(2, attempt) * 1000
          );
        } else {
          enqueue(payload);
        }
      });
  }

  function sendLead(payload) {
    if (!navigator.onLine) {
      enqueue(payload);
      return;
    }
    sendOnce(payload, 0, null);
  }

  // ---------------------------------------------------------------------------
  // Drenagem da fila offline
  // ---------------------------------------------------------------------------

  function drainQueue() {
    if (!navigator.onLine) return;
    var q = loadQueue();
    if (q.length === 0) return;
    saveQueue([]);
    q.forEach(function (payload) {
      sendOnce(payload, 0, null);
    });
  }

  window.addEventListener("online", drainQueue);
  // Tenta drenar logo ao carregar (página pode ter ficado offline antes)
  setTimeout(drainQueue, 800);

  // ---------------------------------------------------------------------------
  // Identificação de campos por aliases comuns
  // ---------------------------------------------------------------------------

  var FIELD_ALIASES = {
    name: [
      "name",
      "nome",
      "full_name",
      "fullname",
      "full-name",
      "nome_completo",
      "nome-completo",
      "your-name",
      "contact_name",
    ],
    email: [
      "email",
      "e-mail",
      "email_address",
      "emailaddress",
      "your-email",
      "contact_email",
    ],
    phone: [
      "phone",
      "telefone",
      "fone",
      "celular",
      "whatsapp",
      "tel",
      "mobile",
      "phone_number",
      "telefone_celular",
      "numero",
    ],
  };

  function extractField(form, aliases) {
    for (var i = 0; i < aliases.length; i++) {
      var alias = aliases[i];
      var el =
        form.querySelector('[name="' + alias + '"]') ||
        form.querySelector('[id="' + alias + '"]') ||
        form.querySelector('[data-field="' + alias + '"]');
      if (el && el.value && el.value.trim()) return el.value.trim();
    }
    return undefined;
  }

  function extractHoneypot(form) {
    var el =
      form.querySelector('[name="_honeypot"]') ||
      form.querySelector('[name="honeypot"]') ||
      form.querySelector('[name="website"]');
    return el ? el.value || undefined : undefined;
  }

  // ---------------------------------------------------------------------------
  // Gerador de ID de idempotência (estável por envio, não por retry)
  // ---------------------------------------------------------------------------

  function generateIdem() {
    return (
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9)
    );
  }

  // ---------------------------------------------------------------------------
  // Montagem do payload e submit
  // ---------------------------------------------------------------------------

  function buildPayload(data) {
    var base = Object.assign(
      { source_id: SOURCE_ID },
      currentUtms,
      data,
      { _idem: generateIdem() }
    );
    // Remove chaves undefined / null / string vazia
    Object.keys(base).forEach(function (k) {
      if (base[k] === undefined || base[k] === null || base[k] === "") {
        delete base[k];
      }
    });
    return base;
  }

  // ---------------------------------------------------------------------------
  // Vincula formulários
  // ---------------------------------------------------------------------------

  function attachForm(form) {
    if (form._crmAttached) return;
    form._crmAttached = true;

    form.addEventListener("submit", function () {
      var phone = extractField(form, FIELD_ALIASES.phone);
      var email = extractField(form, FIELD_ALIASES.email);

      // Precisa de pelo menos telefone ou e-mail
      if (!phone && !email) return;

      var payload = buildPayload({
        name: extractField(form, FIELD_ALIASES.name),
        email: email,
        phone: phone,
        _honeypot: extractHoneypot(form),
      });

      sendLead(payload);
    });
  }

  function scanForms() {
    // Preferência: formulários com data-capture-form explícito
    var explicit = document.querySelectorAll("form[data-capture-form]");
    var targets = explicit.length > 0 ? explicit : document.querySelectorAll("form");
    targets.forEach(function (form) {
      attachForm(form);
    });
  }

  // Observa formulários adicionados dinamicamente (SPAs, modals, etc.)
  function watchDynamicForms() {
    if (!window.MutationObserver) return;
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeName === "FORM") {
            attachForm(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll("form").forEach(attachForm);
          }
        });
      });
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  /**
   * window.CRMCapture.send(data)
   *
   * Envia um lead manualmente sem precisar de um formulário.
   * Exemplo:
   *   CRMCapture.send({ name: 'João', phone: '11999990000' })
   */
  window.CRMCapture = {
    send: function (data) {
      if (!data || (!data.phone && !data.email)) {
        console.warn("[CRM Capture] Forneça pelo menos phone ou email.");
        return;
      }
      sendLead(buildPayload(data));
    },
  };

  // ---------------------------------------------------------------------------
  // Inicialização
  // ---------------------------------------------------------------------------

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      scanForms();
      watchDynamicForms();
    });
  } else {
    scanForms();
    watchDynamicForms();
  }
})();
