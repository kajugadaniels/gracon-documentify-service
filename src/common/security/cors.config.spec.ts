import { buildCorsConfig } from './cors.config';

function resolveCorsDecision(
  config: ReturnType<typeof buildCorsConfig>,
  origin?: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (typeof config.origin !== 'function') {
      reject(new Error('CORS origin handler was not configured as a function.'));
      return;
    }

    config.origin(origin, (error, allowed) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(allowed === true);
    });
  });
}

describe('buildCorsConfig', () => {
  it('allows requests without an origin header', async () => {
    const config = buildCorsConfig('http://localhost:4002');

    await expect(resolveCorsDecision(config)).resolves.toBe(true);
  });

  it('allows the primary configured frontend origin', async () => {
    const config = buildCorsConfig('http://localhost:4002');

    await expect(
      resolveCorsDecision(config, 'http://localhost:4002'),
    ).resolves.toBe(true);
  });

  it('allows additional configured frontend origins from a comma-separated list', async () => {
    const config = buildCorsConfig(
      'http://localhost:4002',
      'https://docs.gracon.com, https://staging-docs.gracon.com',
    );

    await expect(
      resolveCorsDecision(config, 'https://staging-docs.gracon.com'),
    ).resolves.toBe(true);
  });

  it('rejects origins that are not in the allowlist', async () => {
    const config = buildCorsConfig('http://localhost:4002');

    await expect(
      resolveCorsDecision(config, 'https://evil.example'),
    ).rejects.toThrow(
      'Origin https://evil.example is not allowed by documents service CORS policy.',
    );
  });

  it('exposes the expected locked-down response settings', () => {
    const config = buildCorsConfig('http://localhost:4002');

    expect(config.methods).toEqual(['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']);
    expect(config.allowedHeaders).toEqual(['Content-Type', 'Authorization']);
    expect(config.exposedHeaders).toEqual(['Retry-After']);
    expect(config.credentials).toBe(true);
    expect(config.maxAge).toBe(86_400);
  });
});
