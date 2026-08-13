const STORAGE_KEY = "localchat.conversations.v2";
const LEGACY_STORAGE_KEY = "localchat.conversations.v1";
const SETTINGS_KEY = "localchat.settings.v1";

const EMPTY_EXPERIMENT = Object.freeze({
  systemPrompt: "",
  temperature: null,
  topP: null,
  seed: null,
  numCtx: null,
  numPredict: null,
});

const state = {
  conversations: [],
  activeId: null,
  generating: false,
  controller: null,
  models: [],
};

const el = {
  sidebar: document.getElementById("sidebar"),
  menuBtn: document.getElementById("menuBtn"),
  newChatBtn: document.getElementById("newChatBtn"),
  conversationList: document.getElementById("conversationList"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  modelSelect: document.getElementById("modelSelect"),
  modelMeta: document.getElementById("modelMeta"),
  experimentMeta: document.getElementById("experimentMeta"),
  settingsBtn: document.getElementById("settingsBtn"),
  chatArea: document.getElementById("chatArea"),
  welcome: document.getElementById("welcome"),
  messages: document.getElementById("messages"),
  promptInput: document.getElementById("promptInput"),
  sendBtn: document.getElementById("sendBtn"),
  stopBtn: document.getElementById("stopBtn"),
  settingsModal: document.getElementById("settingsModal"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  systemPrompt: document.getElementById("systemPrompt"),
  temperatureInput: document.getElementById("temperatureInput"),
  topPInput: document.getElementById("topPInput"),
  seedInput: document.getElementById("seedInput"),
  numCtxInput: document.getElementById("numCtxInput"),
  numPredictInput: document.getElementById("numPredictInput"),
  resetExperimentBtn: document.getElementById("resetExperimentBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  contextModal: document.getElementById("contextModal"),
  closeContextBtn: document.getElementById("closeContextBtn"),
  traceGrid: document.getElementById("traceGrid"),
  traceStatus: document.getElementById("traceStatus"),
  contextEntries: document.getElementById("contextEntries"),
};

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function clampOptionalNumber(value, minimum, maximum, integer = false) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const clamped = Math.max(minimum, Math.min(maximum, parsed));
  return integer ? Math.trunc(clamped) : clamped;
}

function normalizeExperiment(raw, fallbackSystemPrompt = "") {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    systemPrompt:
      typeof source.systemPrompt === "string"
        ? source.systemPrompt
        : (typeof fallbackSystemPrompt === "string" ? fallbackSystemPrompt : ""),
    temperature: clampOptionalNumber(source.temperature, 0, 2),
    topP: clampOptionalNumber(source.topP, 0, 1),
    seed: clampOptionalNumber(source.seed, -1, 2147483647, true),
    numCtx: clampOptionalNumber(source.numCtx, 256, 1048576, true),
    numPredict: clampOptionalNumber(source.numPredict, 1, 131072, true),
  };
}

function cloneExperiment(experiment) {
  return normalizeExperiment(experiment);
}

function defaultExperimentForNewConversation() {
  const settings = getSettings();
  if (settings.lastExperiment && typeof settings.lastExperiment === "object") {
    return normalizeExperiment(settings.lastExperiment, settings.systemPrompt || "");
  }
  return normalizeExperiment(EMPTY_EXPERIMENT, settings.systemPrompt || "");
}

function experimentOptions(experiment) {
  const profile = normalizeExperiment(experiment);
  const options = {};

  if (profile.temperature !== null) options.temperature = profile.temperature;
  if (profile.topP !== null) options.top_p = profile.topP;
  if (profile.seed !== null) options.seed = profile.seed;
  if (profile.numCtx !== null) options.num_ctx = profile.numCtx;
  if (profile.numPredict !== null) options.num_predict = profile.numPredict;

  return options;
}

function newConversation() {
  const c = {
    id: makeId(),
    title: "Nova conversa",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    model: el.modelSelect?.value || "",
    experiment: defaultExperimentForNewConversation(),
    messages: [],
  };
  state.conversations.unshift(c);
  state.activeId = c.id;
  saveConversations();
  renderAll();
  renderExperimentMeta();
  el.promptInput.focus();
}

function activeConversation() {
  return state.conversations.find(c => c.id === state.activeId) || null;
}

function normalizeConversation(c) {
  if (!c || typeof c !== "object") return null;
  const settings = getSettings();
  return {
    ...c,
    model: typeof c.model === "string" ? c.model : "",
    experiment: normalizeExperiment(c.experiment, settings.systemPrompt || ""),
    messages: Array.isArray(c.messages) ? c.messages : [],
  };
}

function loadConversations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    state.conversations = Array.isArray(parsed)
      ? parsed.map(normalizeConversation).filter(Boolean)
      : [];
  } catch {
    state.conversations = [];
  }

  if (state.conversations.length === 0) {
    newConversation();
    return;
  }

  state.activeId = state.conversations[0].id;
  saveConversations();
  renderAll();
}

function saveConversations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations));
}

function savePreferences() {
  const settings = getSettings();
  const c = activeConversation();
  settings.model = el.modelSelect.value || settings.model || "";
  if (c?.experiment) settings.lastExperiment = cloneExperiment(c.experiment);
  delete settings.systemPrompt;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function deleteConversation(id, event) {
  event.stopPropagation();
  state.conversations = state.conversations.filter(c => c.id !== id);

  if (state.activeId === id) {
    state.activeId = state.conversations[0]?.id || null;
  }

  if (state.conversations.length === 0) {
    newConversation();
    return;
  }

  saveConversations();
  renderAll();
  syncConversationModel();
  renderExperimentMeta();
}

function renderConversationList() {
  el.conversationList.innerHTML = "";

  for (const c of state.conversations) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `conversation-item ${c.id === state.activeId ? "active" : ""}`;

    const content = document.createElement("span");
    content.className = "conversation-content";

    const name = document.createElement("span");
    name.className = "conversation-name";
    name.textContent = c.title || "Nova conversa";

    const model = document.createElement("span");
    model.className = "conversation-model";
    model.textContent = c.model || "modelo não fixado";

    content.append(name, model);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-chat";
    remove.title = "Excluir conversa";
    remove.textContent = "×";
    remove.addEventListener("click", event => deleteConversation(c.id, event));

    row.append(content, remove);
    row.addEventListener("click", () => {
      state.activeId = c.id;
      renderAll();
      syncConversationModel();
      renderExperimentMeta();
      el.sidebar.classList.remove("open");
    });

    el.conversationList.appendChild(row);
  }
}

function formatSeconds(ns) {
  if (!Number.isFinite(ns) || ns <= 0) return null;
  return `${(ns / 1e9).toFixed(ns >= 10e9 ? 1 : 2)} s`;
}

function formatMetricNumber(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat("pt-BR").format(value) : null;
}

function metricsSummary(metrics) {
  if (!metrics || typeof metrics !== "object") return "";

  const parts = [];
  const promptTokens = formatMetricNumber(metrics.prompt_eval_count);
  const outputTokens = formatMetricNumber(metrics.eval_count);
  const totalTime = formatSeconds(metrics.total_duration);

  if (promptTokens) parts.push(`${promptTokens} tok entrada`);
  if (outputTokens) parts.push(`${outputTokens} tok saída`);

  if (
    Number.isFinite(metrics.eval_count) &&
    Number.isFinite(metrics.eval_duration) &&
    metrics.eval_duration > 0
  ) {
    const tokensPerSecond = metrics.eval_count / (metrics.eval_duration / 1e9);
    parts.push(`${tokensPerSecond.toFixed(1)} tok/s`);
  }

  if (totalTime) parts.push(totalTime);
  if (metrics.done_reason) parts.push(metrics.done_reason);

  return parts.join(" · ");
}

function addMessageElement(role, content, metrics = null, run = null, messageIndex = null) {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "EU" : "IA";

  const contentWrap = document.createElement("div");
  contentWrap.className = "message-content";

  const roleEl = document.createElement("div");
  roleEl.className = "message-role";
  roleEl.textContent = role === "user" ? "Você" : "LocalChat";

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = content;

  const footer = document.createElement("div");
  footer.className = "message-footer";

  const meta = document.createElement("div");
  meta.className = "message-metrics";
  const summary = metricsSummary(metrics);
  meta.textContent = summary;
  meta.classList.toggle("hidden", !summary);
  footer.appendChild(meta);

  let contextBtn = null;
  if (role === "assistant" && run && Number.isInteger(messageIndex)) {
    contextBtn = document.createElement("button");
    contextBtn.type = "button";
    contextBtn.className = "context-trace-button";
    contextBtn.textContent = run.trace ? "contexto ✓" : "contexto";
    contextBtn.title = "Inspecionar contexto e parâmetros deste ensaio";
    contextBtn.addEventListener("click", () => openContextTrace(messageIndex));
    footer.appendChild(contextBtn);
  }

  contentWrap.append(roleEl, body, footer);
  wrapper.append(avatar, contentWrap);
  el.messages.appendChild(wrapper);

  return { body, meta, contextBtn };
}

function renderMessages() {
  const c = activeConversation();
  el.messages.innerHTML = "";

  const messages = c?.messages || [];
  el.welcome.classList.toggle("hidden", messages.length > 0);

  messages.forEach((msg, index) => {
    addMessageElement(msg.role, msg.content, msg.metrics || null, msg.run || null, index);
  });

  requestAnimationFrame(scrollToBottom);
}

function renderAll() {
  renderConversationList();
  renderMessages();
  renderExperimentMeta();
}

function scrollToBottom() {
  el.chatArea.scrollTop = el.chatArea.scrollHeight;
}

function autoResize() {
  el.promptInput.style.height = "auto";
  el.promptInput.style.height = `${Math.min(el.promptInput.scrollHeight, 180)}px`;
}

function setGenerating(value) {
  state.generating = value;
  el.sendBtn.classList.toggle("hidden", value);
  el.stopBtn.classList.toggle("hidden", !value);
  el.modelSelect.disabled = value;
  el.settingsBtn.disabled = value;
}

function deriveTitle(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 42 ? `${compact.slice(0, 42)}…` : compact || "Nova conversa";
}

function captureMetrics(data) {
  const keys = [
    "total_duration",
    "load_duration",
    "prompt_eval_count",
    "prompt_eval_duration",
    "eval_count",
    "eval_duration",
    "done_reason",
  ];

  const metrics = {};
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) metrics[key] = data[key];
  }
  return metrics;
}

function selectedModel() {
  return state.models.find(model => model.name === el.modelSelect.value) || null;
}

function makeRunSnapshot(c, model) {
  const selected = selectedModel();
  return {
    model,
    digest: selected?.digest || null,
    contextMessageCount: c.messages.length,
    profile: cloneExperiment(c.experiment),
    trace: null,
    createdAt: nowIso(),
  };
}

async function sendMessage() {
  if (state.generating) return;

  const text = el.promptInput.value.trim();
  const model = el.modelSelect.value;
  const c = activeConversation();

  if (!text || !c) return;

  if (!model) {
    alert("Nenhum modelo de chat do Ollama está selecionado.");
    return;
  }

  if (c.messages.length === 0) {
    c.title = deriveTitle(text);
  }
  c.model = model;

  c.messages.push({ role: "user", content: text });
  c.updatedAt = nowIso();

  el.promptInput.value = "";
  autoResize();
  saveConversations();
  renderAll();

  const run = makeRunSnapshot(c, model);
  const assistantMessage = { role: "assistant", content: "", metrics: null, run };
  c.messages.push(assistantMessage);
  const assistantIndex = c.messages.length - 1;

  const assistantEl = addMessageElement("assistant", "", null, run, assistantIndex);
  assistantEl.body.classList.add("typing");
  el.welcome.classList.add("hidden");
  scrollToBottom();

  const controller = new AbortController();
  state.controller = controller;
  setGenerating(true);

  try {
    const options = experimentOptions(run.profile);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        system_prompt: run.profile.systemPrompt || "",
        messages: c.messages.slice(0, -1),
        options,
      }),
    });

    if (!response.ok) {
      let detail = `Erro HTTP ${response.status}`;
      try {
        const err = await response.json();
        detail = err.error || detail;
      } catch {}
      throw new Error(detail);
    }

    if (!response.body) {
      throw new Error("O navegador não disponibilizou o stream da resposta.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        let data;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }

        if (data.localchat?.type === "context_trace" && data.localchat.trace) {
          assistantMessage.run.trace = data.localchat.trace;
          if (data.localchat.trace.digest) {
            assistantMessage.run.digest = data.localchat.trace.digest;
          }
          if (assistantEl.contextBtn) assistantEl.contextBtn.textContent = "contexto ✓";
          continue;
        }

        if (data.error) {
          throw new Error(data.error);
        }

        const chunk = data.message?.content || "";
        if (chunk) {
          assistantMessage.content += chunk;
          assistantEl.body.textContent = assistantMessage.content;
          scrollToBottom();
        }

        if (data.done) {
          assistantMessage.metrics = captureMetrics(data);
          const summary = metricsSummary(assistantMessage.metrics);
          assistantEl.meta.textContent = summary;
          assistantEl.meta.classList.toggle("hidden", !summary);
        }
      }
    }

    if (!assistantMessage.content.trim()) {
      assistantMessage.content = "(O modelo terminou sem retornar texto.)";
      assistantEl.body.textContent = assistantMessage.content;
    }

  } catch (error) {
    if (error.name === "AbortError") {
      if (!assistantMessage.content.trim()) {
        assistantMessage.content = "(Resposta interrompida.)";
      } else {
        assistantMessage.content += "\n\n[Resposta interrompida]";
      }
    } else {
      assistantMessage.content = `Erro: ${error.message}`;
    }

    assistantEl.body.textContent = assistantMessage.content;
  } finally {
    assistantEl.body.classList.remove("typing");
    c.updatedAt = nowIso();
    saveConversations();
    savePreferences();
    renderConversationList();
    setGenerating(false);
    state.controller = null;
    scrollToBottom();
    el.promptInput.focus();
  }
}

function stopGeneration() {
  state.controller?.abort();
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index >= 3 ? 1 : 0)} ${units[index]}`;
}

function humanContext(tokens) {
  if (!Number.isFinite(tokens) || tokens <= 0) return "";
  if (tokens >= 1024) return `${Math.round(tokens / 1024)}K ctx`;
  return `${tokens} ctx`;
}

function renderModelMeta() {
  const model = selectedModel();
  if (!model) {
    el.modelMeta.textContent = "";
    return;
  }

  const details = model.details || {};
  const profile = model.profile || {};
  const parts = [model.name];

  if (profile.category) parts.push(profile.category);
  if (details.parameter_size) parts.push(details.parameter_size);
  if (details.quantization_level) parts.push(details.quantization_level);
  if (model.context_length) parts.push(humanContext(model.context_length));
  if (model.size) parts.push(humanBytes(model.size));
  if (model.capabilities?.includes("vision")) parts.push("visão");

  el.modelMeta.textContent = parts.join(" · ");
  el.modelMeta.title = profile.description || model.name;
}

function renderExperimentMeta() {
  const c = activeConversation();
  if (!c) {
    el.experimentMeta.textContent = "";
    return;
  }

  const profile = normalizeExperiment(c.experiment);
  const parts = [];
  if (profile.systemPrompt.trim()) parts.push("sys");
  if (profile.temperature !== null) parts.push(`temp ${profile.temperature}`);
  if (profile.topP !== null) parts.push(`top-p ${profile.topP}`);
  if (profile.seed !== null) parts.push(`seed ${profile.seed}`);
  if (profile.numCtx !== null) parts.push(`ctx ${profile.numCtx}`);
  if (profile.numPredict !== null) parts.push(`saída ${profile.numPredict}`);

  el.experimentMeta.textContent = parts.length
    ? `ensaio · ${parts.join(" · ")}`
    : "ensaio · padrões do modelo";
}

function syncConversationModel() {
  const c = activeConversation();
  if (!c || state.models.length === 0) {
    renderModelMeta();
    return;
  }

  const chatModels = state.models.filter(model => model.chat_capable !== false);
  if (chatModels.length === 0) return;

  if (c.model && chatModels.some(model => model.name === c.model)) {
    el.modelSelect.value = c.model;
  } else if (!el.modelSelect.value || !chatModels.some(model => model.name === el.modelSelect.value)) {
    el.modelSelect.value = chatModels[0].name;
  }

  renderModelMeta();
}

async function loadModels() {
  const settings = getSettings();

  try {
    const response = await fetch("/api/models");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Falha ao carregar modelos.");
    }

    state.models = Array.isArray(data.models) ? data.models : [];
    const models = state.models.filter(model => model.chat_capable !== false);
    el.modelSelect.innerHTML = "";

    if (models.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = state.models.length
        ? "Nenhum modelo com capacidade de chat"
        : "Nenhum modelo instalado";
      el.modelSelect.appendChild(option);
      renderModelMeta();
      return;
    }

    const groups = new Map();
    for (const model of models) {
      const category = model.profile?.category || "outros";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(model);
    }

    for (const [category, items] of groups.entries()) {
      const group = document.createElement("optgroup");
      group.label = category.charAt(0).toUpperCase() + category.slice(1);

      for (const model of items) {
        const option = document.createElement("option");
        option.value = model.name;
        const label = model.profile?.label || model.name;
        const parameters = model.details?.parameter_size;
        option.textContent = parameters ? `${label} · ${parameters}` : label;
        group.appendChild(option);
      }

      el.modelSelect.appendChild(group);
    }

    const c = activeConversation();
    const preferred =
      c?.model ||
      settings.model ||
      window.LOCALCHAT_DEFAULT_MODEL ||
      data.default_model ||
      models[0].name;

    const exists = models.some(model => model.name === preferred);
    el.modelSelect.value = exists ? preferred : models[0].name;

    if (c && !c.model) {
      c.model = el.modelSelect.value;
      saveConversations();
      renderConversationList();
    }

    renderModelMeta();
    renderExperimentMeta();

  } catch {
    state.models = [];
    el.modelSelect.innerHTML = '<option value="">Ollama indisponível</option>';
    renderModelMeta();
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error();

    el.statusDot.className = "status-dot online";
    el.statusText.textContent = "Ollama conectado";
  } catch {
    el.statusDot.className = "status-dot offline";
    el.statusText.textContent = "Ollama desconectado";
  }
}

function writeOptionalInput(input, value) {
  input.value = value === null || value === undefined ? "" : String(value);
}

function openSettings() {
  const c = activeConversation();
  if (!c) return;
  const profile = normalizeExperiment(c.experiment);
  el.systemPrompt.value = profile.systemPrompt;
  writeOptionalInput(el.temperatureInput, profile.temperature);
  writeOptionalInput(el.topPInput, profile.topP);
  writeOptionalInput(el.seedInput, profile.seed);
  writeOptionalInput(el.numCtxInput, profile.numCtx);
  writeOptionalInput(el.numPredictInput, profile.numPredict);
  el.settingsModal.classList.remove("hidden");
  el.systemPrompt.focus();
}

function closeSettings() {
  el.settingsModal.classList.add("hidden");
}

function resetExperimentForm() {
  el.systemPrompt.value = "";
  for (const input of [
    el.temperatureInput,
    el.topPInput,
    el.seedInput,
    el.numCtxInput,
    el.numPredictInput,
  ]) {
    input.value = "";
  }
}

function experimentFromForm() {
  return normalizeExperiment({
    systemPrompt: el.systemPrompt.value.trim(),
    temperature: el.temperatureInput.value,
    topP: el.topPInput.value,
    seed: el.seedInput.value,
    numCtx: el.numCtxInput.value,
    numPredict: el.numPredictInput.value,
  });
}

function saveExperimentProfile() {
  const c = activeConversation();
  if (!c) return;
  c.experiment = experimentFromForm();
  c.updatedAt = nowIso();
  saveConversations();
  savePreferences();
  renderExperimentMeta();
  closeSettings();
}

function clearAllHistory() {
  if (!confirm("Apagar todas as conversas salvas neste navegador?")) return;

  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  state.conversations = [];
  state.activeId = null;
  closeSettings();
  newConversation();
}

function shortDigest(digest) {
  if (!digest) return "indisponível";
  return digest.length > 16 ? `${digest.slice(0, 16)}…` : digest;
}

function formatRunOptions(options) {
  const entries = Object.entries(options || {});
  if (entries.length === 0) return "padrões do modelo";
  return entries.map(([key, value]) => `${key}=${value}`).join(" · ");
}

function addTraceField(label, value, title = "") {
  const item = document.createElement("div");
  item.className = "trace-item";
  const name = document.createElement("div");
  name.className = "trace-label";
  name.textContent = label;
  const content = document.createElement("div");
  content.className = "trace-value";
  content.textContent = value || "—";
  if (title) content.title = title;
  item.append(name, content);
  el.traceGrid.appendChild(item);
}

function canonicalContextJson(messages) {
  const items = messages.map(message => {
    const content = JSON.stringify(message.content);
    const role = JSON.stringify(message.role);
    return `{"content":${content},"role":${role}}`;
  });
  return `[${items.join(",")}]`;
}

async function sha256Hex(text) {
  if (!crypto.subtle) return null;
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function openContextTrace(messageIndex) {
  const c = activeConversation();
  const message = c?.messages?.[messageIndex];
  if (!c || !message?.run) return;

  const run = message.run;
  const profile = normalizeExperiment(run.profile);
  const trace = run.trace && typeof run.trace === "object" ? run.trace : null;
  const options = trace?.options || experimentOptions(profile);
  const historyCount = Number.isInteger(run.contextMessageCount)
    ? Math.min(run.contextMessageCount, messageIndex)
    : messageIndex;

  const contextMessages = [];
  if (profile.systemPrompt.trim()) {
    contextMessages.push({ role: "system", content: profile.systemPrompt });
  }

  for (const prior of c.messages.slice(0, historyCount)) {
    if (
      prior &&
      ["user", "assistant", "system"].includes(prior.role) &&
      typeof prior.content === "string"
    ) {
      contextMessages.push({ role: prior.role, content: prior.content });
    }
  }

  el.traceGrid.innerHTML = "";
  el.contextEntries.innerHTML = "";

  const digest = trace?.digest || run.digest || "";
  const modelId = trace?.model || run.model || c.model || "";
  const modelRecord = state.models.find(model => model.name === modelId) || null;
  const modelLabel = modelRecord?.profile?.label || modelId || "—";
  const parameterSize = modelRecord?.details?.parameter_size || "—";

  addTraceField("Modelo", modelLabel);
  addTraceField("ID Ollama", modelId || "—", modelId || "");
  addTraceField("Tamanho reportado", parameterSize);
  addTraceField("Digest", shortDigest(digest), digest);
  addTraceField("Parâmetros", formatRunOptions(options));
  addTraceField("Mensagens", String(trace?.message_count ?? contextMessages.length));
  addTraceField("Trace ID", trace?.id ? shortDigest(trace.id) : "snapshot local", trace?.id || "");
  addTraceField(
    "SHA-256 do contexto",
    trace?.context_sha256 ? shortDigest(trace.context_sha256) : "indisponível",
    trace?.context_sha256 || "",
  );

  if (trace) {
    el.traceStatus.className = "trace-status";
    el.traceStatus.textContent = "Verificando o snapshot local contra o trace do backend…";
  } else {
    el.traceStatus.className = "trace-status";
    el.traceStatus.textContent = "Snapshot local: esta resposta não possui trace confirmado pelo backend (provavelmente foi gerada antes do P2).";
  }

  contextMessages.forEach((entry, index) => {
    const card = document.createElement("section");
    card.className = `context-entry context-${entry.role}`;
    const head = document.createElement("div");
    head.className = "context-entry-head";
    head.textContent = `${index + 1}. ${entry.role}`;
    const body = document.createElement("pre");
    body.textContent = entry.content;
    card.append(head, body);
    el.contextEntries.appendChild(card);
  });

  el.contextModal.classList.remove("hidden");

  if (trace) {
    const countMatches = trace.message_count === contextMessages.length;
    let hashMatches = null;
    if (trace.context_sha256) {
      try {
        const reconstructedHash = await sha256Hex(canonicalContextJson(contextMessages));
        hashMatches = reconstructedHash ? reconstructedHash === trace.context_sha256 : null;
      } catch {
        hashMatches = null;
      }
    }

    const confirmed = countMatches && hashMatches === true;
    const countOnly = countMatches && hashMatches === null;
    el.traceStatus.className = `trace-status ${confirmed || countOnly ? "trace-ok" : "trace-warning"}`;

    if (confirmed) {
      el.traceStatus.textContent = "✓ Contexto confirmado: contagem e SHA-256 coincidem com o payload sanitizado enviado pelo backend ao Ollama.";
    } else if (countOnly) {
      el.traceStatus.textContent = "✓ Contagem confirmada pelo backend; o navegador não conseguiu recalcular o SHA-256 localmente.";
    } else if (!countMatches) {
      el.traceStatus.textContent = `⚠ O backend registrou ${trace.message_count} mensagens; a interface reconstruiu ${contextMessages.length}.`;
    } else {
      el.traceStatus.textContent = "⚠ A contagem coincide, mas o SHA-256 reconstruído difere do contexto registrado pelo backend.";
    }
  }
}

function closeContextTrace() {
  el.contextModal.classList.add("hidden");
}

el.newChatBtn.addEventListener("click", newConversation);
el.sendBtn.addEventListener("click", sendMessage);
el.stopBtn.addEventListener("click", stopGeneration);
el.promptInput.addEventListener("input", autoResize);
el.promptInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
el.modelSelect.addEventListener("change", () => {
  const c = activeConversation();
  if (c) {
    c.model = el.modelSelect.value;
    c.updatedAt = nowIso();
    saveConversations();
    renderConversationList();
  }
  savePreferences();
  renderModelMeta();
});

el.menuBtn.addEventListener("click", () => {
  el.sidebar.classList.toggle("open");
});

el.settingsBtn.addEventListener("click", openSettings);
el.closeSettingsBtn.addEventListener("click", closeSettings);
el.resetExperimentBtn.addEventListener("click", resetExperimentForm);
el.saveSettingsBtn.addEventListener("click", saveExperimentProfile);
el.clearAllBtn.addEventListener("click", clearAllHistory);
el.closeContextBtn.addEventListener("click", closeContextTrace);

el.settingsModal.addEventListener("click", event => {
  if (event.target === el.settingsModal) closeSettings();
});
el.contextModal.addEventListener("click", event => {
  if (event.target === el.contextModal) closeContextTrace();
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  closeSettings();
  closeContextTrace();
});

loadConversations();
autoResize();
loadModels();
checkHealth();
setInterval(checkHealth, 15000);
