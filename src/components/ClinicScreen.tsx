import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import './clinic.css';
import { supabase } from '../lib/supabase';
import { Board, PlacesBox, joinUrl, useCatalog } from './ClinicClass';

/** Экран для проектора: без входа, по коду занятия (/clinic/КОД). Места участников обновляются сами. */
export const ClinicScreen: React.FC<{ code: string }> = ({ code }) => {
  const catalog = useCatalog();
  const [qr, setQr] = useState('');
  const [fs, setFs] = useState(false);
  const url = joinUrl(code);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 360 }).then((d) => { if (live) setQr(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [url]);

  useEffect(() => {
    const on = () => setFs(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const board = useQuery({
    queryKey: ['clinic-screen', code],
    queryFn: async (): Promise<Board | null> => {
      const { data, error } = await supabase.rpc('clinic_screen', { p_code: code });
      if (error) throw error;
      return (data as Board | null) ?? null;
    },
    refetchInterval: 3000,
  });

  const b = board.data ?? undefined;
  const titleOf = (key: string) => catalog.data?.cases.find((c) => c.key === key)?.title ?? key;

  return (
    <div className="cl-app cl-screen">
      <div className="cl-top">
        <h3>🩺 {b?.title || 'Приём пациента'}<small>{b?.entry_closed ? 'Таблица лидеров' : 'Играйте со своего телефона: откройте ссылку или наведите камеру на QR-код'}</small></h3>
        <button className="cl-btn sm" type="button" onClick={toggleFs}>{fs ? '⤢ Выйти из полного экрана' : '⛶ На весь экран'}</button>
      </div>
      <div className="cl-gap">
        {!b?.entry_closed && <div className="cl-box">
          <div className="cl-head">
            {qr && <img src={qr} alt="QR-код для входа" className="cl-qr big" />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="cl-lbl">Код занятия</span>
              <div className="cl-code">{code}</div>
              <div className="cl-link-url">{url}</div>
              {b?.status === 'closed' && <div className="cl-end">Занятие завершено.</div>}
            </div>
          </div>
        </div>}
        {board.isSuccess && !b ? (
          <div className="cl-box cl-empty"><b>Занятие не найдено</b>Проверьте код в ссылке.</div>
        ) : (
          <PlacesBox b={b} loading={board.isLoading} failed={board.isError} titleOf={titleOf} big hideTitles />
        )}
      </div>
    </div>
  );
};

export default ClinicScreen;
