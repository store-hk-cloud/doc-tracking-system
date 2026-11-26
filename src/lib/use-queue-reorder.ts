'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { changedSpan, dropIndexFromY, moveOrderable, saveQueueOrder, type QueueOrderScope } from '@/lib/queue-order';

interface Options<T> {
  items: T[];
  setItems: (items: T[]) => void;
  getId: (item: T) => string;
  isOrderable: (item: T) => boolean;
  scope: QueueOrderScope;
  enabled: boolean;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  // เรียกหลังบันทึกจบทุกกรณีและ isSaving() เป็น false แล้ว stale = เซิร์ฟเวอร์ตอบ 409 (ข้อมูลบนจอเก่าแล้ว)
  onSettled: (stale: boolean) => void;
}

export function useQueueReorder<T>(options: Options<T>) {
  const { items, enabled } = options;
  const opts = useRef(options);
  useEffect(() => { opts.current = options; });

  const [drag, setDrag] = useState<{ id: string; toIndex: number } | null>(null);
  const dragRef = useRef(drag);
  useEffect(() => { dragRef.current = drag; }, [drag]);

  const rowEls = useRef(new Map<string, HTMLElement>());
  const handleEls = useRef(new Map<string, HTMLElement>());
  const focusId = useRef<string | null>(null);
  // รอบบันทึกที่กำลังส่งอยู่ — ส่งได้ทีละรอบ ขยับต่อระหว่างนั้นจะถูกส่งรอบถัดไปด้วยลำดับล่าสุด
  const busy = useRef(false);
  const latest = useRef(items);
  const confirmed = useRef(items);

  useEffect(() => {
    latest.current = items;
    // ระหว่างบันทึก items คือลำดับที่ยังไม่ยืนยัน จึงไม่เอามาเป็น snapshot
    if (!busy.current) confirmed.current = items;
  }, [items]);

  useEffect(() => {
    if (!focusId.current) return;
    handleEls.current.get(focusId.current)?.focus();
    focusId.current = null;
  }, [items]);

  const orderableIds = (list: T[]) => list.filter(opts.current.isOrderable).map(opts.current.getId);
  const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

  const flush = async () => {
    if (busy.current) return;
    busy.current = true;
    let saved = false;
    let failed = false;
    let stale = false;
    try {
      for (;;) {
        const sent = latest.current;
        const all = orderableIds(sent);
        const base = orderableIds(confirmed.current);
        // stage ส่งเฉพาะช่วงที่เปลี่ยน เพื่อไม่ทับลำดับของแถวที่เพื่อนร่วมหน่วยงานจัดหรือรับไปแล้ว
        // delivery ต้องส่งทั้งชุดเพราะ RPC ให้ชุดที่จัดแล้วกองติดกันบนสุด
        const ids = opts.current.scope === 'stage' ? changedSpan(base, all) : sameIds(all, base) ? [] : all;
        if (ids.length === 0) {
          confirmed.current = sent;
          break;
        }
        const result = await saveQueueOrder(opts.current.scope, ids);
        if (result.ok) {
          confirmed.current = sent;
          saved = true;
          continue;
        }
        failed = true;
        stale = result.status === 409;
        latest.current = confirmed.current;
        opts.current.setItems(confirmed.current);
        opts.current.onError(stale
          ? 'ลำดับหรือรายการมีการเปลี่ยนแปลงแล้ว โหลดรายการล่าสุดให้ กรุณาตรวจสอบก่อนจัดลำดับใหม่'
          : `บันทึกลำดับไม่สำเร็จ คืนลำดับเดิมแล้ว${result.error ? ` (${result.error})` : ''}`);
        break;
      }
    } finally {
      busy.current = false;
    }
    if (saved && !failed) opts.current.onSaved('บันทึกลำดับแล้ว');
    opts.current.onSettled(stale);
  };

  const moveTo = (id: string, toIndex: number, refocus = false) => {
    const next = moveOrderable(latest.current, opts.current.getId, opts.current.isOrderable, id, toIndex);
    if (next === latest.current) return;
    // ตั้งโฟกัสเฉพาะเมื่อลำดับเปลี่ยนจริง ไม่งั้นค่าค้างจะดึงโฟกัสกลับตอน items โหลดใหม่ภายหลัง
    if (refocus) focusId.current = id;
    latest.current = next;
    opts.current.setItems(next);
    void flush();
  };

  const targetIndex = (id: string, clientY: number) => {
    const rects: { top: number; bottom: number }[] = [];
    for (const rowId of orderableIds(latest.current)) {
      const el = rowEls.current.get(rowId);
      if (!el) return -1;
      rects.push(el.getBoundingClientRect());
    }
    return dropIndexFromY(rects, clientY);
  };

  const clearDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const handleProps = (id: string, docNo: string, position: number) => ({
    ref: (el: HTMLElement | null) => {
      if (el) handleEls.current.set(id, el); else handleEls.current.delete(id);
    },
    type: 'button' as const,
    className: 'drag-handle',
    'aria-label': `จัดลำดับเอกสาร ${docNo} อยู่ลำดับที่ ${position} ลากหรือกดลูกศรขึ้นลงเพื่อย้ายตำแหน่ง`,
    disabled: !enabled,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (!opts.current.enabled || e.button !== 0) return;
      const from = orderableIds(latest.current).indexOf(id);
      if (from < 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { id, toIndex: from };
      setDrag(dragRef.current);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const current = dragRef.current;
      if (!current || current.id !== id) return;
      const toIndex = targetIndex(id, e.clientY);
      if (toIndex >= 0 && toIndex !== current.toIndex) {
        dragRef.current = { id, toIndex };
        setDrag(dragRef.current);
      }
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const current = dragRef.current;
      if (!current || current.id !== id) return;
      // อ่าน toIndex จากพิกัดตอนปล่อยอีกรอบ เผื่อ event move สุดท้ายยังไม่ render
      const toIndex = targetIndex(id, e.clientY);
      clearDrag();
      moveTo(id, toIndex >= 0 ? toIndex : current.toIndex);
    },
    // เบราว์เซอร์ปล่อย pointer capture เอง (เช่น แถวถูก re-render หายไประหว่างลาก) จะไม่มี pointerup ตามมา
    onPointerCancel: clearDrag,
    onLostPointerCapture: clearDrag,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!opts.current.enabled) return;
      if (e.key === 'Escape') { clearDrag(); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const from = orderableIds(latest.current).indexOf(id);
      if (from < 0) return;
      moveTo(id, from + (e.key === 'ArrowUp' ? -1 : 1), true);
    },
  });

  const rowProps = (id: string) => {
    let className: string | undefined;
    if (drag?.id === id) {
      className = 'row-dragging';
    } else if (drag) {
      const ids = orderableIds(items);
      const from = ids.indexOf(drag.id);
      if (drag.toIndex !== from && ids[drag.toIndex] === id) {
        className = drag.toIndex < from ? 'row-drop-above' : 'row-drop-below';
      }
    }
    return {
      'data-row-id': id,
      className,
      ref: (el: HTMLElement | null) => {
        if (el) rowEls.current.set(id, el); else rowEls.current.delete(id);
      },
    };
  };

  return { handleProps, rowProps, isSaving: () => busy.current };
}
