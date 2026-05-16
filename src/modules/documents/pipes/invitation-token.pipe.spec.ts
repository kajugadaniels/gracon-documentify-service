/**
 * invitation-token.pipe.spec.ts
 *
 * Covers controller-edge invitation-token validation.
 */
import { BadRequestException } from '@nestjs/common';
import { InvitationTokenPipe } from './invitation-token.pipe';

describe('InvitationTokenPipe', () => {
  const pipe = new InvitationTokenPipe();

  it('normalizes valid 64-character hex tokens', () => {
    expect(pipe.transform('A'.repeat(64))).toBe('a'.repeat(64));
  });

  it('rejects malformed invitation tokens before service lookup', () => {
    expect(() => pipe.transform('not-a-token')).toThrow(BadRequestException);
  });
});
