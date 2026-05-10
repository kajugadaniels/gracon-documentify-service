import {
  CollaboratorInvitationStatus,
  DocumentInvitationVerificationRequirement,
} from '@prisma/client';
import {
  evaluateInvitationEmailOtpRequest,
  evaluateInvitationEmailOtpVerification,
  evaluateInvitationLookupState,
  evaluateInvitationReviewAccess,
  INVITATION_TOKEN_PATTERN,
  isValidInvitationTokenFormat,
  normalizeInvitationVerificationRequirements,
  requiresInvitationEmailOtp,
  requiresInvitationIdentityVerification,
  resolveInvitationEmailOtpResendAvailableAt,
  resolveInvitationGateNextStep,
  resolveInvitationVerificationSessionExpiry,
} from './document-invitation.helper';

const EMAIL_OTP = DocumentInvitationVerificationRequirement.EMAIL_OTP;
const IDENTITY_VERIFICATION =
  DocumentInvitationVerificationRequirement.IDENTITY_VERIFICATION;

describe('document-invitation.helper', () => {
  it('validates the expected invitation token format', () => {
    expect(INVITATION_TOKEN_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(isValidInvitationTokenFormat('f'.repeat(64))).toBe(true);
    expect(isValidInvitationTokenFormat('short-token')).toBe(false);
  });

  it('caps verification session expiry by invitation expiry when earlier', () => {
    const now = new Date('2026-01-01T09:00:00.000Z');
    const invitationExpiresAt = new Date('2026-01-01T12:00:00.000Z');

    expect(
      resolveInvitationVerificationSessionExpiry({
        invitationExpiresAt,
        now,
        sessionTtlMs: 24 * 60 * 60 * 1000,
      }),
    ).toEqual(invitationExpiresAt);
  });

  it('marks pending invitations past expiry as expired', () => {
    expect(
      evaluateInvitationLookupState(
        {
          invitationStatus: CollaboratorInvitationStatus.PENDING,
          invitationExpiresAt: new Date('2026-01-01T09:00:00.000Z'),
        },
        new Date('2026-01-01T09:00:01.000Z'),
      ),
    ).toBe('EXPIRED');
  });

  it('treats non-pending invitations as inactive', () => {
    expect(
      evaluateInvitationLookupState(
        {
          invitationStatus: CollaboratorInvitationStatus.ACCEPTED,
          invitationExpiresAt: null,
        },
        new Date('2026-01-01T09:00:00.000Z'),
      ),
    ).toBe('INACTIVE');
  });

  it('computes otp resend availability from the last send time', () => {
    const sentAt = new Date('2026-01-01T09:00:00.000Z');
    expect(resolveInvitationEmailOtpResendAvailableAt(sentAt, 60_000)).toEqual(
      new Date('2026-01-01T09:01:00.000Z'),
    );
  });

  it('blocks otp requests during the resend cooldown window', () => {
    const decision = evaluateInvitationEmailOtpRequest({
      session: {
        emailOtpSentAt: new Date('2026-01-01T09:00:30.000Z'),
        emailOtpRequestCount: 1,
        emailOtpWindowStartedAt: new Date('2026-01-01T09:00:00.000Z'),
      },
      now: new Date('2026-01-01T09:01:00.000Z'),
      resendCooldownMs: 60_000,
      maxRequestsPerHour: 3,
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'RESEND_COOLDOWN',
    });
  });

  it('blocks otp requests after the hourly request cap is reached', () => {
    const decision = evaluateInvitationEmailOtpRequest({
      session: {
        emailOtpSentAt: null,
        emailOtpRequestCount: 3,
        emailOtpWindowStartedAt: new Date('2026-01-01T09:00:00.000Z'),
      },
      now: new Date('2026-01-01T09:30:00.000Z'),
      resendCooldownMs: 60_000,
      maxRequestsPerHour: 3,
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'RATE_LIMIT',
    });
  });

  it('allows otp requests when no cooldown or rate limit applies', () => {
    expect(
      evaluateInvitationEmailOtpRequest({
        session: {
          emailOtpSentAt: null,
          emailOtpRequestCount: 0,
          emailOtpWindowStartedAt: null,
        },
        now: new Date('2026-01-01T09:00:00.000Z'),
        resendCooldownMs: 60_000,
        maxRequestsPerHour: 3,
      }),
    ).toEqual({
      allowed: true,
      resendAvailableAt: null,
    });
  });

  it('resolves the gate next step from session state', () => {
    expect(
      resolveInvitationGateNextStep({
        emailOtpVerifiedAt: null,
        completedAt: null,
      }),
    ).toBe('email_otp');
    expect(
      resolveInvitationGateNextStep({
        emailOtpVerifiedAt: new Date('2026-01-01T09:05:00.000Z'),
        completedAt: null,
      }),
    ).toBe('identity_verification');
    expect(
      resolveInvitationGateNextStep({
        emailOtpVerifiedAt: new Date('2026-01-01T09:05:00.000Z'),
        completedAt: new Date('2026-01-01T09:10:00.000Z'),
      }),
    ).toBe('review');
  });

  it('normalizes selected invitation verification requirements in canonical order', () => {
    expect(normalizeInvitationVerificationRequirements(undefined)).toEqual([
      EMAIL_OTP,
      IDENTITY_VERIFICATION,
    ]);
    expect(
      normalizeInvitationVerificationRequirements([
        IDENTITY_VERIFICATION,
        EMAIL_OTP,
        IDENTITY_VERIFICATION,
      ]),
    ).toEqual([EMAIL_OTP, IDENTITY_VERIFICATION]);
    expect(normalizeInvitationVerificationRequirements([])).toEqual([]);
    expect(requiresInvitationEmailOtp([EMAIL_OTP])).toBe(true);
    expect(requiresInvitationIdentityVerification([EMAIL_OTP])).toBe(false);
  });

  it('resolves optional invitation gate combinations', () => {
    const pendingSession = { emailOtpVerifiedAt: null, completedAt: null };

    expect(resolveInvitationGateNextStep(pendingSession, [])).toBe('review');
    expect(
      resolveInvitationGateNextStep(pendingSession, [IDENTITY_VERIFICATION]),
    ).toBe('identity_verification');
    expect(
      resolveInvitationGateNextStep(
        {
          emailOtpVerifiedAt: new Date('2026-01-01T09:05:00.000Z'),
          completedAt: null,
        },
        [EMAIL_OTP],
      ),
    ).toBe('review');
  });

  it('returns otp verification outcomes for missing, expired, invalid, and verified cases', () => {
    expect(
      evaluateInvitationEmailOtpVerification({
        session: {
          emailOtpCodeHash: null,
          emailOtpExpiresAt: null,
          emailOtpVerifiedAt: null,
          emailOtpAttemptCount: 0,
        },
        now: new Date('2026-01-01T09:00:00.000Z'),
        isCodeMatch: false,
        maxAttempts: 5,
      }),
    ).toEqual({ outcome: 'REQUEST_REQUIRED' });

    expect(
      evaluateInvitationEmailOtpVerification({
        session: {
          emailOtpCodeHash: 'hash',
          emailOtpExpiresAt: new Date('2026-01-01T08:59:00.000Z'),
          emailOtpVerifiedAt: null,
          emailOtpAttemptCount: 0,
        },
        now: new Date('2026-01-01T09:00:00.000Z'),
        isCodeMatch: false,
        maxAttempts: 5,
      }),
    ).toEqual({ outcome: 'EXPIRED' });

    expect(
      evaluateInvitationEmailOtpVerification({
        session: {
          emailOtpCodeHash: 'hash',
          emailOtpExpiresAt: new Date('2026-01-01T09:05:00.000Z'),
          emailOtpVerifiedAt: null,
          emailOtpAttemptCount: 2,
        },
        now: new Date('2026-01-01T09:00:00.000Z'),
        isCodeMatch: false,
        maxAttempts: 5,
      }),
    ).toEqual({
      outcome: 'INVALID_CODE',
      nextAttemptCount: 3,
      remainingAttempts: 2,
    });

    expect(
      evaluateInvitationEmailOtpVerification({
        session: {
          emailOtpCodeHash: 'hash',
          emailOtpExpiresAt: new Date('2026-01-01T09:05:00.000Z'),
          emailOtpVerifiedAt: null,
          emailOtpAttemptCount: 0,
        },
        now: new Date('2026-01-01T09:00:00.000Z'),
        isCodeMatch: true,
        maxAttempts: 5,
      }),
    ).toEqual({ outcome: 'VERIFIED' });
  });

  it('blocks completed review until otp and identity verification are done within session ttl', () => {
    expect(
      evaluateInvitationReviewAccess({
        session: null,
        requirements: [EMAIL_OTP, IDENTITY_VERIFICATION],
        now: new Date('2026-01-01T09:00:00.000Z'),
      }),
    ).toEqual({ allowed: false, reason: 'EMAIL_OTP_REQUIRED' });

    expect(
      evaluateInvitationReviewAccess({
        session: {
          emailOtpVerifiedAt: new Date('2026-01-01T09:05:00.000Z'),
          completedAt: null,
          expiresAt: new Date('2026-01-01T10:00:00.000Z'),
        },
        requirements: [EMAIL_OTP, IDENTITY_VERIFICATION],
        now: new Date('2026-01-01T09:10:00.000Z'),
      }),
    ).toEqual({
      allowed: false,
      reason: 'IDENTITY_VERIFICATION_REQUIRED',
    });

    expect(
      evaluateInvitationReviewAccess({
        session: {
          emailOtpVerifiedAt: new Date('2026-01-01T09:05:00.000Z'),
          completedAt: new Date('2026-01-01T09:08:00.000Z'),
          expiresAt: new Date('2026-01-01T09:09:00.000Z'),
        },
        requirements: [EMAIL_OTP, IDENTITY_VERIFICATION],
        now: new Date('2026-01-01T09:10:00.000Z'),
      }),
    ).toEqual({ allowed: false, reason: 'SESSION_EXPIRED' });

    expect(
      evaluateInvitationReviewAccess({
        session: {
          emailOtpVerifiedAt: new Date('2026-01-01T09:05:00.000Z'),
          completedAt: new Date('2026-01-01T09:08:00.000Z'),
          expiresAt: new Date('2026-01-01T10:00:00.000Z'),
        },
        requirements: [EMAIL_OTP, IDENTITY_VERIFICATION],
        now: new Date('2026-01-01T09:10:00.000Z'),
      }),
    ).toEqual({ allowed: true });

    expect(
      evaluateInvitationReviewAccess({
        session: null,
        requirements: [],
        now: new Date('2026-01-01T09:00:00.000Z'),
      }),
    ).toEqual({ allowed: true });

    expect(
      evaluateInvitationReviewAccess({
        session: {
          emailOtpVerifiedAt: null,
          completedAt: new Date('2026-01-01T09:08:00.000Z'),
          expiresAt: new Date('2026-01-01T10:00:00.000Z'),
        },
        requirements: [IDENTITY_VERIFICATION],
        now: new Date('2026-01-01T09:10:00.000Z'),
      }),
    ).toEqual({ allowed: true });
  });
});
