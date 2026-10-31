import { describe, it, expect, vi } from 'vitest';
import { friendly, isRateLimited } from '../src/sync';

const err = (code: string, message = 'x', status = 400) => Object.assign(new Error(message), { code, status });

describe('가입·로그인 오류 문구 (error_code 기준)', () => {
  it('코드별 한국어 문구', () => {
    expect(friendly(err('user_already_exists', 'User already registered', 422))).toBe('이미 사용 중인 아이디예요');
    expect(friendly(err('email_exists', 'Email address already exists', 422))).toBe('이미 사용 중인 아이디예요');
    expect(friendly(err('weak_password', 'Password should be at least 6 characters', 422))).toBe('비밀번호가 너무 짧아요 (6자 이상)');
    expect(friendly(err('invalid_credentials', 'Invalid login credentials'))).toBe('아이디 또는 비밀번호가 맞지 않아요');
  });
  it('429·요청 한도는 잠시 후 다시 + 잠금 대상', () => {
    for (const e of [err('over_request_rate_limit', 'Request rate limit reached', 429), err('over_email_send_rate_limit', 'Email rate limit exceeded', 429), err('', 'Too Many Requests', 429)]) {
      expect(friendly(e)).toBe('잠시 후 다시 시도해주세요');
      expect(isRateLimited(e)).toBe(true);
    }
    expect(isRateLimited(err('invalid_credentials'))).toBe(false);
  });
  it('모르는 오류는 "연결에 실패했어요" + 콘솔에 원본 기록, 화면 문구에 "이메일" 없음', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(friendly(err('unexpected_failure', 'Email provider exploded', 500))).toBe('연결에 실패했어요');
    expect(log).toHaveBeenCalledWith(expect.any(String), 'unexpected_failure', 'Email provider exploded');
    log.mockRestore();
    for (const c of ['email_not_confirmed', 'email_address_invalid', 'signup_disabled']) expect(friendly(err(c))).not.toMatch(/이메일|email/i);
  });
});
