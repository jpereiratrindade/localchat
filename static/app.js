const STORAGE_KEY = "localchat.conversations.v1";
const SETTINGS_KEY = "localchat.settings.v1";

const state = {
  conversations: [],
  activeId: null,
  generating: false,
  controller: null,
};

const el = {
  sidebar: document.getElementById("sidebar"),
  menuBtn: document.getElementById("menuBtn"),
  newChatBtn: document.getElementById("newChatBtn"),
  conversationList: document.getElementById("conversationList"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  modelSelect: document.getElementById("modelSelect"),
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
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),
};

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function newConversation() {
  const c = {
    id: makeId(),
    title: "Nova conversa",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: [],
  };
  state.conversations.unshift(c);
  state.activeId = c.id;
  saveConversations();
  renderAll();
  el.promptInput.focus();
}

function activeConversation() {
  return state.conversations.find(c => c.id === state.activeId) || null;
}

function loadConversations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.conversations = raw ? JSON.parse(raw) : [];
  } catch {
    state.conversations = [];
  }

  if (!Array.isArray(state.conversations)) {
    state.conversations = [];
  }

  if (state.conversations.length === 0) {
    newConversation();
    return;
  }

  state.activeId = state.conversations[0].id;
  renderAll();
}

function saveConversations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations));
}

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings() {
  const settings = getSettings();
  settings.systemPrompt = el.systemPrompt.value.trim();
  settings.model = el.modelSelect.value || settings.model || "";
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
}

function renderConversationList() {
  el.conversationList.innerHTML = "";

  for (const c of state.conversations) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `conversation-item ${c.id === state.activeId ? "active" : ""}`;

    const name = document.createElement("span");
    name.className = "conversation-name";
    name.textContent = c.title || "Nova conversa";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-chat";
    remove.title = "Excluir conversa";
    remove.textContent = "×";
    remove.addEventListener("click", event => deleteConversation(c.id, event));

    row.append(name, remove);
    row.addEventListener("click", () => {
      state.activeId = c.id;
      renderAll();
      el.sidebar.classList.remove("open");
    });

    el.conversationList.appendChild(row);
  }
}

function addMessageElement(role, content) {
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

  contentWrap.append(roleEl, body);
  wrapper.append(avatar, contentWrap);
  el.messages.appendChild(wrapper);

  return body;
}

function renderMessages() {
  const c = activeConversation();
  el.messages.innerHTML = "";

  const messages = c?.messages || [];
  el.welcome.classList.toggle("hidden", messages.length > 0);

  for (const msg of messages) {
    addMessageElement(msg.role, msg.content);
  }

  requestAnimationFrame(scrollToBottom);
}

function renderAll() {
  renderConversationList();
  renderMessages();
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
}

function deriveTitle(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 42 ? `${compact.slice(0, 42)}…` : compact || "Nova conversa";
}

async function sendMessage() {
  if (state.generating) return;

  const text = el.promptInput.value.trim();
  const model = el.modelSelect.value;
  const c = activeConversation();

  if (!text || !c) return;

  if (!model) {
    alert("Nenhum modelo do Ollama está selecionado.");
    return;
  }

  if (c.messages.length === 0) {
    c.title = deriveTitle(text);
  }

  c.messages.push({ role: "user", content: text });
  c.updatedAt = nowIso();

  el.promptInput.value = "";
  autoResize();
  saveConversations();
  renderAll();

  const assistantMessage = { role: "assistant", content: "" };
  c.messages.push(assistantMessage);

  const assistantBody = addMessageElement("assistant", "");
  assistantBody.classList.add("typing");
  el.welcome.classList.add("hidden");
  scrollToBottom();

  const controller = new AbortController();
  state.controller = controller;
  setGenerating(true);

  try {
    const settings = getSettings();

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        system_prompt: settings.systemPrompt || "",
        messages: c.messages.slice(0, -1),
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

        if (data.error) {
          throw new Error(data.error);
        }

        const chunk = data.message?.content || "";
        if (chunk) {
          assistantMessage.content += chunk;
          assistantBody.textContent = assistantMessage.content;
          scrollToBottom();
        }
      }
    }

    if (!assistantMessage.content.trim()) {
      assistantMessage.content = "(O modelo terminou sem retornar texto.)";
      assistantBody.textContent = assistantMessage.content;
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

    assistantBody.textContent = assistantMessage.content;
  } finally {
    assistantBody.classList.remove("typing");
    c.updatedAt = nowIso();
    saveConversations();
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

async function loadModels() {
  const settings = getSettings();

  try {
    const response = await fetch("/api/models");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Falha ao carregar modelos.");
    }

    const models = data.models || [];
    el.modelSelect.innerHTML = "";

    if (models.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Nenhum modelo instalado";
      el.modelSelect.appendChild(option);
      return;
    }

    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.name;
      option.textContent = model.name;
      el.modelSelect.appendChild(option);
    }

    const preferred =
      settings.model ||
      window.LOCALCHAT_DEFAULT_MODEL ||
      data.default_model ||
      models[0].name;

    const exists = models.some(m => m.name === preferred);
    el.modelSelect.value = exists ? preferred : models[0].name;

  } catch (error) {
    el.modelSelect.innerHTML = '<option value="">Ollama indisponível</option>';
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

function openSettings() {
  const settings = getSettings();
  el.systemPrompt.value = settings.systemPrompt || "";
  el.settingsModal.classList.remove("hidden");
  el.systemPrompt.focus();
}

function closeSettings() {
  el.settingsModal.classList.add("hidden");
}

function clearAllHistory() {
  if (!confirm("Apagar todas as conversas salvas neste navegador?")) return;

  localStorage.removeItem(STORAGE_KEY);
  state.conversations = [];
  state.activeId = null;
  closeSettings();
  newConversation();
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
el.modelSelect.addEventListener("change", saveSettings);

el.menuBtn.addEventListener("click", () => {
  el.sidebar.classList.toggle("open");
});

el.settingsBtn.addEventListener("click", openSettings);
el.closeSettingsBtn.addEventListener("click", closeSettings);
el.saveSettingsBtn.addEventListener("click", () => {
  saveSettings();
  closeSettings();
});
el.clearAllBtn.addEventListener("click", clearAllHistory);

el.settingsModal.addEventListener("click", event => {
  if (event.target === el.settingsModal) closeSettings();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeSettings();
});

loadConversations();
autoResize();
loadModels();
checkHealth();
setInterval(checkHealth, 15000);
