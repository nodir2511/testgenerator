// Распознавание в фоновом потоке. Если поток не запустился (старый браузер, сбой загрузки), та же работа идёт в основном потоке.
import type { ProcessOut } from './process';
import type { GrayImage } from './types';
import type { OmrReply, OmrRequest } from './omr.worker';

type Kind = OmrRequest['kind'];
/** Сколько ждать ответа потока, прежде чем считать его зависшим */
const TIMEOUT_MS = 20000;

interface WorkerLike { postMessage(m: OmrRequest): void; terminate(): void; onmessage: ((e: MessageEvent<OmrReply>) => void) | null; onerror: ((e: unknown) => void) | null }

export function createOmrClient(makeWorker: () => WorkerLike, inline: (kind: Kind, img: GrayImage, layouts: string[]) => Promise<unknown>, timeoutMs = TIMEOUT_MS) {
  let worker: WorkerLike | null = null;
  let broken = false;
  let nextId = 1;
  const waiting = new Map<number, (r: OmrReply | null) => void>();

  /** Поток не годится: всё, что ждёт ответа, досчитаем сами */
  const drop = () => {
    broken = true;
    try { worker?.terminate(); } catch { /* уже остановлен */ }
    worker = null;
    for (const f of [...waiting.values()]) f(null);
    waiting.clear();
  };
  const start = (): WorkerLike | null => {
    if (broken) return null;
    if (worker) return worker;
    try {
      worker = makeWorker();
      worker.onmessage = (e) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id); };
      worker.onerror = drop;
    } catch { broken = true; worker = null; }
    return worker;
  };

  async function run(kind: Kind, img: GrayImage, layouts: string[]): Promise<unknown> {
    const w = start();
    if (w) {
      const reply = await new Promise<OmrReply | null>((resolve) => {
        const id = nextId++;
        const timer = setTimeout(drop, timeoutMs);
        waiting.set(id, (r) => { clearTimeout(timer); resolve(r); });
        // Пиксели копируются, а не передаются: они нужны, если поток сломается
        try { w.postMessage({ id, kind, img, layouts }); } catch { drop(); }
      });
      if (reply && reply.fail === undefined) return reply.out;
      if (reply) throw new Error(reply.fail);
    }
    return inline(kind, img, layouts);
  }

  return {
    read: (img: GrayImage, layouts: string[]) => run('read', img, layouts) as Promise<ProcessOut>,
    probe: (img: GrayImage, layouts: string[]) => run('probe', img, layouts) as Promise<Array<[number, number]> | null>,
  };
}

const client = createOmrClient(
  () => new Worker(new URL('./omr.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
  async (kind, img, layouts) => {
    const m = await import('./process');
    return kind === 'probe' ? m.probeGray(img, layouts) : m.processGray(img, layouts);
  },
);
export const readInBackground = client.read;
export const probeInBackground = client.probe;
