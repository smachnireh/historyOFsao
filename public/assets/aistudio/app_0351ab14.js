
const { createClient } = supabase;
const config = window.APP_CONFIG;

const client = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY
);

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
  lastTyping: {}
};

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function randomId() {
  return crypto.randomUUID();
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

function showError(id, message) {
  $(id).textContent = message;
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
    showError("homeError", "Введи никнейм от 1 до 24 символов.");
    return null;
  }
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
    showError("homeError", "Введи правильный шестизначный код.");
    return;
  }

  await enterRoom(code, nickname);
}

async function enterRoom(code, nickname) {
  if (!config.SUPABASE_URL.startsWith("https://") ||
      config.SUPABASE_ANON_KEY.startsWith("ВСТАВЬ")) {
    showError("homeError", "Сначала настрой Supabase в config.js.");
    return;
  }

  state.room = code;
  state.nickname = nickname;

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
      toast(payload.nickname + " " + payload.emoji);
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
          toast(p.nickname + " присоединился");
        }
      });
    })
    .on("presence", { event: "leave" }, ({ leftPresences }) => {
      leftPresences.forEach(p => {
        if (p.nickname !== state.nickname) {
          toast(p.nickname + " покинул комнату");
        }
      });
    });

  try {
    const status = await channel.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          nickname: state.nickname,
          joinedAt: new Date().toISOString()
        });
      }
    });

    if (status !== "SUBSCRIBED") {
      toast("Не удалось подключиться к комнате");
      return;
    }

    $("home").classList.add("hidden");
    $("room").classList.remove("hidden");
    $("displayCode").textContent = code;
    $("sideCode").textContent = code;

    history.replaceState({}, "", "?room=" + code);
    renderMembers();
    setupYouTubeAPI();
  } catch (error) {
    console.error(error);
    showError("homeError", "Ошибка подключения. Проверь настройки Supabase.");
  }
}

function renderMembers() {
  const all = Object.values(state.members).flat();
  $("memberCount").textContent = all.length + " онлайн";

  $("members").innerHTML = all.map(person => `
    <div class="member">
      <div class="avatar">${escapeHTML(person.nickname[0].toUpperCase())}</div>
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

  if (data.nickname !== state.nickname) {
    toast("Новое сообщение от " + data.nickname);
  }
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
  toast("Ты отправил(а) " + emoji);
}

function copyText(value) {
  navigator.clipboard.writeText(value)
    .then(() => toast("Скопировано!"))
    .catch(() => toast("Не удалось скопировать"));
}

function copyInvite() {
  const url = new URL(location.href);
  url.searchParams.set("room", state.room);
  copyText(url.toString());
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
  if (state.player || !window.YT?.Player) return;

  const container = $("videoContainer");
  container.innerHTML = '<div id="youtube-player"></div>';

  state.player = new YT.Player("youtube-player", {
    width: "100%",
    height: "100%",
    videoId: "",
    playerVars: {
      autoplay: 0,
      controls: 1,
      rel: 0,
      playsinline: 1
    },
    events: {
      onReady: () => {
        state.playerReady = true;
      },
      onStateChange: event => {
        if (state.applyingRemote) return;

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
        $("videoError").textContent = "Не удалось загрузить это видео.";
      }
    }
  });
}

function extractYouTubeId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return parsed.pathname.slice(1).split("/")[0];
    }

    if (host === "youtube.com" ||
        host === "m.youtube.com" ||
        host === "music.youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }

      const match = parsed.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
      return match ? match[2] : null;
    }
  } catch (_) {}

  return null;
}

function loadVideo(url, broadcast = true) {
  const id = extractYouTubeId(url);

  if (!id) {
    $("videoError").textContent =
      "Пока поддерживается YouTube. Для VK используйте доступную встраиваемую ссылку.";
    return;
  }

  $("videoError").textContent = "";
  $("videoStatus").textContent = "Загрузка видео...";

  if (broadcast) {
    sendEvent("video-load", { url });
  }

  if (!state.playerReady) {
    state.pendingVideo = id;
    setupYouTubeAPI();
    waitForPlayer(id);
    return;
  }

  state.player.loadVideoById(id);
  $("videoStatus").textContent = "YouTube";
}

function waitForPlayer(id) {
  const check = setInterval(() => {
    if (state.playerReady) {
      clearInterval(check);
      state.player.loadVideoById(id);
      $("videoStatus").textContent = "YouTube";
    }
  }, 300);
}

function sendVideoCommand(action) {
  if (!state.playerReady || state.applyingRemote) return;

  sendEvent("video", {
    action,
    time: state.player.getCurrentTime()
  });
}

function applyVideoCommand(command) {
  if (!state.playerReady || !command) return;

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
  if (state.channel) await client.removeChannel(state.channel);

  clearInterval(state.syncTimer);
  state.channel = null;
  state.player = null;
  state.playerReady = false;
  state.room = null;

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
