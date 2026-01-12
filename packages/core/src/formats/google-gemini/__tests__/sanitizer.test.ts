import { describe, it, expect } from 'bun:test';
import { sanitizeSchema } from '../sanitizer';

interface SchemaObject {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  $ref?: string;
  additionalProperties?: boolean;
}

describe('Schema Sanitizer', () => {
  it('should convert const to enum', () => {
    const schema = {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          const: 'GET'
        }
      }
    };

    const sanitized = sanitizeSchema(schema) as SchemaObject;
    expect(sanitized.properties!.method!.const).toBeUndefined();
    expect(sanitized.properties!.method!.enum).toEqual(['GET']);
  });

  it('should remove $ref and additionalProperties', () => {
    const schema = {
      type: 'object',
      properties: {
        link: { $ref: '#/definitions/link' }
      },
      additionalProperties: false
    };

    const sanitized = sanitizeSchema(schema) as SchemaObject;
    expect(sanitized.properties!.link!.$ref).toBeUndefined();
    expect(sanitized.additionalProperties).toBeUndefined();
  });

  it('should handle nested arrays and objects', () => {
    const schema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', const: 'fixed' }
            }
          }
        }
      }
    };

    const sanitized = sanitizeSchema(schema) as SchemaObject;
    expect(sanitized.properties!.items!.items!.properties!.id!.enum).toEqual(['fixed']);
    expect(sanitized.properties!.items!.items!.properties!.id!.const).toBeUndefined();
  });
});
