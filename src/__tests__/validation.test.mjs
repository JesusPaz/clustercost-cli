import { describe, it, expect } from 'vitest';
import {
  validateNamespace,
  validateServiceName,
  validatePort,
  buildDashboardHelmArgs,
} from '../index.mjs';

describe('input validators', () => {
  it('validates namespaces', () => {
    expect(validateNamespace('clustercost')).toBeUndefined();
    expect(validateNamespace('')).toBe('Namespace cannot be empty.');
    expect(validateNamespace('prod namespace')).toBe('Namespace cannot contain spaces.');
    expect(validateNamespace('   ')).toBe('Namespace cannot be empty.');
  });

  it('validates service names', () => {
    expect(validateServiceName('svc-clustercost')).toBeUndefined();
    expect(validateServiceName('')).toBe('Service name is required.');
    expect(validateServiceName('svc dashboard')).toBe('Service name cannot contain spaces.');
    expect(validateServiceName(' svc-cluster ')).toBeUndefined();
  });

  it('validates ports', () => {
    expect(validatePort('8080')).toBeUndefined();
    expect(validatePort('0')).toBe('Enter a valid TCP port (1-65535).');
    expect(validatePort('99999')).toBe('Enter a valid TCP port (1-65535).');
    expect(validatePort('abc')).toBe('Enter a valid TCP port (1-65535).');
    expect(validatePort(' 8080 ')).toBeUndefined();
    expect(validatePort('-1')).toBe('Enter a valid TCP port (1-65535).');
  });
});

describe('dashboard Helm args', () => {
  it('keeps defaults when namespace is clustercost', () => {
    const args = buildDashboardHelmArgs('clustercost');
    expect(args).not.toContain('--set-string');
  });

  it('overrides agent base URL when namespace changes', () => {
    const namespace = 'team-a';
    const args = buildDashboardHelmArgs(namespace);
    expect(args).toContain('--set-string');
    expect(args).toContain(
      'agents[0].baseUrl=http://clustercost-agent-clustercost-agent-k8s.team-a.svc.cluster.local:8080'
    );
  });
});
