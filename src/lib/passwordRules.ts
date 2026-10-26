// Требования к своему паролю (экран обязательной смены пароля после того, как его задал администратор)
export const PASSWORD_MIN = 9;

export interface PasswordCheck {
  label: string;
  ok: boolean;
}

export function passwordChecks(pw: string): PasswordCheck[] {
  return [
    { label: `Не короче ${PASSWORD_MIN} символов`, ok: pw.length >= PASSWORD_MIN },
    { label: 'Есть буквы', ok: /\p{L}/u.test(pw) },
    { label: 'Есть цифры', ok: /\d/.test(pw) },
  ];
}

export const passwordOk = (pw: string) => passwordChecks(pw).every((c) => c.ok);
