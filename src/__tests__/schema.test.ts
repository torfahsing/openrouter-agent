import { describe, it, expect } from 'bun:test';
import Ajv from 'ajv';

describe('schema array wrapping logic', () => {
  const outputSchema = {
    type: 'object',
    required: ['tasks'],
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'title'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
          },
        },
      },
    },
  };

  function wrapArrayIfNeeded(parsed: unknown, schema: Record<string, unknown>): unknown {
    if (schema && typeof schema === 'object' && schema.type === 'object' && Array.isArray(parsed)) {
      const isArrayOfObjects = parsed.length === 0 || (typeof parsed[0] === 'object' && parsed[0] !== null && !Array.isArray(parsed[0]));
      if (isArrayOfObjects) {
        const requiredKeys = Array.isArray(schema.required) ? (schema.required as string[]) : [];
        if (requiredKeys.length === 1) {
          const singleKey = requiredKeys[0]!;
          const propSchema = (schema.properties as Record<string, any> | undefined)?.[singleKey];
          if (propSchema && propSchema.type === 'array') {
            return { [singleKey]: parsed };
          }
        }
      }
    }
    return parsed;
  }

  it('auto-wraps top-level array into required single-property object', () => {
    const rawArray = [
      { id: 'task-1', title: 'First Task' },
      { id: 'task-2', title: 'Second Task' },
    ];

    const wrapped = wrapArrayIfNeeded(rawArray, outputSchema);
    expect(wrapped).toEqual({
      tasks: [
        { id: 'task-1', title: 'First Task' },
        { id: 'task-2', title: 'Second Task' },
      ],
    });

    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(outputSchema);
    expect(validate(wrapped)).toBe(true);
  });

  it('leaves already-wrapped object untouched', () => {
    const alreadyWrapped = {
      tasks: [{ id: 'task-1', title: 'First Task' }],
    };

    const result = wrapArrayIfNeeded(alreadyWrapped, outputSchema);
    expect(result).toEqual(alreadyWrapped);

    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(outputSchema);
    expect(validate(result)).toBe(true);
  });
});
