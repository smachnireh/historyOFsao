/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Share2,
  Copy,
  Moon,
  Sun,
  LogOut,
  Plus,
  Send
} from "lucide-react";

interface Message {
  id: string;
  nickname: string;
  text: string;
  time: number;
}

interface Member {
  id: string;
  nickname: string;
  joinedAt: string;
}

interface ActiveVideo {
  platform: "youtube" | "vk";
  id?: string;
  embedUrl?: string;
  originalUrl: string;
}

function parseVideoSource(rawInput: string): ActiveVideo | null {
  let url = (rawInput || "").trim();
  if (!url) return null;

  // Если передан iframe тег
  const iframeMatch = url.match(/src=["']([^"']+)["']/i);
  if (iframeMatch) {
    url = iframeMatch[1];
  }

  // Нормализуем URL для парсинга хоста
  let parsedUrl: URL | null = null;
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
          return { platform: "vk", embedUrl, id, originalUrl: url };
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
          return { platform: "vk", embedUrl, id, originalUrl: url };
        }
      }

      // 2.3 Стандартный путь /video-12345_67890 или /clip-12345_67890
      const pathMatch = parsedUrl.pathname.match(/(?:video|clip)(-?\d+)_(\d+)/);
      if (pathMatch) {
        const oid = pathMatch[1];
        const id = pathMatch[2];
        const hash = parsedUrl.searchParams.get("hash") || "";
        const embedUrl = `https://vk.com/video_ext.php?oid=${oid}&id=${id}${hash ? `&hash=${hash}` : ""}&hd=2&autoplay=1`;
        return { platform: "vk", embedUrl, id, originalUrl: url };
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
    return { platform: "vk", embedUrl, id, originalUrl: url };
  }

  // 4. Fallback: 11-значный ID YouTube
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return { platform: "youtube", id: url, originalUrl: url };
  }

  return null;
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [inRoom, setInRoom] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [homeError, setHomeError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [activeVideo, setActiveVideo] = useState<ActiveVideo | null>(null);
  const [videoError, setVideoError] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedTheme = (localStorage.getItem("vibe_theme") as "dark" | "light") || "dark";
    setTheme(savedTheme);
    document.documentElement.className = savedTheme;
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("vibe_theme", next);
    document.documentElement.className = next;
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2400);
  };

  const copyToClipboard = (text: string, label = "Скопировано") => {
    navigator.clipboard.writeText(text);
    showToast(label);
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const name = nickname.trim();
    if (!name || name.length > 24) {
      setHomeError("Введи никнейм от 1 до 24 символов");
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setHomeError("");
    setRoomCode(code);
    setMembers([{ id: "1", nickname: name, joinedAt: new Date().toISOString() }]);
    setInRoom(true);
    showToast("Комната создана");
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const name = nickname.trim();
    if (!name || name.length > 24) {
      setHomeError("Введи никнейм от 1 до 24 символов");
      return;
    }
    const code = inputCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setHomeError("Введи шестизначный код комнаты");
      return;
    }
    setHomeError("");
    setRoomCode(code);
    setMembers([
      { id: "1", nickname: "Alex", joinedAt: new Date().toISOString() },
      { id: "2", nickname: name, joinedAt: new Date().toISOString() }
    ]);
    setInRoom(true);
    showToast("Вход в комнату выполнен");
  };

  const handleLoadVideo = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const source = parseVideoSource(videoUrl.trim());
    if (!source) {
      setVideoError("Вставь ссылку на видео YouTube или VK Видео");
      return;
    }
    setVideoError("");
    setActiveVideo(source);
    showToast(source.platform === "vk" ? "VK Видео загружено" : "YouTube видео загружено");
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    const newMsg: Message = {
      id: String(Date.now()),
      nickname: nickname || "Ты",
      text,
      time: Date.now()
    };
    setMessages(prev => [...prev, newMsg]);
    setChatInput("");
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  const handleSendReaction = (emoji: string) => {
    showToast(`Отправлено: ${emoji}`);
  };

  const handleLeaveRoom = () => {
    setInRoom(false);
    setRoomCode("");
    setActiveVideo(null);
    setMessages([]);
    showToast("Ты покинул комнату");
  };

  return (
    <div
      className={`min-h-screen text-[var(--text-primary)] transition-colors duration-200 ${
        theme === "light" ? "light bg-[#f4f5f8]" : "bg-[#0c0e14]"
      }`}
      style={{
        backgroundImage:
          theme === "dark"
            ? "radial-gradient(circle at 50% 0%, #151824 0%, #0c0e14 70%)"
            : "radial-gradient(circle at 50% 0%, #ffffff 0%, #f4f5f8 70%)"
      }}
    >
      {/* Ambient background shimmer */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-60"
        style={{
          background:
            theme === "dark"
              ? "radial-gradient(800px circle at 50% 120px, rgba(130, 110, 220, 0.04), transparent 60%), radial-gradient(600px circle at 80% 300px, rgba(70, 140, 210, 0.03), transparent 60%)"
              : "radial-gradient(800px circle at 50% 120px, rgba(110, 90, 200, 0.03), transparent 60%)"
        }}
      />

      {/* Topbar */}
      <header className="relative z-10 h-16 px-6 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-panel)]">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md flex items-center justify-center text-white bg-gradient-to-br from-[#2a244d] via-[#1e2a4a] to-[#2e2646] border border-[var(--border)]">
            <Play className="w-3 h-3 fill-current ml-0.5" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-[var(--text-primary)]">
            Vibe Room
          </span>
          <span className="hidden sm:inline-block text-xs text-[var(--text-muted)] font-normal ml-2">
            Watch Together · YouTube & VK
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono tabular-nums">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Online</span>
          </div>

          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-md flex items-center justify-center border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-focus)] transition-colors cursor-pointer"
            aria-label="Сменить тему"
            title="Сменить тему"
          >
            {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-6xl mx-auto px-6 py-8">
        {!inRoom ? (
          <section className="max-w-md mx-auto mt-6 text-center">
            <div className="mb-8">
              <span className="text-xs font-medium text-[var(--text-muted)] tracking-wider uppercase block mb-2">
                Watch together
              </span>
              <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)] mb-3">
                Смотри вместе.<br />Чувствуй момент.
              </h1>
              <p className="text-sm text-[var(--text-secondary)]">
                Поддержка YouTube и VK Видео. Создавай комнаты и смотрите вместе в реальном времени.
              </p>
            </div>

            <div className="bg-[var(--surface-panel)] border border-[var(--border)] rounded-2xl p-6 text-left shadow-sm relative overflow-hidden">
              <form onSubmit={handleCreateRoom}>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">
                  Твой никнейм
                </label>
                <input
                  type="text"
                  maxLength={24}
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  placeholder="Например, Alex"
                  className="w-full bg-[var(--surface-input)] border border-[var(--border)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--border-focus)] transition-all"
                />

                <button
                  type="submit"
                  className="shimmer-btn w-full mt-3 py-2.5 px-4 rounded-lg text-white text-xs font-medium flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Создать комнату</span>
                </button>
              </form>

              <div className="relative text-center my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--border)]" />
                </div>
                <span className="relative px-3 bg-[var(--surface-panel)] text-[11px] text-[var(--text-muted)] font-medium">
                  или
                </span>
              </div>

              <form onSubmit={handleJoinRoom}>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">
                  Код комнаты
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={inputCode}
                  onChange={e => setInputCode(e.target.value)}
                  placeholder="000000"
                  className="w-full bg-[var(--surface-input)] border border-[var(--border)] rounded-lg px-3.5 py-2.5 text-sm font-mono tracking-widest text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--border-focus)] transition-all"
                />

                <button
                  type="submit"
                  className="w-full mt-3 py-2.5 px-4 rounded-lg bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] border border-[var(--border)] hover:border-[var(--border-focus)] text-[var(--text-primary)] text-xs font-medium transition-colors cursor-pointer"
                >
                  Войти в комнату
                </button>
              </form>

              {homeError && <p className="text-xs text-red-400 mt-3">{homeError}</p>}
            </div>

            <p className="text-xs text-[var(--text-muted)] mt-5">
              Без регистрации · Без установки · Поддержка YouTube & VK
            </p>
          </section>
        ) : (
          <section className="space-y-5 animate-fade-in">
            {/* Room Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs font-medium text-[var(--text-muted)] block mb-1">
                  Комната просмотра
                </span>
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                  Комната <span className="font-mono text-[#9d84f5]">{roomCode}</span>
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(window.location.origin + "?room=" + roomCode, "Ссылка на комнату скопирована")}
                  className="px-3.5 py-2 rounded-lg bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] border border-[var(--border)] text-xs font-medium text-[var(--text-primary)] flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Пригласить</span>
                </button>
                <button
                  onClick={() => copyToClipboard(roomCode, "Код скопирован")}
                  className="px-3.5 py-2 rounded-lg bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] border border-[var(--border)] text-xs font-medium text-[var(--text-primary)] flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Код: {roomCode}</span>
                </button>
              </div>
            </div>

            {/* Workspace Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-5 items-start">
              {/* Main Column */}
              <div className="space-y-5">
                {/* Video Card */}
                <div className="bg-[var(--surface-panel)] border border-[var(--border)] rounded-2xl p-5">
                  <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-3">
                    <span className="font-medium">Плеер</span>
                    <span className="font-mono font-medium text-[#9d84f5]">
                      {activeVideo
                        ? activeVideo.platform === "vk"
                          ? "VK Видео"
                          : "YouTube"
                        : "Ожидание видео"}
                    </span>
                  </div>

                  <div className="w-full aspect-video bg-black rounded-xl overflow-hidden border border-[var(--border)] flex items-center justify-center relative">
                    {activeVideo ? (
                      activeVideo.platform === "vk" ? (
                        <iframe
                          src={activeVideo.embedUrl}
                          title="VK Video player"
                          className="w-full h-full border-0"
                          allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock;"
                          allowFullScreen
                        />
                      ) : (
                        <iframe
                          src={`https://www.youtube.com/embed/${activeVideo.id}?autoplay=1&enablejsapi=1&rel=0`}
                          title="YouTube video player"
                          className="w-full h-full border-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      )
                    ) : (
                      <div className="text-center p-6 text-[var(--text-muted)]">
                        <div className="w-12 h-12 rounded-full bg-[var(--surface-card)] border border-[var(--border)] flex items-center justify-center mx-auto mb-3 text-[#9d84f5]">
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        </div>
                        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">
                          Время смотреть вместе
                        </h3>
                        <p className="text-xs text-[var(--text-secondary)]">
                          Вставь ссылку на видео YouTube или VK Видео ниже
                        </p>
                      </div>
                    )}
                  </div>

                  <form onSubmit={handleLoadVideo} className="flex gap-2 mt-4">
                    <input
                      type="text"
                      value={videoUrl}
                      onChange={e => setVideoUrl(e.target.value)}
                      placeholder="Ссылка на YouTube или VK Видео (vkvideo.ru, vk.com/video...)"
                      className="flex-1 bg-[var(--surface-input)] border border-[var(--border)] rounded-lg px-3.5 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--border-focus)]"
                    />
                    <button
                      type="submit"
                      className="shimmer-btn px-4 py-2 rounded-lg text-white text-xs font-medium shrink-0 cursor-pointer"
                    >
                      Загрузить
                    </button>
                  </form>
                  {videoError && <p className="text-xs text-red-400 mt-2">{videoError}</p>}
                </div>

                {/* Chat Card */}
                <div className="bg-[var(--surface-panel)] border border-[var(--border)] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Общий чат</h3>
                    <span className="text-xs text-[var(--text-muted)]">Сообщения комнаты</span>
                  </div>

                  <div className="h-56 overflow-y-auto space-y-3 pr-1 text-xs">
                    {messages.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-xs">
                        Пока нет сообщений. Напиши что-нибудь первым
                      </div>
                    ) : (
                      messages.map(m => (
                        <div key={m.id} className="space-y-1">
                          <div className="text-[11px] font-medium text-[#9d84f5]">
                            {m.nickname}
                          </div>
                          <div className="inline-block px-3 py-2 rounded-lg bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] leading-relaxed max-w-[85%] break-words">
                            {m.text}
                          </div>
                        </div>
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  <form onSubmit={handleSendMessage} className="flex gap-2 mt-3">
                    <input
                      type="text"
                      maxLength={500}
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      placeholder="Напиши сообщение..."
                      className="flex-1 bg-[var(--surface-input)] border border-[var(--border)] rounded-lg px-3.5 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--border-focus)]"
                    />
                    <button
                      type="submit"
                      className="shimmer-btn w-9 h-9 rounded-lg text-white flex items-center justify-center shrink-0 cursor-pointer"
                      aria-label="Отправить"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>

                  {/* Reaction bar */}
                  <div className="flex gap-1.5 mt-2.5">
                    {["❤️", "👍", "🔥", "👏", "😂"].map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleSendReaction(emoji)}
                        className="px-2.5 py-1.5 rounded-lg bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] border border-[var(--border)] text-xs transition-colors cursor-pointer"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                {/* Members Card */}
                <div className="bg-[var(--surface-panel)] border border-[var(--border)] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Участники</h3>
                    <span className="text-xs text-[var(--text-muted)] font-mono">{members.length} онлайн</span>
                  </div>

                  <div className="space-y-2">
                    {members.map(m => (
                      <div key={m.id} className="flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
                        <div className="w-7 h-7 rounded-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] font-semibold flex items-center justify-center text-[11px]">
                          {m.nickname[0].toUpperCase()}
                        </div>
                        <span className="font-medium text-[var(--text-primary)]">{m.nickname}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-auto" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Room Info */}
                <div className="bg-[var(--surface-panel)] border border-[var(--border)] rounded-2xl p-5 space-y-3">
                  <span className="text-xs text-[var(--text-muted)] font-medium block">
                    Код комнаты
                  </span>
                  <div className="text-2xl font-mono tracking-widest text-[var(--text-primary)] font-bold">
                    {roomCode}
                  </div>
                  <button
                    onClick={() => copyToClipboard(roomCode, "Код скопирован")}
                    className="w-full py-2 px-3 rounded-lg bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] border border-[var(--border)] text-xs font-medium text-[var(--text-primary)] transition-colors cursor-pointer"
                  >
                    Копировать код
                  </button>
                </div>

                {/* Leave Button */}
                <button
                  onClick={handleLeaveRoom}
                  className="w-full py-2.5 px-4 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Покинуть комнату</span>
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--surface-panel)] border border-[var(--border)] text-[var(--text-primary)] text-xs px-4 py-2.5 rounded-lg shadow-lg pointer-events-none transition-all">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
