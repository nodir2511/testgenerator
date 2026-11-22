// Импорт: окно увеличенной картинки
import React from 'react';
import { X } from 'lucide-react';

interface Props {
  previewImage: string;
  setPreviewImage: (url: string | null) => void;
}

export const ImageLightbox: React.FC<Props> = ({ previewImage, setPreviewImage }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    onClick={() => setPreviewImage(null)}
    role="dialog" aria-modal="true" aria-label="Увеличенное изображение"
  >
    <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setPreviewImage(null)}
        className="absolute -top-11 right-0 text-white hover:text-slate-300 p-2 rounded-full bg-black/50 hover:bg-black/75 transition"
        title="Закрыть (Esc)" aria-label="Закрыть"
      >
        <X className="w-6 h-6" />
      </button>
      <img
        src={previewImage}
        alt="Увеличенное изображение"
        className="max-h-[85vh] max-w-full rounded-2xl shadow-2xl object-contain border border-white/20 bg-white p-2"
      />
    </div>
  </div>
);
