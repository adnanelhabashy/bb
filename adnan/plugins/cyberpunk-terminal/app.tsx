// bb-plugin-cyberpunk-terminal — frontend.
//
// A tabbed terminal panel. Each tab is a real shell (server.ts spawns
// `bash -i` per tab) with a neon cyberpunk skin: fixed dark palette on
// purpose (this is a themed terminal, not a host-theme surface), scanlines,
// and glow — not derived from BB's theme tokens.
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

type Tab = { id: string; title: string };

const PALETTE = {
  bg: "#05070d",
  panel: "#0a0e18",
  green: "#39ff9c",
  magenta: "#ff2fd4",
  cyan: "#3ff0ff",
  dim: "#4b5a6b",
};

function GlobalStyle() {
  return (
    <style>{`
      @keyframes cpt-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
      @keyframes cpt-scan { from { background-position: 0 0 } to { background-position: 0 100% } }
      .cpt-cursor { animation: cpt-blink 1s step-end infinite; }
      .cpt-scanlines::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: repeating-linear-gradient(
          to bottom,
          rgba(57, 255, 156, 0.05) 0px,
          rgba(57, 255, 156, 0.05) 1px,
          transparent 1px,
          transparent 3px
        );
        animation: cpt-scan 6s linear infinite;
        mix-blend-mode: screen;
      }
    `}</style>
  );
}

function TerminalTabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className="group flex cursor-pointer items-center gap-2 border-r px-3 py-1.5 text-xs tracking-wide"
      style={{
        borderColor: "#1a2230",
        color: active ? PALETTE.green : PALETTE.dim,
        background: active ? "rgba(57, 255, 156, 0.08)" : "transparent",
        boxShadow: active ? `inset 0 -2px 0 0 ${PALETTE.magenta}` : "none",
        textShadow: active ? `0 0 6px ${PALETTE.green}` : "none",
      }}
    >
      <Icon name="Terminal" className="size-3.5" />
      <span>{tab.title}</span>
      <button
        aria-label={`Close ${tab.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="rounded-sm opacity-0 group-hover:opacity-100"
        style={{ color: PALETTE.magenta }}
      >
        <Icon name="X" className="size-3" />
      </button>
    </div>
  );
}

/** One shell session's scrollback + input line. Stays mounted (hidden via
 * CSS when its tab isn't active) so output keeps accumulating in background
 * tabs instead of being lost on unmount. */
function TerminalView({ id, rpc, visible }: { id: string; rpc: Rpc; visible: boolean }) {
  const [lines, setLines] = useState<string>("");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useRealtime(`terminal-output:${id}`, (payload: { text?: string; exit?: number }) => {
    if (payload.text !== undefined) {
      setLines((prev) => prev + payload.text);
    } else if (payload.exit !== undefined) {
      setLines((prev) => `${prev}\n[process exited with code ${payload.exit}]\n`);
    }
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  const send = useCallback(
    (data: string) => {
      rpc.call("terminal_input", { id, data }).catch(() => {});
    },
    [rpc, id],
  );

  const submit = () => {
    if (input === "") {
      send("\n");
      return;
    }
    send(`${input}\n`);
    setHistory((prev) => [...prev, input]);
    setHistoryIndex(null);
    setInput("");
  };

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", visible ? "flex" : "hidden")}
      style={{ background: PALETTE.bg }}
    >
      <div className="cpt-scanlines relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[13px] leading-relaxed"
          style={{ color: PALETTE.green, textShadow: `0 0 4px rgba(57,255,156,0.35)` }}
        >
          {lines || "// session ready — type a command\n"}
          <span className="inline-flex items-center gap-2">
            <span style={{ color: PALETTE.cyan }}>{"> "}</span>
            <span>{input}</span>
            <span className="cpt-cursor" style={{ color: PALETTE.magenta }}>
              ▌
            </span>
          </span>
        </div>
      </div>
      <input
        ref={inputRef}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            submit();
          } else if (event.key === "c" && event.ctrlKey) {
            send("\x03");
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (history.length === 0) return;
            const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
            setHistoryIndex(next);
            setInput(history[next]);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            if (historyIndex === null) return;
            const next = historyIndex + 1;
            if (next >= history.length) {
              setHistoryIndex(null);
              setInput("");
            } else {
              setHistoryIndex(next);
              setInput(history[next]);
            }
          }
        }}
        className="sr-only"
        aria-label="Terminal input"
      />
    </div>
  );
}

function TerminalWindow() {
  const rpc = useRpc<typeof rpcContract>();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const counter = useRef(0);

  const openTab = useCallback(async () => {
    const { id } = await rpc.call("terminal_create", null);
    counter.current += 1;
    setTabs((prev) => [...prev, { id, title: `session ${counter.current}` }]);
    setActiveId(id);
  }, [rpc]);

  const closeTab = useCallback(
    (id: string) => {
      rpc.call("terminal_close", { id }).catch(() => {});
      setTabs((prev) => {
        const remaining = prev.filter((tab) => tab.id !== id);
        setActiveId((current) =>
          current === id ? (remaining[remaining.length - 1]?.id ?? null) : current,
        );
        return remaining;
      });
    },
    [rpc],
  );

  useEffect(() => {
    if (tabs.length === 0) openTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border"
      style={{
        borderColor: "#1a2230",
        boxShadow: `0 0 0 1px rgba(57,255,156,0.08), 0 0 40px rgba(255,47,212,0.08)`,
      }}
    >
      <GlobalStyle />
      <div
        className="flex items-stretch border-b"
        style={{ borderColor: "#1a2230", background: PALETTE.panel }}
      >
        <div className="flex flex-1 overflow-x-auto">
          {tabs.map((tab) => (
            <TerminalTabButton
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              onSelect={() => setActiveId(tab.id)}
              onClose={() => closeTab(tab.id)}
            />
          ))}
        </div>
        <button
          onClick={openTab}
          aria-label="New terminal tab"
          className="flex items-center px-3 text-xs"
          style={{ color: PALETTE.cyan }}
        >
          <Icon name="Plus" className="size-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1" onClick={() => inputFocusHack(activeId)}>
        {tabs.map((tab) => (
          <TerminalView key={tab.id} id={tab.id} rpc={rpc} visible={tab.id === activeId} />
        ))}
      </div>
    </div>
  );
}

// Clicking anywhere in the scrollback should refocus the hidden input that
// actually captures keystrokes (the visible caret is a fake block cursor).
function inputFocusHack(activeId: string | null) {
  if (activeId === null) return;
  const inputs = document.querySelectorAll<HTMLInputElement>('input[aria-label="Terminal input"]');
  inputs.forEach((el) => {
    if (el.offsetParent !== null) el.focus();
  });
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "terminal",
    title: "Terminal",
    icon: "Terminal",
    path: "terminal",
    component: TerminalWindow,
  });
});
