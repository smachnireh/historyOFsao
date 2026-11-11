/**
 * Vibe Room — Watch Together
 * Minimalist synchronization client with Supabase Realtime, YouTube IFrame API & VK Video.
 */

const config = window.APP_CONFIG || {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};

let client = null;
const isSupabaseConfigured =
  config.SUPABASE_URL &&
  config.SUPABASE_URL.startsWith("https://") &&
  config.SUPABASE_ANON_KEY &&
  !config.SUPABASE_ANON_KEY.includes("ВСТАВЬ");

if (isSupabaseConfigured && window.supabase) {
  try {
    client = window.supabase.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_ANON_KEY
    );
  } catch (err) {
    console.warn("Supabase init error:", err);
  }
}

const $ = id => document.getElementById(id);

const state = {
  room: null,
  nickname: null,
  channel: null,
  player: null,
  playerReady: false,
  applyingRemote: false,
  typingTimer: null,
  syncTimer: null,
  members: {},
  lastTyping: {},
  isLocalOnly: !client,
  activePlatform: null, // "youtube" | "vk" | null
  currentVideoInfo: null
};

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function randomId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Math.random()).slice(2, 10);
}

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}

function showError(id, message) {
  const el = $(id);
  if (el) el.textContent = message;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[c]);
}

function validNickname() {
  const name = $("nickname").value.trim();
  if (!name || name.length > 24) {
    showError("homeError", "Введи имя от 1 до 24 символов");
    return null;
  }
  showError("homeError", "");
  return name;
}

async function createRoom() {
  const nickname = validNickname();
  if (!nickname) return;
  await enterRoom(randomCode(), nickname);
}

async function joinRoom() {
  const nickname = validNickname();
  if (!nickname) return;

  const code = $("roomCode").value.trim();
  if (!/^\d{6}$/.test(code)) {
    showError("homeError", "Введи шестизначный код комнаты");
    return;
  }
  showError("homeError", "");
  await enterRoom(code, nickname);
}

async function enterRoom(code, nickname) {
  state.room = code;
  state.nickname = nickname;

  if (!isSupabaseConfigured || !client) {
    state.isLocalOnly = true;
    state.members = {
      default: [{ nickname, joinedAt: new Date().toISOString() }]
    };
    initRoomView(code);
    toast("Локальный режим: настрой config.js для синхронизации");
    return;
  }

  state.isLocalOnly = false;
  const channel = client.channel("room-" + code, {
    config: {
      broadcast: { self: false },
      presence: { key: randomId() }
    }
  });

  state.channel = channel;

  channel
    .on("broadcast", { event: "chat" }, ({ payload }) => {
      addMessage(payload);
    })
    .on("broadcast", { event: "reaction" }, ({ payload }) => {
      toast(payload.nickname + ": " + payload.emoji);
    })
    .on("broadcast", { event: "video" }, ({ payload }) => {
      applyVideoCommand(payload);
    })
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      state.lastTyping[payload.nickname] = Date.now();
      renderTyping();
    })
    .on("broadcast", { event: "video-load" }, ({ payload }) => {
      loadVideo(payload.url, false);
    })
    .on("presence", { event: "sync" }, () => {
      state.members = channel.presenceState();
      renderMembers();
    })
    .on("presence", { event: "join" }, ({ newPresences }) => {
      newPresences.forEach(p => {
        if (p.nickname !== state.nickname) {
          toast(p.nickname + " в комнате");
        }
      });
    })
    .on("presence", { event: "leave" }, ({ leftPresences }) => {
      leftPresences.forEach(p => {
        if (p.nickname !== state.nickname) {
          toast(p.nickname + " вышел");
        }
      });
    });

  try {
    const status = await channel.subscribe(async subscribeStatus => {
      if (subscribeStatus === "SUBSCRIBED") {
        await channel.track({
          nickname: state.nickname,
          joinedAt: new Date().toISOString()
        });
      }
    });

    if (status !== "SUBSCRIBED") {
      toast("Не удалось подключиться к каналу");
      return;
    }

    initRoomView(code);
  } catch (error) {
    console.error(error);
    showError("homeError", "Ошибка подключения. Проверь настройки в config.js.");
  }
}

function initRoomView(code) {
  $("home").classList.add("hidden");
  $("room").classList.remove("hidden");
  $("displayCode").textContent = code;
  $("sideCode").textContent = code;

  history.replaceState({}, "", "?room=" + code);
  renderMembers();
}

function renderMembers() {
  const all = Object.values(state.members).flat();
  const count = all.length || 1;
  $("memberCount").textContent = `${count} онлайн`;

  $("members").innerHTML = all.map(person => `
    <div class="member">
      <div class="avatar">${escapeHTML((person.nickname || "U")[0].toUpperCase())}</div>
      <span>${escapeHTML(person.nickname)}</span>
      <i></i>
    </div>
  `).join("");
}

function sendEvent(event, payload) {
  if (!state.channel) return;
  state.channel.send({
    type: "broadcast",
    event,
    payload: {
      ...payload,
      sender: state.nickname
    }
  });
}

function addMessage(data) {
  const messages = $("messages");
  const item = document.createElement("div");
  item.className = "message";

  const author = document.createElement("div");
  author.className = "author";
  author.textContent = data.nickname;

  const body = document.createElement("div");
  body.className = "body";
  body.textContent = data.text;

  item.append(author, body);
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function sendMessage() {
  const input = $("messageInput");
  const text = input.value.trim();

  if (!text || text.length > 500) return;

  const message = {
    nickname: state.nickname,
    text,
    time: Date.now()
  };

  addMessage(message);
  sendEvent("chat", message);
  input.value = "";
  $("typing").textContent = "";
}

function sendTyping() {
  sendEvent("typing", { nickname: state.nickname });
}

function renderTyping() {
  const now = Date.now();
  const names = Object.keys(state.lastTyping).filter(name =>
    name !== state.nickname && now - state.lastTyping[name] < 2500
  );

  $("typing").textContent = names.length
    ? names.join(", ") + " печатает..."
    : "";
}

function sendReaction(emoji) {
  sendEvent("reaction", {
    nickname: state.nickname,
    emoji
  });
  toast("Отправлено " + emoji);
}

function copyText(value) {
  navigator.clipboard.writeText(value)
    .then(() => toast("Скопировано"))
    .catch(() => toast("Не удалось скопировать"));
}

function copyInvite() {
  const url = new URL(location.href);
  url.searchParams.set("room", state.room);
  copyText(url.toString());
}

// Универсальный парсер ссылок (YouTube и VK Видео: vk.ru, vk.com, vkvideo.ru)
function parseVideoSource(rawInput) {
  let url = (rawInput || "").trim();
  if (!url) return null;

  // Если вставлен HTML-код iframe
  const iframeMatch = url.match(/src=["']([^"']+)["']/i);
  if (iframeMatch) {
    url = iframeMatch[1];
  }

  // Нормализуем URL для парсинга хоста
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch (_) {
    try {
      parsedUrl = new URL("https://" + url);
    } catch (_) {
      parsedUrl = null;
    }
  }

  if (parsedUrl) {
    const host = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();

    // 1. YouTube
    if (host === "youtu.be") {
      const id = parsedUrl.pathname.slice(1).split("/")[0];
      if (id) return { platform: "youtube", id, originalUrl: url };
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (parsedUrl.pathname === "/watch") {
        const id = parsedUrl.searchParams.get("v");
        if (id) return { platform: "youtube", id, originalUrl: url };
      }
      const match = parsedUrl.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
      if (match && match[2]) return { platform: "youtube", id: match[2], originalUrl: url };
    }

    // 2. VK Видео (vk.ru, vk.com, vkvideo.ru, m.vk.ru, m.vk.com)
    const isVk = /(?:^|\.)(?:vk\.ru|vk\.com|vkvideo\.ru|vk\.video)$/i.test(host);
    if (isVk) {
      // 2.1 Прямой URL вставки video_ext.php?oid=...&id=...
      if (parsedUrl.pathname.includes("video_ext.php")) {
        const oid = parsedUrl.searchParams.get("oid");
        const id = parsedUrl.searchParams.get("id");
        const hash = parsedUrl.searchParams.get("hash") || "";
        if (oid && id) {
          const embedUrl = `https://vk.com/video_ext.php?oid=${oid}&id=${id}${hash ? `&hash=${hash}` : ""}&hd=2&autoplay=1`;
          return { platform: "vk", embedUrl, oid, id, hash, originalUrl: url };
        }
      }

      // 2.2 Параметр ?z=video-12345_67890
      const zParam = parsedUrl.searchParams.get("z");
      if (zParam) {
        const zMatch = zParam.match(/video(-?\d+)_(\d+)/);
        if (zMatch) {
          const oid = zMatch[1];
          const id = zMatch[2];
          const hash = parsedUrl.searchParams.get("hash") || "";
          const embedUrl = `https://vk.com/video_ext.php?oid=${oid}&id=${id}${hash ? `&hash=${hash}` : ""}&hd=2&autoplay=1`;
          return { platform: "vk", embedUrl, oid, id, hash, originalUrl: url };
        }
      }

      // 2.3 Стандартный путь /video-12345_67890 или /clip-12345_67890
      const pathMatch = parsedUrl.pathname.match(/(?:video|clip)(-?\d+)_(\d+)/);
      if (pathMatch) {
        const oid = pathMatch[1];
        const id = pathMatch[2];
        const hash = parsedUrl.searchParams.get("hash") || "";
        const embedUrl = `https://vk.com/video_ext.php?oid=${oid}&id=${id}${hash ? `&hash=${hash}` : ""}&hd=2&autoplay=1`;
        return { platform: "vk", embedUrl, oid, id, hash, originalUrl: url };
      }
    }
  }

  // 3. Fallback: прямой поиск паттерна видео / клипа в строке (например, "video-223331012_456240183")
  const rawVkMatch = url.match(/(?:video|clip)(-?\d+)_(\d+)/i);
  if (rawVkMatch) {
    const oid = rawVkMatch[1];
    const id = rawVkMatch[2];
    const hashMatch = url.match(/[?&]hash=([a-zA-Z0-9_-]+)/);
    const hash = hashMatch ? hashMatch[1] : "";
    const embedUrl = `https://vk.com/video_ext.php?oid=${oid}&id=${id}${hash ? `&hash=${hash}` : ""}&hd=2&autoplay=1`;
    return { platform: "vk", embedUrl, oid, id, hash, originalUrl: url };
  }

  // 4. Fallback: 11-значный ID YouTube
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return { platform: "youtube", id: url, originalUrl: url };
  }

  return null;
}

function loadVideo(url, broadcast = true) {
  const source = parseVideoSource(url);

  if (!source) {
    $("videoError").textContent = "Вставь ссылку на видео YouTube или VK Видео";
    return;
  }

  $("videoError").textContent = "";
  $("videoStatus").textContent = "Загрузка...";
  state.currentVideoInfo = source;

  if (broadcast) {
    sendEvent("video-load", { url });
  }

  const container = $("videoContainer");

  // Обработка VK Видео
  if (source.platform === "vk") {
    state.activePlatform = "vk";
    // Очищаем YouTube плеер, если был запущен
    if (state.player && state.player.destroy) {
      try { state.player.destroy(); } catch (_) {}
      state.player = null;
      state.playerReady = false;
    }

    container.innerHTML = `
      <iframe
        src="${source.embedUrl}"
        width="100%"
        height="100%"
        frameborder="0"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock;"
        allowfullscreen>
      </iframe>
    `;
    $("videoStatus").textContent = "VK Видео";
    return;
  }

  // Обработка YouTube
  if (source.platform === "youtube") {
    state.activePlatform = "youtube";
    if (!state.playerReady) {
      state.pendingVideo = source.id;
      setupYouTubeAPI();
      return;
    }

    state.player.loadVideoById(source.id);
    $("videoStatus").textContent = "YouTube";
  }
}

// YouTube IFrame API
function setupYouTubeAPI() {
  if (window.YT && window.YT.Player) {
    createYouTubePlayer();
    return;
  }

  if (document.getElementById("youtube-api")) return;

  const script = document.createElement("script");
  script.id = "youtube-api";
  script.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(script);

  window.onYouTubeIframeAPIReady = createYouTubePlayer;
}

function createYouTubePlayer() {
  if (state.player || !window.YT || !window.YT.Player) return;

  const container = $("videoContainer");
  container.innerHTML = '<div id="youtube-player"></div>';

  state.player = new YT.Player("youtube-player", {
    width: "100%",
    height: "100%",
    videoId: "",
    playerVars: {
      autoplay: 1,
      controls: 1,
      rel: 0,
      playsinline: 1
    },
    events: {
      onReady: () => {
        state.playerReady = true;
        if (state.pendingVideo) {
          state.player.loadVideoById(state.pendingVideo);
          state.pendingVideo = null;
          $("videoStatus").textContent = "YouTube";
        }
      },
      onStateChange: event => {
        if (state.applyingRemote || state.activePlatform !== "youtube") return;

        if (event.data === YT.PlayerState.PLAYING) {
          sendVideoCommand("play");
        }
        if (event.data === YT.PlayerState.PAUSED) {
          sendVideoCommand("pause");
        }
        if (event.data === YT.PlayerState.ENDED) {
          sendVideoCommand("pause");
        }
      },
      onError: () => {
        $("videoError").textContent = "Не удалось загрузить видео YouTube";
      }
    }
  });
}

function sendVideoCommand(action) {
  if (state.activePlatform !== "youtube" || !state.playerReady || state.applyingRemote) return;

  sendEvent("video", {
    action,
    time: state.player.getCurrentTime()
  });
}

function applyVideoCommand(command) {
  if (state.activePlatform !== "youtube" || !state.playerReady || !command) return;

  state.applyingRemote = true;

  try {
    if (typeof command.time === "number" &&
        Math.abs(state.player.getCurrentTime() - command.time) > 1.5) {
      state.player.seekTo(command.time, true);
    }

    if (command.action === "play") {
      state.player.playVideo();
    }
    if (command.action === "pause") {
      state.player.pauseVideo();
    }
    if (command.action === "seek") {
      state.player.seekTo(command.time, true);
    }
  } finally {
    setTimeout(() => {
      state.applyingRemote = false;
    }, 500);
  }
}

// Тема оформления (Dark / Light)
function initTheme() {
  const saved = localStorage.getItem("vibe_theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeIcon(saved);

  const toggleBtn = $("themeToggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("vibe_theme", next);
      updateThemeIcon(next);
    });
  }
}

function updateThemeIcon(theme) {
  const btn = $("themeToggle");
  if (!btn) return;
  btn.innerHTML = theme === "dark"
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}

// Инициализация обработчиков
document.addEventListener("DOMContentLoaded", () => {
  initTheme();

  $("createBtn").addEventListener("click", createRoom);
  $("joinBtn").addEventListener("click", joinRoom);
  $("sendMessage").addEventListener("click", sendMessage);
  $("messageInput").addEventListener("keydown", e => {
    if (e.key === "Enter") sendMessage();
  });
  $("messageInput").addEventListener("input", () => {
    clearTimeout(state.typingTimer);
    sendTyping();
  });
  $("loadVideo").addEventListener("click", () => {
    loadVideo($("videoUrl").value.trim());
  });
  $("videoUrl").addEventListener("keydown", e => {
    if (e.key === "Enter") $("loadVideo").click();
  });
  $("copyInvite").addEventListener("click", copyInvite);
  $("copyCode").addEventListener("click", () => copyText(state.room));

  document.querySelectorAll("[data-emoji]").forEach(button => {
    button.addEventListener("click", () => sendReaction(button.dataset.emoji));
  });

  $("leaveBtn").addEventListener("click", async () => {
    if (state.channel && client) {
      await client.removeChannel(state.channel);
    }
    clearInterval(state.syncTimer);
    state.channel = null;
    state.player = null;
    state.playerReady = false;
    state.room = null;
    state.activePlatform = null;

    history.replaceState({}, "", location.pathname);
    $("room").classList.add("hidden");
    $("home").classList.remove("hidden");
    $("messages").innerHTML = "";
    $("members").innerHTML = "";
    toast("Ты покинул комнату");
  });

  const inviteCode = new URLSearchParams(location.search).get("room");
  if (inviteCode && /^\d{6}$/.test(inviteCode)) {
    $("roomCode").value = inviteCode;
  }
});
