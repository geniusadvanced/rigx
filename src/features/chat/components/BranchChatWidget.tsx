'use client';

import { FormEvent, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Minus, X } from 'lucide-react';
import type { UserData } from '@/types';
import type { BranchChatMessage, BranchChatRead } from '../types';
import {
  getBranchLabel,
  markBranchChatRead,
  sendBranchChatMessage,
  subscribeToBranchChat,
  subscribeToBranchChatRead,
} from '../services/branchChatService';

interface BranchChatWidgetProps {
  userData: UserData | null;
}

interface WidgetPosition {
  right: number;
  bottom: number;
}

interface DragState {
  pointerX: number;
  pointerY: number;
  startRight: number;
  startBottom: number;
  moved: boolean;
  mode: 'button' | 'popup';
}

const CHAT_POSITION_STORAGE_KEY = 'rigx-chat-position';
const DEFAULT_POSITION: WidgetPosition = { right: 20, bottom: 20 };
const VIEWPORT_MARGIN = 8;
const POPUP_WIDTH = 400;
const POPUP_HEIGHT = 500;
const BUTTON_WIDTH = 150;
const BUTTON_HEIGHT = 48;
const DRAG_THRESHOLD = 5;

function formatTimestamp(value?: { toDate?: () => Date }): string {
  const date = value?.toDate?.();
  if (!date) return 'Sending';
  return date.toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timestampMillis(value?: { toMillis?: () => number }): number {
  return value?.toMillis?.() ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getViewportSize() {
  if (typeof window === 'undefined') return { width: 1280, height: 720 };
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function clampPosition(position: WidgetPosition, mode: DragState['mode']): WidgetPosition {
  const viewport = getViewportSize();
  const width = mode === 'popup' ? POPUP_WIDTH : BUTTON_WIDTH;
  const height = mode === 'popup' ? POPUP_HEIGHT : BUTTON_HEIGHT;

  return {
    right: clamp(position.right, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN)),
    bottom: clamp(position.bottom, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.height - height - VIEWPORT_MARGIN)),
  };
}

function getStoredPosition(): WidgetPosition {
  if (typeof window === 'undefined') return DEFAULT_POSITION;

  try {
    const storedPosition = window.localStorage.getItem(CHAT_POSITION_STORAGE_KEY);
    if (!storedPosition) return DEFAULT_POSITION;
    const parsed = JSON.parse(storedPosition) as Partial<WidgetPosition>;
    if (typeof parsed.right !== 'number' || typeof parsed.bottom !== 'number') return DEFAULT_POSITION;
    return clampPosition({ right: parsed.right, bottom: parsed.bottom }, 'popup');
  } catch {
    return DEFAULT_POSITION;
  }
}

function storePosition(position: WidgetPosition) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CHAT_POSITION_STORAGE_KEY, JSON.stringify(position));
}

export function BranchChatWidget({ userData }: BranchChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<BranchChatMessage[]>([]);
  const [chatRead, setChatRead] = useState<BranchChatRead | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [position, setPosition] = useState<WidgetPosition>(DEFAULT_POSITION);
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressNextClickRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const unreadCount = useMemo(() => {
    if (!userData?.uid) return 0;
    const lastReadAt = timestampMillis(chatRead?.lastReadAt);
    return messages.filter((message) => {
      return message.senderId !== userData.uid && timestampMillis(message.createdAt) > lastReadAt;
    }).length;
  }, [chatRead?.lastReadAt, messages, userData?.uid]);

  useEffect(() => {
    setPosition(getStoredPosition());
  }, []);

  useEffect(() => {
    function handleResize() {
      setPosition((current) => {
        const nextPosition = clampPosition(current, 'popup');
        storePosition(nextPosition);
        return nextPosition;
      });
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!userData?.uid || !userData.role) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const unsubscribe = subscribeToBranchChat(
      (nextMessages) => {
        setMessages(nextMessages);
        setLoading(false);
      },
      (error) => {
        setErrorMessage(error.message || 'Unable to load RIGX Chat');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [userData?.role, userData?.uid]);

  useEffect(() => {
    if (!userData?.uid || !userData.role) return undefined;

    return subscribeToBranchChatRead(
      userData.uid,
      (nextRead) => setChatRead(nextRead),
      (error) => setErrorMessage(error.message || 'Unable to load chat read state'),
    );
  }, [userData?.role, userData?.uid]);

  useEffect(() => {
    if (!isOpen) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [isOpen, messages.length]);

  useEffect(() => {
    if (!isOpen || !userData?.uid || !userData.role) return;
    markBranchChatRead(userData.uid).catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update unread state');
    });
  }, [isOpen, messages.length, userData?.role, userData?.uid]);

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!userData?.uid || !userData.role) {
      setErrorMessage('Current user is not loaded');
      return;
    }

    if (!draftMessage.trim()) {
      setErrorMessage('Message cannot be empty');
      return;
    }

    setSending(true);
    setErrorMessage('');

    try {
      await sendBranchChatMessage(userData, draftMessage);
      setDraftMessage('');
      await markBranchChatRead(userData.uid);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to send message');
    } finally {
      setSending(false);
    }
  }

  function openChat() {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setIsOpen(true);
    if (userData?.uid && userData.role) {
      markBranchChatRead(userData.uid).catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to update unread state');
      });
    }
  }

  function startDrag(pointerX: number, pointerY: number, mode: DragState['mode']) {
    dragStateRef.current = {
      pointerX,
      pointerY,
      startRight: position.right,
      startBottom: position.bottom,
      moved: false,
      mode,
    };
    setIsDragging(true);
  }

  function handlePointerMove(pointerX: number, pointerY: number) {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    const deltaX = pointerX - dragState.pointerX;
    const deltaY = pointerY - dragState.pointerY;
    if (Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD) {
      dragState.moved = true;
      suppressNextClickRef.current = true;
    }

    const nextPosition = clampPosition(
      {
        right: dragState.startRight - deltaX,
        bottom: dragState.startBottom - deltaY,
      },
      dragState.mode,
    );
    setPosition(nextPosition);
  }

  function endDrag() {
    const dragState = dragStateRef.current;
    if (dragState) {
      const finalPosition = clampPosition(position, dragState.mode);
      setPosition(finalPosition);
      storePosition(finalPosition);
      if (dragState.moved) suppressNextClickRef.current = true;
    }
    dragStateRef.current = null;
    setIsDragging(false);
  }

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      handlePointerMove(event.clientX, event.clientY);
    }

    function handleMouseUp() {
      endDrag();
    }

    function handleTouchMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      handlePointerMove(touch.clientX, touch.clientY);
    }

    function handleTouchEnd() {
      endDrag();
    }

    if (!isDragging) return undefined;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, position]);

  function handleMouseDragStart(event: ReactMouseEvent<HTMLElement>, mode: DragState['mode']) {
    if (event.button !== 0) return;
    event.preventDefault();
    startDrag(event.clientX, event.clientY, mode);
  }

  function handleTouchDragStart(event: ReactTouchEvent<HTMLElement>, mode: DragState['mode']) {
    const touch = event.touches[0];
    if (!touch) return;
    startDrag(touch.clientX, touch.clientY, mode);
  }

  return (
    <div
      className="fixed z-50"
      style={{
        right: position.right,
        bottom: position.bottom,
      }}
    >
      {isOpen ? (
        <div className="mb-3 flex h-[min(650px,calc(100vh-96px))] w-[calc(100vw-24px)] max-w-[420px] flex-col overflow-hidden rounded-2xl border border-orange-500/25 bg-[#050505] shadow-[0_24px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:w-[420px]">
          <div
            className={`flex cursor-move select-none items-center justify-between gap-3 border-b border-orange-500/15 bg-gradient-to-r from-[#151515] to-[#1F160E] px-5 py-4 ${
              isDragging ? 'opacity-90' : ''
            }`}
            onMouseDown={(event) => handleMouseDragStart(event, 'popup')}
            onTouchStart={(event) => handleTouchDragStart(event, 'popup')}
          >
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow shadow-emerald-400/60" />
              <div>
                <div className="text-base font-semibold text-white">RIGX Chat</div>
                <div className="text-xs text-zinc-500">Cyberjaya · Bangi</div>
              </div>
            </div>
            <div
              className="flex items-center gap-1"
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsOpen(false);
                }}
                className="rounded-lg p-2 text-zinc-400 hover:bg-[#151515] hover:text-white"
                aria-label="Minimize RIGX Chat"
              >
                <Minus size={16} />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsOpen(false);
                }}
                className="rounded-lg p-2 text-zinc-400 hover:bg-[#151515] hover:text-white"
                aria-label="Close RIGX Chat"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#050505] px-4 py-4">
            {loading ? <div className="py-10 text-center text-sm text-zinc-400">Loading messages</div> : null}
            {!loading && messages.length === 0 ? (
              <div className="py-10 text-center text-sm text-zinc-400">No messages yet</div>
            ) : null}

            <div className="space-y-3">
              {messages.map((chatMessage) => {
                const isMine = userData?.uid === chatMessage.senderId;
                return (
                  <div key={chatMessage.messageId} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl border px-3.5 py-3 ${
                        isMine ? 'border-orange-500/30 bg-[#24140A]' : 'border-slate-800 bg-[#1A1A1A]/80'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <div className="text-[13px] font-medium text-zinc-200">
                          {chatMessage.senderDisplayName || 'Unknown User'} ({getBranchLabel(chatMessage.senderBranch)})
                        </div>
                        <div className="text-[11px] text-zinc-500/90">{formatTimestamp(chatMessage.createdAt)}</div>
                      </div>
                      <div className="mt-1.5 whitespace-pre-wrap text-[15px] leading-6 text-zinc-100">{chatMessage.message}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          </div>

          {errorMessage ? <div className="border-t border-white/10 px-4 py-2 text-xs text-red-300">{errorMessage}</div> : null}

          <form onSubmit={handleSendMessage} className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 border-t border-orange-500/10 bg-[#111111] px-4 py-3">
            <input
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              placeholder="Type a message..."
              disabled={sending}
              className="min-h-12 min-w-0 rounded-xl border border-white/10 bg-[#050505] px-4 py-3 text-[15px] text-white outline-none placeholder:text-zinc-600 focus:border-orange-500/35 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !draftMessage.trim()}
              className="min-h-12 rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-3 text-sm font-semibold text-white hover:from-[#D97706] hover:to-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Send
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        onClick={openChat}
        onMouseDown={(event) => handleMouseDragStart(event, 'button')}
        onTouchStart={(event) => handleTouchDragStart(event, 'button')}
        className="relative inline-flex items-center gap-2 rounded-full border border-orange-500/40 bg-[#101010] px-4 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(249,115,22,0.10)] backdrop-blur-xl hover:bg-[#151515]"
      >
        <MessageCircle size={18} className="text-[#D88A32]" />
        RIGX Chat
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-xs font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
