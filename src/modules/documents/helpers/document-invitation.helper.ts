import { CollaboratorInvitationStatus } from '@prisma/client';

export const INVITATION_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export type InvitationSessionState = {
  emailOtpSentAt: Date | null;
  emailOtpExpiresAt: Date | null;
  emailOtpVerifiedAt: Date | null;
  emailOtpAttemptCount: number;
  emailOtpRequestCount: number;
  emailOtpWindowStartedAt: Date | null;
  identityChallengeStartedAt: Date | null;
  identityVerificationAttemptId: string | null;
  identityVerifiedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date;
};

export type InvitationLookupState = {
  invitationStatus: CollaboratorInvitationStatus;
  invitationExpiresAt: Date | null;
};

export type OtpRequestDecision =
  | { allowed: true; resendAvailableAt: Date | null }
  | {
      allowed: false;
      reason: 'RESEND_COOLDOWN' | 'RATE_LIMIT';
      retryAt: Date;
      retryAfterSeconds: number;
    };

export type OtpVerificationDecision =
  | { outcome: 'ALREADY_VERIFIED' }
  | { outcome: 'REQUEST_REQUIRED' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'TOO_MANY_ATTEMPTS' }
  | { outcome: 'INVALID_CODE'; nextAttemptCount: number; remainingAttempts: number }
  | { outcome: 'VERIFIED' };

export type InvitationReviewDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | 'EMAIL_OTP_REQUIRED'
        | 'SESSION_EXPIRED'
        | 'IDENTITY_VERIFICATION_REQUIRED';
    };

export function isValidInvitationTokenFormat(rawToken: string): boolean {
  return INVITATION_TOKEN_PATTERN.test(rawToken);
}

export function resolveInvitationVerificationSessionExpiry(input: {
  invitationExpiresAt: Date | null;
  now: Date;
  sessionTtlMs: number;
}): Date {
  const maxExpiry = new Date(input.now.getTime() + input.sessionTtlMs);

  if (
    input.invitationExpiresAt &&
    input.invitationExpiresAt.getTime() < maxExpiry.getTime()
  ) {
    return input.invitationExpiresAt;
  }

  return maxExpiry;
}

export function evaluateInvitationLookupState(
  invitation: InvitationLookupState,
  now: Date,
): 'ACTIVE' | 'EXPIRED' | 'INACTIVE' {
  if (
    invitation.invitationStatus === CollaboratorInvitationStatus.PENDING &&
    invitation.invitationExpiresAt &&
    invitation.invitationExpiresAt.getTime() <= now.getTime()
  ) {
    return 'EXPIRED';
  }

  if (invitation.invitationStatus !== CollaboratorInvitationStatus.PENDING) {
    return 'INACTIVE';
  }

  return 'ACTIVE';
}

export function resolveInvitationEmailOtpResendAvailableAt(
  emailOtpSentAt: Date | null,
  resendCooldownMs: number,
): Date | null {
  if (!emailOtpSentAt) {
    return null;
  }

  return new Date(emailOtpSentAt.getTime() + resendCooldownMs);
}

export function evaluateInvitationEmailOtpRequest(input: {
  session: Pick<
    InvitationSessionState,
    'emailOtpSentAt' | 'emailOtpRequestCount' | 'emailOtpWindowStartedAt'
  >;
  now: Date;
  resendCooldownMs: number;
  maxRequestsPerHour: number;
}): OtpRequestDecision {
  const resendAvailableAt = resolveInvitationEmailOtpResendAvailableAt(
    input.session.emailOtpSentAt,
    input.resendCooldownMs,
  );

  if (resendAvailableAt && resendAvailableAt.getTime() > input.now.getTime()) {
    return {
      allowed: false,
      reason: 'RESEND_COOLDOWN',
      retryAt: resendAvailableAt,
      retryAfterSeconds: Math.ceil(
        (resendAvailableAt.getTime() - input.now.getTime()) / 1000,
      ),
    };
  }

  const isInActiveWindow =
    input.session.emailOtpWindowStartedAt &&
    input.now.getTime() - input.session.emailOtpWindowStartedAt.getTime() <
      60 * 60 * 1000;

  if (
    isInActiveWindow &&
    input.session.emailOtpRequestCount >= input.maxRequestsPerHour
  ) {
    const retryAt = new Date(
      input.session.emailOtpWindowStartedAt!.getTime() + 60 * 60 * 1000,
    );

    return {
      allowed: false,
      reason: 'RATE_LIMIT',
      retryAt,
      retryAfterSeconds: Math.ceil(
        (retryAt.getTime() - input.now.getTime()) / 1000,
      ),
    };
  }

  return {
    allowed: true,
    resendAvailableAt,
  };
}

export function resolveInvitationGateNextStep(
  session: Pick<
    InvitationSessionState,
    'emailOtpVerifiedAt' | 'completedAt'
  >,
): 'email_otp' | 'identity_verification' | 'review' {
  if (!session.emailOtpVerifiedAt) {
    return 'email_otp';
  }

  if (session.completedAt) {
    return 'review';
  }

  return 'identity_verification';
}

export function evaluateInvitationEmailOtpVerification(input: {
  session: {
    emailOtpCodeHash: string | null;
    emailOtpExpiresAt: Date | null;
    emailOtpVerifiedAt: Date | null;
    emailOtpAttemptCount: number;
  };
  now: Date;
  isCodeMatch: boolean;
  maxAttempts: number;
}): OtpVerificationDecision {
  if (input.session.emailOtpVerifiedAt) {
    return { outcome: 'ALREADY_VERIFIED' };
  }

  if (!input.session.emailOtpCodeHash || !input.session.emailOtpExpiresAt) {
    return { outcome: 'REQUEST_REQUIRED' };
  }

  if (input.session.emailOtpExpiresAt.getTime() <= input.now.getTime()) {
    return { outcome: 'EXPIRED' };
  }

  if (input.session.emailOtpAttemptCount >= input.maxAttempts) {
    return { outcome: 'TOO_MANY_ATTEMPTS' };
  }

  if (!input.isCodeMatch) {
    const nextAttemptCount = input.session.emailOtpAttemptCount + 1;
    return {
      outcome: 'INVALID_CODE',
      nextAttemptCount,
      remainingAttempts: Math.max(input.maxAttempts - nextAttemptCount, 0),
    };
  }

  return { outcome: 'VERIFIED' };
}

export function evaluateInvitationReviewAccess(input: {
  session: Pick<InvitationSessionState, 'emailOtpVerifiedAt' | 'completedAt' | 'expiresAt'> | null;
  now: Date;
}): InvitationReviewDecision {
  if (!input.session || !input.session.emailOtpVerifiedAt) {
    return { allowed: false, reason: 'EMAIL_OTP_REQUIRED' };
  }

  if (input.session.expiresAt.getTime() <= input.now.getTime()) {
    return { allowed: false, reason: 'SESSION_EXPIRED' };
  }

  if (!input.session.completedAt) {
    return { allowed: false, reason: 'IDENTITY_VERIFICATION_REQUIRED' };
  }

  return { allowed: true };
}
