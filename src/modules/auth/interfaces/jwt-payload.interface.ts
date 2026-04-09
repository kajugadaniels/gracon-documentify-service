export interface JwtPayload {
  sub: string;
  email: string;
  tokenType: 'full' | 'limited';
  iat?: number;
  exp?: number;
}

export interface RequestUser {
  userId: string;
  email: string;
  tokenType: 'full' | 'limited';
  isIdVerified: boolean;
}
