// Фоновый поток распознавания: экран камеры не замирает, пока читается снимок.
import { probeGray, processGray } from './process';
import type { GrayImage } from './types';

export type OmrRequest = { id: number; kind: 'read' | 'probe'; img: GrayImage; layouts: string[] };
export type OmrReply = { id: number; out?: unknown; fail?: string };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<OmrRequest>) => void) | null; postMessage(m: OmrReply, transfer?: Transferable[]): void };

ctx.onmessage = (e) => {
  const { id, kind, img, layouts } = e.data;
  try {
    if (kind === 'probe') return ctx.postMessage({ id, out: probeGray(img, layouts) });
    const out = processGray(img, layouts);
    const transfer = [out.sheet?.img.data.buffer, out.debug?.bin.buffer].filter((b) => !!b) as ArrayBuffer[];
    ctx.postMessage({ id, out }, transfer);
  } catch (err) {
    ctx.postMessage({ id, fail: (err as Error)?.message || 'ошибка распознавания' });
  }
};
