import { describe, it, expect } from 'vitest';
import {
  validateNamespace,
  validateServiceName,
  validatePort,
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
