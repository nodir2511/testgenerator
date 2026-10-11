import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';

export interface CompressedImageResult {
  file: File;
  previewUrl: string;
}

/**
 * Оптимизирует и сжимает изображение перед загрузкой в Supabase Storage
 */
export async function compressImage(file: File): Promise<File> {
  const options = {
    maxSizeMB: 0.5, // Максимум 500 КБ
    maxWidthOrHeight: 1200, // Максимум 1200px по ширине/высоте
    useWebWorker: true,
    fileType: 'image/webp' as const,
  };

  try {
    return await imageCompression(file, options);
  } catch (error) {
    console.warn('Ошибка сжатия через web-worker, используем исходный файл:', error);
    return file;
  }
}

/**
 * Загружает изображение в бакет question-images в Supabase Storage
 * и возвращает публичный URL.
 */
export async function uploadQuestionImage(file: File): Promise<string> {
  const compressed = await compressImage(file);
  const ext = 'webp';
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const filePath = `questions/${fileName}`;

  const { error } = await supabase.storage
    .from('question-images')
    .upload(filePath, compressed, {
      contentType: 'image/webp',
      cacheControl: '31536000', // 1 год кэша
      upsert: false,
    });

  if (error) {
    throw new Error(`Ошибка загрузки изображения: ${error.message}`);
  }

  const { data } = supabase.storage
    .from('question-images')
    .getPublicUrl(filePath);

  return data.publicUrl;
}
